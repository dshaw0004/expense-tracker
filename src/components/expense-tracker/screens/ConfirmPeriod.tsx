"use client";

import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "../shared/Money";
import { MoneyInput } from "../shared/Money";
import { useNav } from "@/lib/store/nav";
import { useAppData, type AppData } from "@/hooks/expense-tracker/useAppData";
import { parseMoneyToMinor, formatMoney, addMinor, subMinor } from "@/lib/budget/money";
import { addDays, todayIso, formatDisplayDate, type IsoDate } from "@/lib/budget/dates";
import { buildAllocationPreview } from "@/lib/budget/allocation";
import { computeEffectiveBudget, computeCarryPreview, confirmPeriod, type CutoverOption, type CarryPreview } from "@/lib/budget/period";
import { computeSavingsBalance, withdrawalsInPeriod, remainingCap } from "@/lib/budget/savings";
import { saveTransfer } from "@/lib/budget/period";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, Minus, Plus, ShieldCheck, ArrowRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConfirmPeriodProps {
  data: AppData;
}

export function ConfirmPeriod({ data }: ConfirmPeriodProps) {
  const { go, payload } = useNav();
  const { settings, categories, periods, expenses, transfers, savingsLedger, refresh } = data;
  const { toast } = useToast();

  const start = payload?.start as string | undefined;
  const newPeriod = periods.find((p) => p.start_date === start && p.status === "pending") ?? null;
  const prevPeriod = periods
    .filter((p) => p.status !== "pending")
    .sort((a, b) => (a.start_date < b.start_date ? 1 : -1))[0] ?? null;

  // Compute carry preview from the previous period.
  const carryPreview = useMemo<CarryPreview[]>(() => {
    if (!prevPeriod || !settings) return [];
    const prevAllocs = data.allocations.filter((a) => a.period_start_date === prevPeriod.start_date);
    const prevTransfers = data.transfers.filter((t) => t.period_start_date === prevPeriod.start_date);
    const prevEnd = prevPeriod.end_date ?? todayIso();
    const prevExpenses = data.expenses.filter((e) => e.date >= prevPeriod.start_date && e.date <= prevEnd);
    return computeCarryPreview(prevAllocs, prevTransfers, prevExpenses, settings);
  }, [prevPeriod, settings, data]);

  const carriedInByCategory = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of carryPreview) if (c.carryToNextMinor > 0) m[c.categoryId] = c.carryToNextMinor;
    return m;
  }, [carryPreview]);

  // Salary adjust state.
  const defaultSalary = settings?.default_salary_minor ?? 0;
  const [adjustments, setAdjustments] = useState<{ label: string; amount: string; sign: 1 | -1 }[]>([{ label: "", amount: "", sign: -1 }]);

  // Reset adjustments when the period being confirmed changes. Use eslint-disable
  // because this is a legitimate sync-state-to-prop pattern.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAdjustments([{ label: "", amount: "", sign: -1 }]);
  }, [start]);

  // Cutover state.
  const [cutover, setCutover] = useState<CutoverOption>({ kind: "configured" });

  // Compute prev period deficit rows (after carry/sweep applied).
  const prevDeficitRows = useMemo(() => {
    if (!prevPeriod) return [];
    const prevAllocs = data.allocations.filter((a) => a.period_start_date === prevPeriod.start_date);
    const prevTransfers = data.transfers.filter((t) => t.period_start_date === prevPeriod.start_date);
    const prevEnd = prevPeriod.end_date ?? todayIso();
    const prevExpenses = data.expenses.filter((e) => e.date >= prevPeriod.start_date && e.date <= prevEnd);
    const rows = computeEffectiveBudget(prevAllocs, prevTransfers, prevExpenses, categories);
    return rows.filter((r) => r.remaining_minor < 0);
  }, [prevPeriod, data, categories]);

  const [deficitChoices, setDeficitChoices] = useState<Record<string, "category" | "savings" | null>>({});

  if (!settings || !newPeriod) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">No pending period to confirm.</p>
        <Button onClick={() => go("home")}>Back to home</Button>
      </div>
    );
  }

  const confirmedSalary = adjustments.reduce((acc, a) => {
    const minor = parseMoneyToMinor(a.amount, settings.currency);
    if (minor === null) return acc;
    return acc + a.sign * minor;
  }, defaultSalary);

  // Build the allocation preview for the new period.
  const { preview, totalAllocatedMinor, unallocatedMinor } = buildAllocationPreview(
    categories,
    settings,
    confirmedSalary,
    carriedInByCategory,
    newPeriod.start_date
  );

  const overBudget = totalAllocatedMinor > confirmedSalary;

  // Borrow sources for deficit resolution.
  const savingsBalance = computeSavingsBalance(savingsLedger);
  const withdrawn = withdrawalsInPeriod(
    savingsLedger.filter((e) => e.period_start_date === prevPeriod?.start_date),
    prevPeriod?.start_date ?? ""
  );
  const capRemaining = remainingCap(withdrawn, settings.savings_withdrawal_cap_minor);

  async function handleConfirm() {
    if (!settings || !newPeriod) return;
    if (overBudget) {
      toast({ title: "Allocation exceeds salary", description: "Reduce allocations or increase salary.", variant: "destructive" });
      return;
    }
    // prevPeriod may be null when confirming the very first period.
    // Resolve deficit choices into deficit transfers.
    const deficitTransfers: import("@/lib/db/schema").Transfer[] = [];
    if (prevPeriod) {
      for (const row of prevDeficitRows) {
        const choice = deficitChoices[row.category_id];
        if (!choice) {
          continue;
        }
        const amount = Math.abs(row.remaining_minor);
        if (choice === "savings") {
          if (capRemaining !== null && amount > capRemaining) {
            toast({ title: "Savings cap exceeded", description: "Pick a different source.", variant: "destructive" });
            return;
          }
          if (amount > savingsBalance) {
            toast({ title: "Insufficient savings", description: "Pick a different source.", variant: "destructive" });
            return;
          }
          const t = await saveTransfer({
            periodStart: prevPeriod.start_date,
            fromKind: "savings",
            fromCategoryId: null,
            toCategoryId: row.category_id,
            amountMinor: amount,
            note: "Close-time deficit resolution",
          });
          deficitTransfers.push(t);
        } else if (choice === "category") {
          // Borrow from the largest available unprotected source.
          const sources = computeEffectiveBudget(
            data.allocations.filter((a) => a.period_start_date === prevPeriod.start_date),
            [...data.transfers.filter((t) => t.period_start_date === prevPeriod.start_date), ...deficitTransfers],
            data.expenses.filter((e) => e.date >= prevPeriod.start_date && e.date <= (prevPeriod.end_date ?? todayIso())),
            categories
          )
            .filter((r) => !r.protected && r.remaining_minor > 0 && r.category_id !== row.category_id)
            .sort((a, b) => b.remaining_minor - a.remaining_minor);
          const src = sources[0];
          if (!src || src.remaining_minor < amount) {
            toast({ title: "No source available", description: `Cannot cover deficit in ${row.category_name}.`, variant: "destructive" });
            return;
          }
          const t = await saveTransfer({
            periodStart: prevPeriod.start_date,
            fromKind: "category",
            fromCategoryId: src.category_id,
            toCategoryId: row.category_id,
            amountMinor: amount,
            note: "Close-time deficit resolution",
          });
          deficitTransfers.push(t);
        }
      }
    }
    try {
      await confirmPeriod({
        prevPeriod,
        newPeriod,
        categories,
        settings,
        confirmedSalaryMinor: confirmedSalary,
        salaryAdjustmentsMinor: adjustments.reduce((acc, a) => {
          const m = parseMoneyToMinor(a.amount, settings.currency);
          return acc + (m === null ? 0 : a.sign * m);
        }, 0),
        deficitTransfers,
        cutover,
      });
      toast({ title: "Period confirmed", description: `Started ${formatDisplayDate(cutover.kind === "now" ? todayIso() : cutover.kind === "tomorrow" ? addDays(todayIso(), 1) : newPeriod.start_date)}` });
      await refresh();
      go("home");
    } catch (e) {
      toast({ title: "Confirm failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  // Late open: offer backdated start option.
  const daysSinceConfigured = (() => {
    if (!newPeriod) return 0;
    const today = todayIso();
    const diff = Math.floor((new Date(today).getTime() - new Date(newPeriod.start_date).getTime()) / 86400000);
    return Math.max(0, diff);
  })();
  const showBackdatedOption = daysSinceConfigured > 1;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-2">
          <button onClick={() => go("home")} className="rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label="Back">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Confirm period</div>
            <div className="font-semibold tracking-tight">{formatDisplayDate(newPeriod.start_date)}</div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-4">
        {/* Step 1: Salary */}
        <section className="mb-6 space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">1. Confirm salary</h2>
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">Default salary</div>
                  <Money minor={defaultSalary} currency={settings.currency} className="text-lg font-semibold" />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setAdjustments([{ label: "", amount: "", sign: -1 }]);
                  }}
                >
                  Same as usual
                </Button>
              </div>

              <div className="space-y-2">
                {adjustments.map((adj, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAdjustments((arr) => arr.map((a, idx) => idx === i ? { ...a, sign: (a.sign === 1 ? -1 : 1) as 1 | -1 } : a))}
                    >
                      {adj.sign === 1 ? <Plus className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                      {adj.sign === 1 ? "Bonus" : "Deduct"}
                    </Button>
                    <MoneyInput
                      value={adj.amount}
                      onChange={(v) => setAdjustments((arr) => arr.map((a, idx) => idx === i ? { ...a, amount: v } : a))}
                      currency={settings.currency}
                      placeholder="0.00"
                      className="flex-1"
                      inputMode="decimal"
                    />
                    <Input
                      placeholder="Note (optional)"
                      value={adj.label}
                      onChange={(e) => setAdjustments((arr) => arr.map((a, idx) => idx === i ? { ...a, label: e.target.value } : a))}
                      className="flex-1"
                    />
                    {adjustments.length > 1 && (
                      <button
                        onClick={() => setAdjustments((arr) => arr.filter((_, idx) => idx !== i))}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
                        aria-label="Remove adjustment"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => setAdjustments((arr) => [...arr, { label: "", amount: "", sign: -1 }])}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add adjustment
                </Button>
              </div>

              <div className="rounded-lg bg-muted p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Confirmed salary</div>
                <Money minor={confirmedSalary} currency={settings.currency} className="text-xl font-semibold" />
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Step 2: Allocation preview */}
        <section className="mb-6 space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">2. Allocation preview</h2>
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {preview.map((p) => (
                <div key={p.categoryId} className="flex items-center justify-between p-3">
                  <div>
                    <div className="flex items-center gap-1.5 font-medium">
                      {p.categoryName}
                      {p.protected && <ShieldCheck className="h-3 w-3 text-emerald-500" />}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <Money minor={p.baseMinor} currency={settings.currency} /> base
                      {p.carriedInMinor > 0 && <> + <Money minor={p.carriedInMinor} currency={settings.currency} /> carried</>}
                      {" · "}
                      <span className="capitalize">{p.resolvedUnspentMode}</span>
                    </div>
                  </div>
                  <div className="text-right text-sm font-medium">
                    <Money minor={addMinor(p.baseMinor, p.carriedInMinor)} currency={settings.currency} />
                  </div>
                </div>
              ))}
              {preview.length === 0 && (
                <div className="p-3 text-sm text-muted-foreground">No categories set up.</div>
              )}
            </CardContent>
          </Card>
          <div className="rounded-lg border border-border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total allocated</span>
              <Money minor={totalAllocatedMinor} currency={settings.currency} className="font-medium" />
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">Unallocated (goes to savings at close)</span>
              <Money minor={unallocatedMinor} currency={settings.currency} className="font-medium" />
            </div>
            {overBudget && (
              <div className="mt-2 flex items-center gap-1.5 rounded-md bg-destructive/10 p-2 text-destructive">
                <AlertTriangle className="h-4 w-4" /> Allocation exceeds confirmed salary
              </div>
            )}
          </div>
        </section>

        {/* Step 3: Deficit resolution */}
        {prevDeficitRows.length > 0 && (
          <section className="mb-6 space-y-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">3. Resolve previous period deficits</h2>
            {prevDeficitRows.map((row) => (
              <Card key={row.category_id}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{row.category_name}</div>
                    <Money minor={row.remaining_minor} currency={settings.currency} className="font-medium text-destructive" signed />
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <Button
                      size="sm"
                      variant={deficitChoices[row.category_id] === "category" ? "default" : "outline"}
                      onClick={() => setDeficitChoices((m) => ({ ...m, [row.category_id]: "category" }))}
                    >
                      From category
                    </Button>
                    <Button
                      size="sm"
                      variant={deficitChoices[row.category_id] === "savings" ? "default" : "outline"}
                      disabled={savingsBalance === 0 || (capRemaining !== null && capRemaining === 0)}
                      onClick={() => setDeficitChoices((m) => ({ ...m, [row.category_id]: "savings" }))}
                    >
                      From savings
                    </Button>
                    <Button
                      size="sm"
                      variant={deficitChoices[row.category_id] === undefined ? "outline" : "ghost"}
                      onClick={() => setDeficitChoices((m) => { const c = { ...m }; delete c[row.category_id]; return c; })}
                    >
                      Leave as deficit
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>
        )}

        {/* Step 4: Cutover */}
        <section className="mb-6 space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{prevDeficitRows.length > 0 ? "4" : "3"}. Cutover</h2>
          <div className="grid grid-cols-2 gap-2">
            <Button variant={cutover.kind === "now" ? "default" : "outline"} onClick={() => setCutover({ kind: "now" })}>
              Start today
            </Button>
            <Button variant={cutover.kind === "tomorrow" ? "default" : "outline"} onClick={() => setCutover({ kind: "tomorrow" })}>
              Start tomorrow
            </Button>
            {showBackdatedOption && (
              <Button variant={cutover.kind === "configured" ? "default" : "outline"} onClick={() => setCutover({ kind: "configured" })} className="col-span-2">
                From configured date ({formatDisplayDate(newPeriod.start_date)})
              </Button>
            )}
            {!showBackdatedOption && (
              <Button variant={cutover.kind === "configured" ? "default" : "outline"} onClick={() => setCutover({ kind: "configured" })} className="col-span-2">
                From configured date
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">The override applies only to this period. The next period still follows your cycle day ({settings.cycle_day}).</p>
        </section>

        {/* Carry preview */}
        {carryPreview.length > 0 && (
          <section className="mb-6 space-y-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Carry-over from previous</h2>
            <Card>
              <CardContent className="divide-y divide-border p-0">
                {carryPreview.filter((c) => c.remainingMinor !== 0).map((c) => (
                  <div key={c.categoryId} className="flex items-center justify-between p-3">
                    <div>
                      <div className="font-medium">{c.categoryName}</div>
                      <div className="text-xs text-muted-foreground">
                        <Money minor={c.remainingMinor} currency={settings.currency} signed /> remaining
                        {" · "}
                        <span className="capitalize">{c.resolvedMode}</span>
                      </div>
                    </div>
                    <div className="text-right text-sm font-medium">
                      {c.carryToNextMinor > 0 ? (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          <Money minor={c.carryToNextMinor} currency={settings.currency} /> carry
                        </span>
                      ) : c.sweepAmountMinor > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400">
                          <Money minor={c.sweepAmountMinor} currency={settings.currency} /> sweep
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </div>
                  </div>
                ))}
                {carryPreview.every((c) => c.remainingMinor === 0) && (
                  <div className="p-3 text-sm text-muted-foreground">No leftover from previous period.</div>
                )}
              </CardContent>
            </Card>
          </section>
        )}
      </main>

      <footer className="sticky bottom-0 border-t border-border bg-background/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-2">
          <Button variant="ghost" onClick={() => go("home")}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={overBudget} className="flex-1">
            Confirm period <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </footer>
    </div>
  );
}
