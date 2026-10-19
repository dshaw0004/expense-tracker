"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2, ArrowRight, ArrowLeft } from "lucide-react";
import { MoneyInput } from "../shared/Money";
import { listCurrencies, getCurrency, parseMoneyToMinor, basisPointsToPercent, percentToBasisPoints } from "@/lib/budget/money";
import type { Category, Settings } from "@/lib/db/schema";
import { nowTimestamp, uuid } from "@/lib/budget/dates";
import * as db from "@/lib/db/db";
import { useToast } from "@/hooks/use-toast";
import { navigatorStoragePersist } from "@/lib/budget/persistence";

interface OnboardingProps {
  onComplete: () => void;
}

type DraftCategory = Omit<Category, "id" | "created_at" | "sort_order" | "archived"> & {
  tempId: string;
};

const DEFAULT_CATEGORIES: DraftCategory[] = [
  { tempId: "1", name: "Rent", type: "fixed", value: 0, unspent_mode: null, protected: true },
  { tempId: "2", name: "Food", type: "percent", value: percentToBasisPoints(30), unspent_mode: "rollover", protected: false },
  { tempId: "3", name: "Commute", type: "percent", value: percentToBasisPoints(10), unspent_mode: "sweep", protected: false },
  { tempId: "4", name: "Non-essentials", type: "percent", value: percentToBasisPoints(15), unspent_mode: "sweep", protected: false },
  { tempId: "5", name: "Savings", type: "remainder", value: 0, unspent_mode: "rollover", protected: false },
];

