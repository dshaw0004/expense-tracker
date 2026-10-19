"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Money } from "./Money";
import { formatMoney } from "@/lib/budget/money";
import { formatDisplayDate } from "@/lib/budget/dates";
import type { Category, Expense } from "@/lib/db/schema";
import type { EffectiveBudgetRow } from "@/lib/budget/period";
import { Plus, Trash2, Calendar, Receipt, ShieldCheck, AlertCircle, ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface CategoryExpensesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: Category | null;
  row: EffectiveBudgetRow | null;
  expenses: Expense[];
  currency: string;
  onDeleteExpense: (expenseId: string) => Promise<void>;
  onQuickAdd: () => void;
}

export function CategoryExpensesSheet({
  open,
  onOpenChange,
  category,
  row,
  expenses,
  currency,
  onDeleteExpense,
  onQuickAdd,
}: CategoryExpensesSheetProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (!category || !row) return null;

  const sortedExpenses = [...expenses].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const over = row.remaining_minor < 0;

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await onDeleteExpense(id);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex max-h-[85vh] flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border px-4 pt-4 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SheetTitle className="text-lg font-semibold tracking-tight">{row.category_name}</SheetTitle>
              {row.protected && (
                <span className="flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                  <ShieldCheck className="h-3 w-3" /> Protected
                </span>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={onQuickAdd} className="h-8">
              <Plus className="mr-1 h-3.5 w-3.5" /> Add
            </Button>
          </div>
          <SheetDescription className="sr-only">
            Expenses and budget breakdown for {row.category_name}
          </SheetDescription>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-muted p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Spent</div>
              <div className="text-sm font-semibold">
                <Money minor={row.expenses_minor} currency={currency} />
              </div>
            </div>
            <div className="rounded-lg bg-muted p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Effective</div>
              <div className="text-sm font-semibold">
                <Money minor={row.effective_minor} currency={currency} />
              </div>
            </div>
            <div className={cn("rounded-lg p-2", over ? "bg-destructive/15 text-destructive" : "bg-muted")}>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Remaining</div>
              <div className="text-sm font-semibold">
                <Money minor={row.remaining_minor} currency={currency} signed />
              </div>
            </div>
          </div>

          {row.borrowed_in_minor > 0 && (
            <div className="mt-2 flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300">
              <ArrowRightLeft className="h-3.5 w-3.5 shrink-0" />
              <span>
                Includes <Money minor={row.borrowed_in_minor} currency={currency} /> borrowed from other envelopes or savings.
              </span>
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
              Logged Expenses ({sortedExpenses.length})
            </h3>
          </div>

          {sortedExpenses.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-8 text-center">
              <Receipt className="h-8 w-8 text-muted-foreground/60" />
              <p className="mt-2 text-sm font-medium">No expenses logged yet</p>
              <p className="text-xs text-muted-foreground">Tap &ldquo;Add&rdquo; to log your first spend in this envelope.</p>
              <Button size="sm" onClick={onQuickAdd} className="mt-4">
                <Plus className="mr-1 h-3.5 w-3.5" /> Log expense
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedExpenses.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-accent/50"
                >
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">{e.note ? e.note : "Expense"}</div>
                      <div className="text-xs text-muted-foreground">{formatDisplayDate(e.date)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums">
                      {formatMoney(e.amount_minor, currency)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      disabled={deletingId === e.id}
                      onClick={() => void handleDelete(e.id)}
                      aria-label="Delete expense"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          <Button variant="ghost" className="w-full" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
