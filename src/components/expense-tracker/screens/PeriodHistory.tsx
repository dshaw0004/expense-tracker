"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Money } from "../shared/Money";
import { useNav } from "@/lib/store/nav";
import { useAppData, type AppData } from "@/hooks/expense-tracker/useAppData";
import { computeEffectiveBudget } from "@/lib/budget/period";
import { ChevronLeft, ChevronDown, ChevronRight } from "lucide-react";
import { formatDisplayDate } from "@/lib/budget/dates";
import type { Period } from "@/lib/db/schema";
import { formatMoney } from "@/lib/budget/money";

interface PeriodHistoryProps {
  data: AppData;
}

export function PeriodHistory({ data }: PeriodHistoryProps) {
  const { go } = useNav();
  const { settings, periods, categories, allocations, transfers, expenses } = data;
  const [expanded, setExpanded] = useState<string | null>(null);

  const closed = useMemo(
    () => periods.filter((p) => p.status === "closed").sort((a, b) => (a.start_date < b.start_date ? 1 : -1)),
    [periods]
  );

  if (!settings) return null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-2">
          <button onClick={() => go("home")} className="rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label="Back">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Closed periods</div>
            <div className="font-semibold tracking-tight">History</div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-4">
        {closed.length === 0 && (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No closed periods yet. Confirm your next period to start history.
          </div>
        )}
        <div className="space-y-2">
          {closed.map((p) => (
            <PeriodRow
              key={p.start_date}
              period={p}
              expanded={expanded === p.start_date}
              onToggle={() => setExpanded(expanded === p.start_date ? null : p.start_date)}
              currency={settings.currency}
              categories={categories}
              allocations={allocations.filter((a) => a.period_start_date === p.start_date)}
              transfers={transfers.filter((t) => t.period_start_date === p.start_date)}
              expenses={expenses.filter((e) => e.date >= p.start_date && e.date <= (p.end_date ?? "9999-12-31"))}
            />
          ))}
        </div>
      </main>
    </div>
  );
}

interface PeriodRowProps {
  period: Period;
  expanded: boolean;
  onToggle: () => void;
  currency: string;
  categories: import("@/lib/db/schema").Category[];
  allocations: import("@/lib/db/schema").PeriodAllocation[];
  transfers: import("@/lib/db/schema").Transfer[];
  expenses: import("@/lib/db/schema").Expense[];
}

function PeriodRow({ period, expanded, onToggle, currency, categories, allocations, transfers, expenses }: PeriodRowProps) {
  const rows = computeEffectiveBudget(allocations, transfers, expenses, categories);
  const totalSpent = rows.reduce((acc, r) => acc + Math.max(0, r.expenses_minor), 0);
  const totalEffective = rows.reduce((acc, r) => acc + r.effective_minor, 0);
  const totalRemaining = rows.reduce((acc, r) => acc + r.remaining_minor, 0);
  return (
    <Card>
      <CardContent className="p-0">
        <button
          onClick={onToggle}
          className="flex w-full items-center justify-between p-3 text-left hover:bg-accent"
          aria-expanded={expanded}
        >
          <div>
            <div className="font-medium">{formatDisplayDate(period.start_date)}</div>
            <div className="text-xs text-muted-foreground">
              to {period.end_date ? formatDisplayDate(period.end_date) : "—"}
              {period.unresolved_deficit_minor > 0 && (
                <span className="ml-2 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-destructive">
                  Deficit {formatMoney(period.unresolved_deficit_minor, currency)}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="text-sm font-medium"><Money minor={totalSpent} currency={currency} /></div>
              <div className="text-xs text-muted-foreground">spent</div>
            </div>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>
        </button>
        {expanded && (
          <div className="border-t border-border p-3">
            <div className="mb-2 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-muted p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Effective</div>
                <div className="text-xs font-medium"><Money minor={totalEffective} currency={currency} /></div>
              </div>
              <div className="rounded-md bg-muted p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Spent</div>
                <div className="text-xs font-medium"><Money minor={totalSpent} currency={currency} /></div>
              </div>
              <div className={`rounded-md p-2 ${totalRemaining < 0 ? "bg-destructive/15" : "bg-muted"}`}>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Remaining</div>
                <div className="text-xs font-medium"><Money minor={totalRemaining} currency={currency} signed /></div>
              </div>
            </div>
            <div className="space-y-1">
              {rows.map((r) => (
                <div key={r.category_id} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{r.category_name}</span>
                  <span className={r.remaining_minor < 0 ? "text-destructive" : ""}>
                    <Money minor={r.remaining_minor} currency={currency} signed />
                  </span>
                </div>
              ))}
            </div>
            {period.unresolved_deficit_minor > 0 && (
              <div className="mt-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                Closed with unresolved deficit of <Money minor={period.unresolved_deficit_minor} currency={currency} />.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
