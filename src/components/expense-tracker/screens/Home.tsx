"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Money } from "../shared/Money";
import { ProgressBar } from "../shared/ProgressBar";
import { useNav } from "@/lib/store/nav";
import { computeEffectiveBudget, type EffectiveBudgetRow } from "@/lib/budget/period";
import { computeSavingsBalance } from "@/lib/budget/savings";
import { todayIso, daysLeftInPeriod, periodLengthDays, formatDisplayDate, addDays, nextPeriodStart } from "@/lib/budget/dates";
import type { AppData } from "@/hooks/expense-tracker/useAppData";
import { Plus, AlertTriangle, PiggyBank, ChevronRight, CalendarClock, History, Download, Receipt } from "lucide-react";
import { daysSinceExport } from "@/lib/budget/persistence";
import { CategoryExpensesSheet } from "../shared/CategoryExpensesSheet";
import { AllExpensesSheet } from "../shared/AllExpensesSheet";
import * as db from "@/lib/db/db";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface HomeProps {
  data: AppData;
}

export function Home({ data }: HomeProps) {
  const { go } = useNav();
  const { toast } = useToast();
  const { settings, activePeriod, categories, pendingPeriods, savingsLedger } = data;
  const [inspectCategoryId, setInspectCategoryId] = useState<string | null>(null);
  const [showAllExpenses, setShowAllExpenses] = useState(false);

  const { periodExpenses, periodTransfers, periodAllocations } = useActivePeriodFiltered(activePeriod, data);

  const rows: EffectiveBudgetRow[] = useMemo(() => {
    if (!activePeriod) return [];
    return computeEffectiveBudget(periodAllocations, periodTransfers, periodExpenses, categories);
  }, [activePeriod, periodAllocations, periodTransfers, periodExpenses, categories]);

  const savingsBalance = useMemo(() => computeSavingsBalance(savingsLedger), [savingsLedger]);

  if (!settings) return null;

  // No active period — user needs to confirm a pending period.
  if (!activePeriod) {
    return (
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-border bg-background/95 px-4 py-4 backdrop-blur">
          <div className="mx-auto max-w-md">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Welcome back</div>
                <div className="font-semibold tracking-tight">Envelope</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => go("settings")}>
                <PiggyBank className="mr-1 h-4 w-4" /> Settings
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-10 text-center">
          <CalendarClock className="h-12 w-12 text-muted-foreground" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            {pendingPeriods.length > 0 ? "Confirm your new period" : "No active period yet"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {pendingPeriods.length > 0
              ? `You have ${pendingPeriods.length} pending period${pendingPeriods.length > 1 ? "s" : ""} to confirm. Carry over leftover, sweep into savings, and lock the previous period.`
              : "Adjust your cycle day in Settings to generate the first period."}
          </p>
          {pendingPeriods.length > 0 && (
            <Button className="mt-6" onClick={() => go("confirm-period", { start: pendingPeriods[0].start_date })}>
              Confirm period <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </main>
      </div>
    );
  }

  // Compute total spent in active period across all categories.
  const totalSpent = rows.reduce((acc, r) => acc + Math.max(0, r.expenses_minor), 0);
  const totalEffective = rows.reduce((acc, r) => acc + Math.max(0, r.effective_minor), 0);
  const totalRemaining = rows.reduce((acc, r) => acc + r.remaining_minor, 0);

  const today = todayIso();
  const effectiveEndDate =
    activePeriod.end_date ??
    addDays(nextPeriodStart(activePeriod.start_date, settings.cycle_day), -1);
  const daysLeft = daysLeftInPeriod(activePeriod.start_date, effectiveEndDate, today);
  const realDays = periodLengthDays(activePeriod.start_date, effectiveEndDate);

  // Backup nudge: show a banner when last export is old.
  const daysSinceExported = daysSinceExport(settings.last_exported_at);
  const showBackupBanner =
    daysSinceExported === null || daysSinceExported > settings.backup_reminder_days;

  const inspectedCategory = categories.find((c) => c.id === inspectCategoryId) ?? null;
  const inspectedRow = rows.find((r) => r.category_id === inspectCategoryId) ?? null;
  const inspectedExpenses = periodExpenses.filter((e) => e.category_id === inspectCategoryId);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-background/95 px-4 py-4 backdrop-blur">
        <div className="mx-auto max-w-md">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Period since</div>
              <div className="font-semibold tracking-tight">{formatDisplayDate(activePeriod.start_date)}</div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => go("savings")}>
                <PiggyBank className="mr-1 h-4 w-4" />
                <Money minor={savingsBalance} currency={settings.currency} />
              </Button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <button
              type="button"
              onClick={() => setShowAllExpenses(true)}
              className="group rounded-lg bg-muted p-2 text-center transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="View all transactions for this period"
            >
              <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground group-hover:text-foreground">
                <span>Spent</span>
                <Receipt className="h-2.5 w-2.5 opacity-60 group-hover:opacity-100" />
              </div>
              <div className="text-sm font-semibold"><Money minor={totalSpent} currency={settings.currency} /></div>
            </button>
            <div className="rounded-lg bg-muted p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</div>
              <div className="text-sm font-semibold"><Money minor={totalEffective} currency={settings.currency} /></div>
            </div>
            <div className={cn("rounded-lg p-2", totalRemaining < 0 ? "bg-destructive/15" : "bg-muted")}>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Left</div>
              <div className="text-sm font-semibold"><Money minor={totalRemaining} currency={settings.currency} signed /></div>
            </div>
          </div>
        </div>
      </header>

      {showBackupBanner && (
        <div className="mx-auto mt-3 w-full max-w-md px-4">
          <Alert className="border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            <Download className="h-4 w-4" />
            <AlertTitle>Back up your data</AlertTitle>
            <AlertDescription>
              {daysSinceExported === null
                ? "You haven't exported your data yet. Local storage can be cleared by your browser — export now to keep it safe."
                : `Last exported ${daysSinceExported} days ago. Consider exporting your data again to stay safe.`}
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={() => go("settings")}>
                  Go to Settings
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {pendingPeriods.length > 0 && (
        <div className="mx-auto mt-3 w-full max-w-md px-4">
          <Alert>
            <CalendarClock className="h-4 w-4" />
            <AlertTitle>New period awaiting confirmation</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-2">
              <span>You have {pendingPeriods.length} period{pendingPeriods.length > 1 ? "s" : ""} to confirm.</span>
              <Button size="sm" onClick={() => go("confirm-period", { start: pendingPeriods[0].start_date })}>
                Confirm
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Envelopes</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAllExpenses(true)}
              className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Receipt className="mr-1 h-3 w-3" />
              Transactions ({periodExpenses.length})
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">
            {daysLeft > 0 ? `${daysLeft} days left (${realDays}-day period)` : `Period ended · ${realDays} days`}
          </span>
        </div>
        <div className="space-y-2">
          {rows.map((r) => (
            <CategoryCard
              key={r.category_id}
              row={r}
              currency={settings.currency}
              daysLeft={daysLeft}
              onInspect={() => setInspectCategoryId(r.category_id)}
              onQuickAdd={() => go("quick-add", { categoryId: r.category_id })}
            />
          ))}
          {rows.length === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No categories yet. Add some in Settings.
            </div>
          )}
        </div>
      </main>

      <CategoryExpensesSheet
        open={inspectCategoryId !== null}
        onOpenChange={(open) => !open && setInspectCategoryId(null)}
        category={inspectedCategory}
        row={inspectedRow}
        expenses={inspectedExpenses}
        currency={settings.currency}
        onQuickAdd={() => {
          const id = inspectCategoryId;
          setInspectCategoryId(null);
          if (id) go("quick-add", { categoryId: id });
        }}
        onDeleteExpense={async (id) => {
          await db.deleteExpense(id);
          if (inspectedRow && inspectedRow.borrowed_in_minor > 0) {
            toast({
              title: "Expense deleted",
              description: "Hint: This envelope previously borrowed funds — that transfer may no longer be needed.",
            });
          } else {
            toast({ title: "Expense deleted" });
          }
          await data.refresh();
        }}
      />

      <AllExpensesSheet
        open={showAllExpenses}
        onOpenChange={setShowAllExpenses}
        expenses={periodExpenses}
        categories={categories}
        currency={settings.currency}
        onQuickAdd={() => {
          setShowAllExpenses(false);
          go("quick-add");
        }}
        onDeleteExpense={async (id) => {
          await db.deleteExpense(id);
          toast({ title: "Expense deleted" });
          await data.refresh();
        }}
      />
    </div>
  );
}

function CategoryCard({
  row,
  currency,
  daysLeft,
  onInspect,
  onQuickAdd,
}: {
  row: EffectiveBudgetRow;
  currency: string;
  daysLeft: number;
  onInspect: () => void;
  onQuickAdd: () => void;
}) {
  const over = row.remaining_minor < 0;
  const pct = row.effective_minor > 0 ? Math.round((row.expenses_minor / row.effective_minor) * 100) : 0;
  const warn80 = !over && pct >= 80;
  const safeToSpend = daysLeft > 0 ? Math.floor(row.remaining_minor / daysLeft) : row.remaining_minor;
  return (
    <Card
      className={cn(
        "cursor-pointer transition-colors hover:border-primary/50",
        over && "border-destructive/40 hover:border-destructive"
      )}
      onClick={onInspect}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{row.category_name}</span>
              {row.protected && (
                <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Protected</span>
              )}
              {row.borrowed_in_minor > 0 && (
                <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-amber-700 dark:text-amber-300">Borrowed</span>
              )}
              {row.lent_out_minor > 0 && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">Lent</span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              <Money minor={row.base_minor} currency={currency} /> base
              {row.carried_in_minor > 0 && <> + <Money minor={row.carried_in_minor} currency={currency} /> carried</>}
              {row.borrowed_in_minor > 0 && <> + <Money minor={row.borrowed_in_minor} currency={currency} /> borrowed</>}
              {row.lent_out_minor > 0 && <> − <Money minor={row.lent_out_minor} currency={currency} /> lent</>}
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onQuickAdd();
            }}
            aria-label={`Add expense to ${row.category_name}`}
            className="rounded-full p-1 transition-transform active:scale-95"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
              <Plus className="h-4 w-4" />
            </span>
          </button>
        </div>
        <div className="mt-3 flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Remaining</div>
            <div className={cn("text-xl font-semibold", over && "text-destructive")}>
              <Money minor={row.remaining_minor} currency={currency} signed />
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Safe to spend / day</div>
            <div className={cn("text-sm font-medium", safeToSpend < 0 && "text-destructive")}>
              <Money minor={safeToSpend} currency={currency} />
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <ProgressBar used={row.expenses_minor} total={row.effective_minor} className="flex-1" />
          <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
        </div>
        {over && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" /> Over budget
          </div>
        )}
        {warn80 && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" /> Approaching budget limit ({pct}%)
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Helper hook — extract period-relevant rows.
function useActivePeriodFiltered(activePeriod: { start_date: string; end_date: string | null } | null, data: AppData) {
  return useMemo(() => {
    if (!activePeriod) return { periodExpenses: [], periodTransfers: [], periodAllocations: [] };
    const start = activePeriod.start_date;
    const end = activePeriod.end_date ?? "9999-12-31";
    return {
      periodExpenses: data.expenses.filter((e) => e.date >= start && e.date <= end),
      periodTransfers: data.transfers.filter((t) => t.period_start_date === start),
      periodAllocations: data.allocations.filter((a) => a.period_start_date === start),
    };
  }, [activePeriod, data.expenses, data.transfers, data.allocations]);
}