const STEPS = ["Currency", "Salary & Cycle", "Categories", "Unspent mode"] as const;

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [currency, setCurrency] = useState("INR");
  const [salaryStr, setSalaryStr] = useState("");
  const [cycleDay, setCycleDay] = useState(1);
  const [categories, setCategories] = useState<DraftCategory[]>(DEFAULT_CATEGORIES);
  const [globalMode, setGlobalMode] = useState<"rollover" | "sweep">("sweep");
  const [savingsCapStr, setSavingsCapStr] = useState("");
  const { toast } = useToast();

  // Request storage persistence on first interaction.
  useEffect(() => {
    void navigatorStoragePersist();
  }, []);

  function addCategory() {
    setCategories((cs) => [
      ...cs,
      { tempId: String(Date.now()), name: "", type: "fixed", value: 0, unspent_mode: null, protected: false },
    ]);
  }

  function removeCategory(tempId: string) {
    setCategories((cs) => cs.filter((c) => c.tempId !== tempId));
  }

  function patchCategory(tempId: string, patch: Partial<DraftCategory>) {
    setCategories((cs) => cs.map((c) => (c.tempId === tempId ? { ...c, ...patch } : c)));
  }

  function next() {
    if (step === 0) {
      if (!currency) {
        toast({ title: "Pick a currency", description: "Choose your local currency.", variant: "destructive" });
        return;
      }
    }
    if (step === 1) {
      const salary = parseMoneyToMinor(salaryStr, currency);
      if (salary === null || salary <= 0) {
        toast({ title: "Enter your in-hand salary", description: "We need a positive monthly salary to compute allocations.", variant: "destructive" });
        return;
      }
      if (cycleDay < 1 || cycleDay > 31) {
        toast({ title: "Invalid cycle day", description: "Cycle day must be 1–31.", variant: "destructive" });
        return;
      }
    }
    if (step === 2) {
      // Validate: names non-empty, no duplicates.
      const names = categories.map((c) => c.name.trim()).filter(Boolean);
      if (names.length !== categories.length) {
        toast({ title: "All categories need a name", variant: "destructive" });
        return;
      }
      const unique = new Set(names);
      if (unique.size !== names.length) {
        toast({ title: "Category names must be unique", variant: "destructive" });
        return;
      }
      // At most one remainder category.
      if (categories.filter((c) => c.type === "remainder").length > 1) {
        toast({ title: "Only one Remainder category allowed", variant: "destructive" });
        return;
      }
      // Validate percent/fixed values are positive.
      for (const c of categories) {
        if (c.type !== "remainder" && c.value < 0) {
          toast({ title: `${c.name} has a negative value`, variant: "destructive" });
          return;
        }
        if (c.type === "percent" && c.value > 10000) {
          toast({ title: `${c.name} exceeds 100%`, variant: "destructive" });
          return;
        }
      }
    }
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else void finish();
  }

  async function finish() {
    const salary = parseMoneyToMinor(salaryStr, currency)!;
    const cap = savingsCapStr.trim() ? parseMoneyToMinor(savingsCapStr, currency) : null;
    if (cap !== null && cap < 0) {
      toast({ title: "Invalid savings cap", variant: "destructive" });
      return;
    }

    // Verify allocation fits salary: percent + fixed must not exceed salary.
    // (Remainder always absorbs the rest so it can't overflow.)
    const totalFixed = categories.filter((c) => c.type === "fixed").reduce((a, c) => a + Math.max(0, c.value), 0);
    const totalPercentBps = categories.filter((c) => c.type === "percent").reduce((a, c) => a + c.value, 0);
    const allocatedMinor = Math.trunc((salary * totalPercentBps) / 10000) + totalFixed;
    if (allocatedMinor > salary) {
      toast({ title: "Allocation exceeds salary", description: "Total allocated is more than your confirmed salary.", variant: "destructive" });
      setStep(2);
      return;
    }

    const now = nowTimestamp();
    const settings: Settings = {
      schema_version: 1,
      currency,
      cycle_day: cycleDay,
      default_salary_minor: salary,
      global_unspent_mode: globalMode,
      savings_withdrawal_cap_minor: cap,
      last_exported_at: null,
      backup_reminder_days: 30,
      created_at: now,
    };

    const catRecords: Category[] = categories.map((c, i) => ({
      id: uuid(),
      name: c.name.trim(),
      type: c.type,
      value: Math.trunc(c.value),
      unspent_mode: c.unspent_mode,
      protected: c.protected,
      sort_order: i,
      archived: false,
      created_at: now,
    }));

    await db.putSettings(settings);
    for (const c of catRecords) await db.putCategory(c);
    toast({ title: "Welcome aboard", description: "Your budget is set up." });
    onComplete();
  }

  const cur = getCurrency(currency);
  const totalFixedMinor = categories.filter((c) => c.type === "fixed").reduce((a, c) => a + Math.max(0, c.value), 0);
  const totalPercentBps = categories.filter((c) => c.type === "percent").reduce((a, c) => a + c.value, 0);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/95 px-4 py-4 backdrop-blur">
        <div className="mx-auto max-w-md">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <span className="font-semibold">₹</span>
            </div>
            <div className="flex-1">
              <div className="font-semibold tracking-tight">Envelope</div>
              <div className="text-xs text-muted-foreground">Local-first budgeting</div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-1.5">
            {STEPS.map((label, i) => (
              <button
                key={label}
                onClick={() => i < step && setStep(i)}
                className={`flex h-1.5 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`}
                aria-label={`Step ${i + 1}: ${label}`}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Step {step + 1} of {STEPS.length}</p>
            <p className="text-xs text-muted-foreground">{STEPS[step]}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 py-6">
        {step === 0 && (
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Pick your currency</h1>
              <p className="text-sm text-muted-foreground">All amounts will be stored in paise (integer minor units). You can&apos;t change currency per data set in v1.</p>
            </div>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Currency" />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {listCurrencies().map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    <span className="flex items-center justify-between gap-2">
                      <span>{c.symbol} {c.code}</span>
                      <span className="text-xs text-muted-foreground">{c.fractionDigits}dp</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Salary & cycle</h1>
              <p className="text-sm text-muted-foreground">We&apos;ll confirm the actual number each period — this is just the default.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="salary">Default in-hand salary (per month)</Label>
              <MoneyInput value={salaryStr} onChange={setSalaryStr} currency={currency} placeholder="0.00" autoFocus inputMode="decimal" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cycle-day">Cycle day (1–31)</Label>
              <Input id="cycle-day" type="number" min={1} max={31} value={cycleDay} onChange={(e) => setCycleDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))} inputMode="numeric" />
              <p className="text-xs text-muted-foreground">If the day doesn&apos;t exist in a month (e.g. 31 in February), it triggers on the last day, then returns to your chosen day.</p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Set up envelopes</h1>
              <p className="text-sm text-muted-foreground">Each category is an envelope. Percent is a slice of full salary; Fixed is an exact amount. Protected envelopes cannot lend out (rent, EMI).</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Total allocated</div>
              <div className="mt-1 text-lg font-semibold">
                {(() => {
                  const fmt = new Intl.NumberFormat(undefined, {
                    minimumFractionDigits: cur.fractionDigits,
                    maximumFractionDigits: cur.fractionDigits,
                  });
                  const salaryMinor = parseMoneyToMinor(salaryStr, currency) ?? 0;
                  const hasRemainder = categories.some((c) => c.type === "remainder");
                  // If a remainder category exists it absorbs everything, so total = salary.
                  const allocatedMinor = hasRemainder
                    ? salaryMinor
                    : Math.round(salaryMinor * totalPercentBps / 10000 + totalFixedMinor);
                  const divisor = Math.pow(10, cur.fractionDigits);
                  return `${cur.symbol} ${fmt.format(allocatedMinor / divisor)} / ${cur.symbol} ${fmt.format(salaryMinor / divisor)}`;
                })()}
              </div>
              {totalPercentBps > 10000 && (
                <p className="mt-1 text-xs text-destructive">Total percentage exceeds 100%.</p>
              )}
            </div>
            <div className="space-y-2">
              {categories.map((c) => (
                <Card key={c.tempId} className="p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-2">
                      <Input
                        placeholder="Category name"
                        value={c.name}
                        onChange={(e) => patchCategory(c.tempId, { name: e.target.value })}
                      />
                      {c.type === "remainder" ? (
                        <div className="flex items-center gap-2">
                          <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
                            Remainder — absorbs unallocated salary
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Select value={c.type} onValueChange={(v) => patchCategory(c.tempId, { type: v as "percent" | "fixed" | "remainder" })}>
                            <SelectTrigger className="h-9 w-[110px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="percent">Percent</SelectItem>
                              <SelectItem value="fixed">Fixed</SelectItem>
                              {!categories.some((cat) => cat.type === "remainder" && cat.tempId !== c.tempId) && (
                                <SelectItem value="remainder">Remainder</SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                          <Input
                            type="number"
                            inputMode="decimal"
                            placeholder={c.type === "percent" ? "30" : "5000"}
                            value={c.type === "percent" ? basisPointsToPercent(c.value) : Math.trunc(c.value / Math.pow(10, cur.fractionDigits))}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (c.type === "percent") {
                                patchCategory(c.tempId, { value: percentToBasisPoints(v) });
                              } else {
                                patchCategory(c.tempId, { value: Math.trunc(v * Math.pow(10, cur.fractionDigits)) });
                              }
                            }}
                          />
                          {c.type === "percent" && <span className="self-center text-sm text-muted-foreground">%</span>}
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Switch checked={c.protected} onCheckedChange={(v) => patchCategory(c.tempId, { protected: v })} />
                          Protected
                        </Label>
                        <Select value={c.unspent_mode ?? "inherit"} onValueChange={(v) => patchCategory(c.tempId, { unspent_mode: v === "inherit" ? null : v as "rollover" | "sweep" })}>
                          <SelectTrigger className="h-8 w-[130px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inherit">Inherit global</SelectItem>
                            <SelectItem value="rollover">Rollover</SelectItem>
                            <SelectItem value="sweep">Sweep</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <button
                      onClick={() => removeCategory(c.tempId)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label="Remove category"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </Card>
              ))}
            </div>
            <Button variant="outline" className="w-full" onClick={addCategory}>
              <Plus className="mr-1 h-4 w-4" /> Add category
            </Button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Unspent mode</h1>
              <p className="text-sm text-muted-foreground">When a period closes, what happens to leftover money?</p>
            </div>
            <Card className="overflow-hidden">
              <button onClick={() => setGlobalMode("rollover")} className={`w-full p-4 text-left transition-colors ${globalMode === "rollover" ? "bg-accent" : "hover:bg-accent/50"}`}>
                <div className="font-medium">Rollover</div>
                <div className="text-sm text-muted-foreground">Leftover money rolls into the same category next period. Best for groceries, commute — things you spend in waves.</div>
              </button>
            </Card>
            <Card className="overflow-hidden">
              <button onClick={() => setGlobalMode("sweep")} className={`w-full p-4 text-left transition-colors ${globalMode === "sweep" ? "bg-accent" : "hover:bg-accent/50"}`}>
                <div className="font-medium">Sweep</div>
                <div className="text-sm text-muted-foreground">Leftover money sweeps into the savings pool. Best for non-essentials — you don&apos;t want to reward yourself with overspend next period.</div>
              </button>
            </Card>
            <div className="space-y-2">
              <Label htmlFor="cap">Savings withdrawal cap (optional)</Label>
              <MoneyInput value={savingsCapStr} onChange={setSavingsCapStr} currency={currency} placeholder="No cap" inputMode="decimal" />
              <p className="text-xs text-muted-foreground">A hard limit on how much you can pull out of savings per period via transfers. Leave empty for no cap.</p>
            </div>
          </div>
        )}
      </main>

      <footer className="sticky bottom-0 border-t border-border bg-background/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-2">
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          )}
          <Button onClick={next} className="flex-1">
            {step === STEPS.length - 1 ? "Get started" : "Continue"}
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </footer>
    </div>
  );
}
