"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Money } from "./Money";
import { PiggyBank, ShieldCheck, AlertTriangle } from "lucide-react";
import type { Category } from "@/lib/db/schema";
import type { EffectiveBudgetRow } from "@/lib/budget/period";
import { cn } from "@/lib/utils";

export interface BorrowSource {
  kind: "category" | "savings";
  categoryId?: string;
  categoryName?: string;
  availableMinor: number;
}

interface BorrowSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sources: BorrowSource[];
  savingsBalanceMinor: number;
  savingsCapRemainingMinor: number | null;
  savingsWithdrawnThisPeriodMinor: number;
  savingsCapMinor: number | null;
  currency: string;
  deficitMinor: number;
  deficitCategoryName: string | null;
  onChoose: (source: BorrowSource, amount: number) => void;
  onDismiss?: () => void;
}

export function BorrowSheet({
  open,
  onOpenChange,
  sources,
  savingsBalanceMinor,
  savingsCapRemainingMinor,
  savingsWithdrawnThisPeriodMinor,
  savingsCapMinor,
  currency,
  deficitMinor,
  deficitCategoryName,
  onChoose,
  onDismiss,
}: BorrowSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex max-h-[85vh] flex-col gap-0 p-0">
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {deficitCategoryName ? `${deficitCategoryName} is over budget` : "Category over budget"}
          </SheetTitle>
          <SheetDescription>
            Borrow <Money minor={deficitMinor} currency={currency} /> from a category or the savings pool. Borrowing is a permanent transfer, not a loan — it is never repaid automatically.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-2">
          {sources.length === 0 && savingsBalanceMinor === 0 && (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No funds available to borrow from. Close this and consider editing your expense instead.
            </div>
          )}
          {sources.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Categories</p>
              {sources.map((s) => (
                <button
                  key={s.categoryId}
                  type="button"
                  onClick={() => onChoose(s, Math.min(deficitMinor, s.availableMinor))}
                  className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-left hover:bg-accent"
                >
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    <div>
                      <div className="font-medium">{s.categoryName}</div>
                      <div className="text-xs text-muted-foreground">
                        <Money minor={s.availableMinor} currency={currency} /> available
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-medium text-primary">
                    Borrow up to <Money minor={Math.min(deficitMinor, s.availableMinor)} currency={currency} />
                  </div>
                </button>
              ))}
            </div>
          )}
          {savingsBalanceMinor > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Savings pool</p>
                {savingsCapMinor !== null && (
                  <p className={cn("text-xs", (savingsCapRemainingMinor ?? 0) === 0 ? "text-amber-600" : "text-muted-foreground")}>
                    {savingsCapRemainingMinor === null ? "Cap off" : `Cap: ${savingsWithdrawnThisPeriodMinor} / ${savingsCapMinor} used`}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={savingsCapMinor !== null && (savingsCapRemainingMinor ?? 0) === 0}
                onClick={() => {
                  const cap = savingsCapRemainingMinor;
                  const maxByCap = cap === null ? savingsBalanceMinor : Math.min(cap, savingsBalanceMinor);
                  onChoose({ kind: "savings", availableMinor: maxByCap }, Math.min(deficitMinor, maxByCap));
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg border border-border p-3 text-left hover:bg-accent",
                  (savingsCapMinor !== null && (savingsCapRemainingMinor ?? 0) === 0) && "cursor-not-allowed opacity-50 hover:bg-transparent"
                )}
              >
                <div className="flex items-center gap-3">
                  <PiggyBank className="h-4 w-4 text-amber-500" />
                  <div>
                    <div className="font-medium">Savings pool</div>
                    <div className="text-xs text-muted-foreground">
                      <Money minor={savingsBalanceMinor} currency={currency} /> balance
                    </div>
                  </div>
                </div>
                {savingsCapMinor !== null && (savingsCapRemainingMinor ?? 0) === 0 ? (
                  <span className="text-xs text-amber-600">Cap reached</span>
                ) : (
                  <span className="text-sm font-medium text-primary">
                    Borrow up to <Money minor={Math.min(deficitMinor, savingsCapRemainingMinor === null ? savingsBalanceMinor : Math.min(savingsCapRemainingMinor, savingsBalanceMinor))} currency={currency} />
                  </span>
                )}
              </button>
            </div>
          )}
          {savingsBalanceMinor === 0 && sources.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">
              You have no unprotected categories with remaining balance and your savings pool is empty. The category will end this period with a deficit.
            </p>
          )}
        </div>
        {onDismiss && (
          <div className="border-t border-border p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
            <Button variant="ghost" className="w-full" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
