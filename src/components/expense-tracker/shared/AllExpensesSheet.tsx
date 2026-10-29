"use client";

import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Money } from "./Money";
import { formatMoney } from "@/lib/budget/money";
import { formatDisplayDate } from "@/lib/budget/dates";
import type { Category, Expense } from "@/lib/db/schema";
import { Plus, Trash2, Calendar, Receipt, Search, Tag, X } from "lucide-react";

interface AllExpensesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expenses: Expense[];
  categories: Category[];
  currency: string;
  onDeleteExpense: (expenseId: string) => Promise<void>;
  onQuickAdd: () => void;
}

export function AllExpensesSheet({
  open,
  onOpenChange,
  expenses,
  categories,
  currency,
  onDeleteExpense,
  onQuickAdd,
}: AllExpensesSheetProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const categoryMap = useMemo(() => {
    return new Map(categories.map((c) => [c.id, c]));
  }, [categories]);

  const filteredExpenses = useMemo(() => {
    return expenses
      .filter((e) => {
        if (selectedCategoryId !== "all" && e.category_id !== selectedCategoryId) {
          return false;
        }
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const noteMatch = (e.note ?? "").toLowerCase().includes(q);
          const catName = (categoryMap.get(e.category_id)?.name ?? "").toLowerCase();
          const catMatch = catName.includes(q);
          return noteMatch || catMatch;
        }
        return true;
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [expenses, selectedCategoryId, searchQuery, categoryMap]);

  const totalFilteredSpent = useMemo(() => {
    return filteredExpenses.reduce((acc, e) => acc + Math.max(0, e.amount_minor), 0);
  }, [filteredExpenses]);

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
      <SheetContent side="bottom" className="flex max-h-[88vh] flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border px-4 pt-4 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle className="text-lg font-semibold tracking-tight">Period Transactions</SheetTitle>
              <SheetDescription className="text-xs text-muted-foreground">
                All transactions logged in the current active period
              </SheetDescription>
            </div>
            <Button size="sm" variant="outline" onClick={onQuickAdd} className="h-8">
              <Plus className="mr-1 h-3.5 w-3.5" /> Add
            </Button>
          </div>

          {/* Quick stats bar */}
          <div className="mt-3 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-muted p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total Spent</div>
              <div className="text-sm font-semibold">
                <Money minor={totalFilteredSpent} currency={currency} />
              </div>
            </div>
            <div className="rounded-lg bg-muted p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Transactions</div>
              <div className="text-sm font-semibold">
                {filteredExpenses.length} {filteredExpenses.length === 1 ? "item" : "items"}
              </div>
            </div>
          </div>

          {/* Search & Category Filter */}
          <div className="mt-3 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search note or category..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 pr-8 text-xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Category horizontal scroll pill filter */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-none">
              <button
                type="button"
                onClick={() => setSelectedCategoryId("all")}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedCategoryId === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                All
              </button>
              {categories.map((c) => {
                const isSelected = selectedCategoryId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedCategoryId(c.id)}
                    className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>
        </SheetHeader>

        {/* Expense list */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {filteredExpenses.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-center">
              <Receipt className="h-8 w-8 text-muted-foreground/60" />
              <p className="mt-2 text-sm font-medium">No transactions found</p>
              <p className="text-xs text-muted-foreground">
                {searchQuery || selectedCategoryId !== "all"
                  ? "Try clearing your filters."
                  : "Tap \"Add\" to log your first expense for this period."}
              </p>
              {!(searchQuery || selectedCategoryId !== "all") && (
                <Button size="sm" onClick={onQuickAdd} className="mt-4">
                  <Plus className="mr-1 h-3.5 w-3.5" /> Log expense
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredExpenses.map((e) => {
                const cat = categoryMap.get(e.category_id);
                return (
                  <div
                    key={e.id}
                    className="flex items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-accent/40"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{e.note ? e.note : "Expense"}</div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{formatDisplayDate(e.date)}</span>
                          <span>•</span>
                          <span className="flex items-center gap-0.5">
                            <Tag className="h-3 w-3" />
                            <span className="truncate max-w-[120px]">{cat?.name ?? "Uncategorized"}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
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
                );
              })}
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
