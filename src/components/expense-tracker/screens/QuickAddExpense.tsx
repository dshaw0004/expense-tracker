"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { MoneyInput } from "../shared/Money";
import { BorrowSheet, type BorrowSource } from "../shared/BorrowSheet";
import { useNav } from "@/lib/store/nav";
import { useAppData, type AppData } from "@/hooks/expense-tracker/useAppData";
import { parseMoneyToMinor, formatMoney } from "@/lib/budget/money";
import { todayIso, addDays, type IsoDate, nowTimestamp, uuid } from "@/lib/budget/dates";
import { computeEffectiveBudget, saveTransfer } from "@/lib/budget/period";
import { computeSavingsBalance, withdrawalsInPeriod, remainingCap } from "@/lib/budget/savings";
import * as db from "@/lib/db/db";
import type { Category, Expense, Transfer } from "@/lib/db/schema";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, Check, Calendar } from "lucide-react";

interface QuickAddProps {
  data: AppData;
}

export function QuickAddExpense({ data }: QuickAddProps) {
  const { go, payload } = useNav();
  const { settings, categories, activePeriod, expenses, transfers, allocations, savingsLedger, refresh } = data;
  const { toast } = useToast();

  const [amountStr, setAmountStr] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(payload?.categoryId as string | null);
  const [date, setDate] = useState<IsoDate>(todayIso());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [borrowOpen, setBorrowOpen] = useState(false);
  const [borrowSource, setBorrowSource] = useState<BorrowSource | null>(null);
  const [borrowAmount, setBorrowAmount] = useState(0);
  const [pendingExpense, setPendingExpense] = useState<Expense | null>(null);

  // Sync incoming payload.categoryId into local state. This is a sync-state-to-prop
  // pattern; the rule dislikes it but the alternative is uncontrolled inputs.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (payload?.categoryId) setCategoryId(payload.categoryId as string);
  }, [payload]);

  const visibleCategories = useMemo(() => categories.filter((c) => !c.archived), [categories]);

  if (!settings || !activePeriod) return null;

  // Compute current effective budget for the active period (for borrow lookup).
  const start = activePeriod.start_date;
  const end = activePeriod.end_date ?? todayIso();
  const periodExpenses = expenses.filter((e) => e.date >= start && e.date <= end);
  const periodTransfers = transfers.filter((t) => t.period_start_date === start);
  const periodAllocations = allocations.filter((a) => a.period_start_date === start);
  const rows = computeEffectiveBudget(periodAllocations, periodTransfers, periodExpenses, categories);

  // Available borrow sources: unprotected categories with positive remaining,
  // sorted by largest remaining balance first.
  const sources: BorrowSource[] = rows
    .filter((r) => !r.protected && r.remaining_minor > 0)
    .sort((a, b) => b.remaining_minor - a.remaining_minor)
    .map((r) => ({ kind: "category" as const, categoryId: r.category_id, categoryName: r.category_name, availableMinor: r.remaining_minor }));

  const savingsBalance = computeSavingsBalance(savingsLedger);
  const withdrawn = withdrawalsInPeriod(
    savingsLedger.filter((e) => e.period_start_date === start),
    start
  );
  const cap = settings.savings_withdrawal_cap_minor;
  const capRemaining = remainingCap(withdrawn, cap);

  async function handleSave() {
    if (!categoryId) {
      toast({ title: "Pick a category", variant: "destructive" });
      return;
    }
    const amount = parseMoneyToMinor(amountStr, settings!.currency);
    if (amount === null || amount <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    setSaving(true);
    const now = nowTimestamp();
    const exp: Expense = {
      id: uuid(),
      category_id: categoryId,
      amount_minor: amount,
      date,
      note: note.trim() || null,
      created_at: now,
    };
    await db.putExpense(exp);
    toast({ title: "Saved", description: `${formatMoney(amount, settings!.currency)} to ${categories.find((c) => c.id === categoryId)?.name ?? ""}` });
    setSaving(false);

    // Compute the resulting remaining to see if a borrow is needed.
    const targetRow = rows.find((r) => r.category_id === categoryId);
    const newRemaining = (targetRow?.remaining_minor ?? 0) - amount;
    if (newRemaining < 0) {
      // Deficit prompt.
      setPendingExpense(exp);
      setBorrowAmount(Math.abs(newRemaining));
      setBorrowOpen(true);
      return;
    }
    void refresh();
    reset();
    go("home");
  }

  function reset() {
    setAmountStr("");
    setNote("");
    setCategoryId(null);
    setDate(todayIso());
  }

  async function handleChooseBorrow(source: BorrowSource, amount: number) {
    setBorrowSource(source);
    setBorrowAmount(amount);
    if (!activePeriod || !categoryId) return;
    // Apply the transfer.
    let toCategoryId = categoryId;
    try {
      if (source.kind === "category" && source.categoryId) {
        await saveTransfer({
          periodStart: activePeriod.start_date,
          fromKind: "category",
          fromCategoryId: source.categoryId,
          toCategoryId,
          amountMinor: amount,
          note: `Borrowed to cover overspend`,
        });
        toast({
          title: "Borrowed from category",
          description: `${formatMoney(amount, settings!.currency)} from ${source.categoryName ?? "category"}`,
        });
      } else if (source.kind === "savings") {
        await saveTransfer({
          periodStart: activePeriod.start_date,
          fromKind: "savings",
          fromCategoryId: null,
          toCategoryId,
          amountMinor: amount,
          note: `Borrowed to cover overspend`,
        });
        toast({
          title: "Borrowed from savings",
          description: `${formatMoney(amount, settings!.currency)} from savings pool`,
        });
      }
    } catch (e) {
      toast({ title: "Borrow failed", description: (e as Error).message, variant: "destructive" });
    }
    setBorrowOpen(false);
    await refresh();
    reset();
    go("home");
  }

  return (
    <Sheet open onOpenChange={(v) => { if (!v) { void refresh(); go("home"); } }}>
      <SheetContent side="bottom" className="flex max-h-[90vh] flex-col gap-0 p-0">
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle className="flex items-center justify-between">
            <button onClick={() => { void refresh(); go("home"); }} className="rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label="Back">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span>Add expense</span>
            <span className="w-7" />
          </SheetTitle>
          <SheetDescription>Two taps to log a spend. Date defaults to today.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-2">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount</Label>
              <MoneyInput value={amountStr} onChange={setAmountStr} currency={settings.currency} placeholder="0.00" autoFocus inputMode="decimal" />
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <div className="grid grid-cols-2 gap-2">
                {visibleCategories.map((c) => {
                  const r = rows.find((row) => row.category_id === c.id);
                  const remaining = r?.remaining_minor;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setCategoryId(c.id)}
                      className={`rounded-lg border p-3 text-left transition-colors ${categoryId === c.id ? "border-primary bg-primary/5" : "border-border hover:bg-accent"}`}
                    >
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {remaining !== undefined ? (
                          <span className={remaining < 0 ? "text-destructive" : ""}>
                            {formatMoney(remaining, settings.currency)} left
                          </span>
                        ) : (
                          "no allocation"
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <div className="flex items-center gap-2">
                <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value as IsoDate)} className="flex-1" />
                <Button variant="outline" size="sm" onClick={() => setDate(todayIso())}>
                  <Calendar className="mr-1 h-3.5 w-3.5" /> Today
                </Button>
              </div>
              <div className="flex gap-1.5">
                {[-1, -2, -3].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDate(addDays(todayIso(), d))}
                    className={`rounded-full px-2 py-1 text-xs ${date === addDays(todayIso(), d) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  >
                    {d === -1 ? "Yesterday" : `${d}d ago`}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="note">Note (optional)</Label>
              <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was this for?" className="min-h-[60px]" />
            </div>
          </div>
        </div>

        <div className="border-t border-border p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          <Button onClick={handleSave} disabled={saving || !amountStr} className="w-full">
            <Check className="mr-1 h-4 w-4" /> Save expense
          </Button>
        </div>
      </SheetContent>
      <BorrowSheet
        open={borrowOpen}
        onOpenChange={setBorrowOpen}
        sources={sources}
        savingsBalanceMinor={savingsBalance}
        savingsCapRemainingMinor={capRemaining}
        savingsWithdrawnThisPeriodMinor={withdrawn}
        savingsCapMinor={cap}
        currency={settings.currency}
        deficitMinor={borrowAmount}
        deficitCategoryName={categories.find((c) => c.id === categoryId)?.name ?? null}
        onChoose={handleChooseBorrow}
        onDismiss={async () => {
          setBorrowOpen(false);
          await refresh();
          reset();
          go("home");
        }}
      />
    </Sheet>
  );
}
