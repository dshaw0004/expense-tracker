"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Money } from "../shared/Money";
import { useNav } from "@/lib/store/nav";
import { useAppData, type AppData } from "@/hooks/expense-tracker/useAppData";
import { computeSavingsBalance } from "@/lib/budget/savings";
import { ChevronLeft, PiggyBank, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatDisplayDate } from "@/lib/budget/dates";
import { formatMoney } from "@/lib/budget/money";

interface SavingsProps {
  data: AppData;
}

export function Savings({ data }: SavingsProps) {
  const { go } = useNav();
  const { settings, savingsLedger, categories } = data;

  const balance = useMemo(() => computeSavingsBalance(savingsLedger), [savingsLedger]);

  if (!settings) return null;

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-2">
          <button onClick={() => go("home")} className="rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label="Back">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Savings pool</div>
            <div className="font-semibold tracking-tight">Savings</div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-4">
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
              <PiggyBank className="h-4 w-4" /> Total balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Money minor={balance} currency={settings.currency} className="text-3xl font-semibold" />
            <p className="mt-1 text-xs text-muted-foreground">Derived from ledger entries. Savings can never go negative.</p>
          </CardContent>
        </Card>

        <h2 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Ledger</h2>
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {savingsLedger.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">No savings entries yet. Sweep in unspent money at period close, or transfer from savings to cover overspend.</div>
            )}
            {savingsLedger.map((e) => {
              const positive = e.kind === "sweep_in" || e.kind === "unallocated_in";
              return (
                <div key={e.id} className="flex items-center justify-between p-3">
                  <div className="flex items-start gap-2">
                    {positive ? (
                      <ArrowDownRight className="mt-0.5 h-4 w-4 text-emerald-500" />
                    ) : (
                      <ArrowUpRight className="mt-0.5 h-4 w-4 text-amber-500" />
                    )}
                    <div>
                      <div className="text-sm font-medium capitalize">{e.kind.replace("_", " ")}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDisplayDate(e.period_start_date)}
                        {e.source_category_id && ` · from ${catName(e.source_category_id)}`}
                      </div>
                    </div>
                  </div>
                  <div className={`text-sm font-medium ${positive ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {formatMoney(positive ? e.amount_minor : -e.amount_minor, settings.currency, { signed: true })}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
