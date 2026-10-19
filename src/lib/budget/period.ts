// Period lifecycle: mount check, confirmation, cutover, closing.
// Single-transaction mount check makes period creation idempotent across tabs.
// The period start_date is the primary key, so two open tabs cannot double-create.

import type {
  Category,
  Expense,
  Period,
  PeriodAllocation,
  Settings,
  Transfer,
  SavingsLedgerEntry,
} from "../db/schema";
import {
  clampCycleDay,
  latestPeriodStart,
  nextPeriodStart,
  previousPeriodStart,
  todayIso,
  type IsoDate,
  addDays,
  isoCompare,
  nowTimestamp,
  uuid,
} from "./dates";
import { addMinor, subMinor } from "./money";
import { computeBaseAllocation, resolveUnspentMode } from "./allocation";
import * as db from "../db/db";

// === Mount check ============================================================
// On app mount, in a single transaction:
//   1. Compute the latest period start date <= today.
//   2. If no periods exist yet, create the first pending period at that date.
//   3. If periods are missing between the last known period and that date,
//      create pending periods sequentially, one per missed cycle.
//   4. Idempotent because start_date is the primary key.
//
// Returns the list of pending periods awaiting confirmation (oldest first).
export interface MountCheckResult {
  pendingPeriods: Period[];
  activePeriod: Period | null;
}

export async function runMountCheck(): Promise<MountCheckResult> {
  const settings = await db.getSettings();
  if (!settings) {
    return { pendingPeriods: [], activePeriod: null };
  }

  const today = todayIso();
  const targetStart = latestPeriodStart(today, settings.cycle_day);

  // Run mount check and missing period creation in a single IndexedDB transaction
  await db.rwTx(["periods"], async (tx) => {
    const store = tx.objectStore("periods");
    const allPeriods = await store.getAll();

    if (allPeriods.length === 0) {
      // First-run case: create the first pending period at targetStart.
      const first: Period = {
        start_date: targetStart,
        end_date: null,
        status: "pending",
        salary_default_minor: settings.default_salary_minor,
        salary_adjustments_minor: 0,
        salary_confirmed_minor: null,
        unallocated_minor: 0,
        unresolved_deficit_minor: 0,
        confirmed_at: null,
        closed_at: null,
      };
      await store.put(first);
      return;
    }

    // Find the latest period whose start_date <= today.
    const sorted = [...allPeriods].sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
    let lastKnown = sorted[sorted.length - 1];
    while (lastKnown && isoCompare(lastKnown.start_date, today) > 0 && sorted.length > 0) {
      sorted.pop();
      lastKnown = sorted[sorted.length - 1];
    }

    // If the latest known period is before target start, create missing pending periods sequentially.
    if (!lastKnown || isoCompare(lastKnown.start_date, targetStart) < 0) {
      let cursor = lastKnown ? nextPeriodStart(lastKnown.start_date, settings.cycle_day) : targetStart;
      while (isoCompare(cursor, targetStart) <= 0) {
        const p: Period = {
          start_date: cursor,
          end_date: null,
          status: "pending",
          salary_default_minor: settings.default_salary_minor,
          salary_adjustments_minor: 0,
          salary_confirmed_minor: null,
          unallocated_minor: 0,
          unresolved_deficit_minor: 0,
          confirmed_at: null,
          closed_at: null,
        };
        await store.put(p);
        cursor = nextPeriodStart(cursor, settings.cycle_day);
      }
    }
  });

  // Reload after transaction commits.
  const all = await db.getAllPeriods();
  const pending = all.filter((p) => p.status === "pending").sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const active = all.find((p) => p.status === "active") ?? null;
  return { pendingPeriods: pending, activePeriod: active };
}

// === Effective budget computation ==========================================

export interface EffectiveBudgetRow {
  category_id: string;
  category_name: string;
  base_minor: number;
  carried_in_minor: number;
  borrowed_in_minor: number;
  lent_out_minor: number;
  expenses_minor: number;
  effective_minor: number;
  remaining_minor: number;
  protected: boolean;
  rule_type: "percent" | "fixed" | "remainder";
  rule_value: number;
}

// Compute the per-category effective budget for a period from raw allocations,
// transfers, and expenses. All math is integer.
export function computeEffectiveBudget(
  allocations: PeriodAllocation[],
  transfers: Transfer[],
  expenses: Expense[],
  categories: Category[]
): EffectiveBudgetRow[] {
  const expensesByCategory = new Map<string, number>();
  for (const e of expenses) {
    const cur = expensesByCategory.get(e.category_id) ?? 0;
    expensesByCategory.set(e.category_id, addMinor(cur, e.amount_minor));
  }
  const borrowedByCategory = new Map<string, number>();
  const lentByCategory = new Map<string, number>();
  for (const t of transfers) {
    if (t.to_category_id) {
      const cur = borrowedByCategory.get(t.to_category_id) ?? 0;
      borrowedByCategory.set(t.to_category_id, addMinor(cur, t.amount_minor));
    }
    if (t.from_kind === "category" && t.from_category_id) {
      const cur = lentByCategory.get(t.from_category_id) ?? 0;
      lentByCategory.set(t.from_category_id, addMinor(cur, t.amount_minor));
    }
  }
  const catMap = new Map(categories.map((c) => [c.id, c]));

  return allocations.map((a) => {
    const cat = catMap.get(a.category_id);
    const base = a.base_minor;
    const carried = a.carried_in_minor;
    const borrowed = borrowedByCategory.get(a.category_id) ?? 0;
    const lent = lentByCategory.get(a.category_id) ?? 0;
    const spent = expensesByCategory.get(a.category_id) ?? 0;
    const effective = subMinor(addMinor(addMinor(base, carried), borrowed), lent);
    const remaining = subMinor(effective, spent);
    return {
      category_id: a.category_id,
      category_name: a.category_name,
      base_minor: base,
      carried_in_minor: carried,
      borrowed_in_minor: borrowed,
      lent_out_minor: lent,
      expenses_minor: spent,
      effective_minor: effective,
      remaining_minor: remaining,
      protected: cat?.protected ?? false,
      rule_type: a.rule_type,
      rule_value: a.rule_value,
    };
  });
}

// === Period confirmation ==================================================
//
// Confirming a period:
//   1. Resolve the previous period's deficits (caller passes resolved deficit
//      decisions as a list of transfers).
//   2. Apply carry/sweep: rollover mode adds remaining to the same category
//      next period; sweep mode moves remaining to the savings pool.
//   3. Lock the previous period (status="closed", closed_at set).
//   4. Snapshot the new period's allocations and set status="active".
//   5. Set the previous period's end_date = new_start - 1.
//   6. Optionally apply cutover override (now / tomorrow / backdated).

export interface CutoverOption {
  kind: "now" | "tomorrow" | "configured";
  overrideStart?: IsoDate; // explicit override; only used for "now" or "tomorrow"
}

export interface CarryPreview {
  categoryId: string;
  categoryName: string;
  remainingMinor: number;
  resolvedMode: "rollover" | "sweep";
  // What the carry will be (rollover => remainingMinor; sweep => 0)
  carryToNextMinor: number;
  sweepAmountMinor: number; // for sweep mode, what will be added to savings
}

export function computeCarryPreview(prevAllocations: PeriodAllocation[], transfers: Transfer[], expenses: Expense[], settings: Settings): CarryPreview[] {
  const rows = computeEffectiveBudget(prevAllocations, transfers, expenses, []);
  return rows.map((r) => {
    const resolved = prevAllocations.find((a) => a.category_id === r.category_id)?.resolved_unspent_mode ?? settings.global_unspent_mode;
    const remaining = r.remaining_minor;
    const positive = Math.max(0, remaining);
    const isRollover = resolved === "rollover";
    return {
      categoryId: r.category_id,
      categoryName: r.category_name,
      remainingMinor: remaining,
      resolvedMode: resolved,
      carryToNextMinor: isRollover ? positive : 0,
      sweepAmountMinor: isRollover ? 0 : positive,
    };
  });
}

// Total sweep into savings from a carry preview (sum of sweep amounts).
export function totalSweepFromCarry(preview: CarryPreview[]): number {
  return preview.reduce((acc, p) => addMinor(acc, p.sweepAmountMinor), 0);
}

// Total savings withdrawn this period (transfers out of savings).
export function totalSavingsWithdrawn(transfers: Transfer[]): number {
  return transfers
    .filter((t) => t.from_kind === "savings")
    .reduce((acc, t) => addMinor(acc, t.amount_minor), 0);
}

export interface ConfirmArgs {
  prevPeriod: Period | null; // null when confirming the very first period
  newPeriod: Period;
  categories: Category[];
  settings: Settings;
  confirmedSalaryMinor: number; // for the new period
  salaryAdjustmentsMinor: number;
  deficitTransfers: Transfer[]; // close-time transfers to resolve prev deficits
  cutover: CutoverOption;
}

// Apply a confirmation in a single transaction.
// Caller must ensure deficitTransfers do not exceed source remaining or cap.
export async function confirmPeriod(args: ConfirmArgs): Promise<void> {
  const { prevPeriod, newPeriod, categories, settings, confirmedSalaryMinor, salaryAdjustmentsMinor, deficitTransfers, cutover } = args;
  const now = nowTimestamp();
  const today = todayIso();

  // Determine the new period's actual start_date based on cutover.
  let newStart = newPeriod.start_date;
  if (cutover.kind === "now") {
    newStart = today;
  } else if (cutover.kind === "tomorrow") {
    newStart = addDays(today, 1);
  } else if (cutover.kind === "configured" && cutover.overrideStart) {
    newStart = cutover.overrideStart;
  }

  // First-period case: no previous period to close.
  if (!prevPeriod) {
    // Snapshot allocations for the new period (two-pass: non-remainder first, then remainder).
    const visibleCats = categories.filter((c) => !c.archived);
    const nonRemCats = visibleCats.filter((c) => c.type !== "remainder");
    const remCats = visibleCats.filter((c) => c.type === "remainder");

    const newAllocs: PeriodAllocation[] = nonRemCats.map((c) => {
      const base = computeBaseAllocation(c, confirmedSalaryMinor);
      const resolved = resolveUnspentMode(c, settings.global_unspent_mode);
      return {
        id: uuid(), period_start_date: newStart, category_id: c.id,
        category_name: c.name, rule_type: c.type, rule_value: c.value,
        base_minor: base, carried_in_minor: 0, resolved_unspent_mode: resolved,
      };
    });
    const totalNonRem = newAllocs.reduce((acc, p) => addMinor(acc, p.base_minor), 0);
    const leftover = Math.max(0, subMinor(confirmedSalaryMinor, totalNonRem));
    for (const c of remCats) {
      const base = computeBaseAllocation(c, confirmedSalaryMinor, leftover);
      const resolved = resolveUnspentMode(c, settings.global_unspent_mode);
      newAllocs.push({
        id: uuid(), period_start_date: newStart, category_id: c.id,
        category_name: c.name, rule_type: c.type, rule_value: c.value,
        base_minor: base, carried_in_minor: 0, resolved_unspent_mode: resolved,
      });
    }
    const totalAllocated = newAllocs.reduce((acc, p) => addMinor(acc, p.base_minor), 0);
    const unallocated = remCats.length > 0 ? 0 : Math.max(0, subMinor(confirmedSalaryMinor, totalAllocated));

    await db.rwTx(["periods", "period_allocations", "transfers", "savings_ledger"], async (tx) => {
      const periods = tx.objectStore("periods");
      const allocs = tx.objectStore("period_allocations");
      const transfers = tx.objectStore("transfers");
      const savings = tx.objectStore("savings_ledger");

      // Write deficit transfers (unlikely on first period, but support anyway).
      for (const t of deficitTransfers) {
        await transfers.put(t);
      }

      // Write new period allocations.
      for (const a of newAllocs) {
        await allocs.put(a);
      }

      // Write the new period record.
      const updatedNew: Period = {
        ...newPeriod,
        start_date: newStart,
        end_date: null,
        status: "active",
        salary_default_minor: settings.default_salary_minor,
        salary_adjustments_minor: salaryAdjustmentsMinor,
        salary_confirmed_minor: confirmedSalaryMinor,
        unallocated_minor: unallocated,
        unresolved_deficit_minor: 0,
        confirmed_at: now,
        closed_at: null,
      };
      await periods.put(updatedNew);

      // On the first period, the unallocated remainder stays in the period
      // (no previous period to sweep from). Record nothing in savings.
      void savings;
    });
    return;
  }

  // Compute carry/sweep from the previous period.
  const prevAllocs = await db.getAllocationsForPeriod(prevPeriod.start_date);
  const prevTransfers = await db.getTransfersForPeriod(prevPeriod.start_date);
  const prevExpenses = await db.getExpensesForPeriod(prevPeriod.start_date, prevPeriod.end_date ?? today);
  // Merge deficit transfers in for the close computation.
  const allPrevTransfers = [...prevTransfers, ...deficitTransfers];
  const carry = computeCarryPreview(prevAllocs, allPrevTransfers, prevExpenses, settings);

  // Carried-in per category for the new period (only rollover mode).
  const carriedInByCategory: Record<string, number> = {};
  for (const c of carry) {
    if (c.carryToNextMinor > 0) {
      carriedInByCategory[c.categoryId] = c.carryToNextMinor;
    }
  }

  // Build new allocations preview based on confirmed salary (two-pass: non-remainder first).
  const visibleCats = categories.filter((c) => !c.archived);
  const nonRemCats = visibleCats.filter((c) => c.type !== "remainder");
  const remCats = visibleCats.filter((c) => c.type === "remainder");

  const newPreview = nonRemCats.map((c) => {
    const base = computeBaseAllocation(c, confirmedSalaryMinor);
    const resolved = resolveUnspentMode(c, settings.global_unspent_mode);
    return {
      categoryId: c.id, categoryName: c.name, ruleType: c.type, ruleValue: c.value,
      baseMinor: base, carriedInMinor: carriedInByCategory[c.id] ?? 0,
      resolvedUnspentMode: resolved, protected: c.protected,
    };
  });
  const totalNonRem = newPreview.reduce((acc, p) => addMinor(acc, p.baseMinor), 0);
  const leftover = Math.max(0, subMinor(confirmedSalaryMinor, totalNonRem));
  for (const c of remCats) {
    const base = computeBaseAllocation(c, confirmedSalaryMinor, leftover);
    const resolved = resolveUnspentMode(c, settings.global_unspent_mode);
    newPreview.push({
      categoryId: c.id, categoryName: c.name, ruleType: c.type, ruleValue: c.value,
      baseMinor: base, carriedInMinor: carriedInByCategory[c.id] ?? 0,
      resolvedUnspentMode: resolved, protected: c.protected,
    });
  }
  const totalAllocated = newPreview.reduce((acc, p) => addMinor(acc, p.baseMinor), 0);
  const unallocated = remCats.length > 0 ? 0 : Math.max(0, subMinor(confirmedSalaryMinor, totalAllocated));

  // Compute unresolved deficit for the previous period after close-time transfers.
  // Deficit per category = remaining < 0. Sum of all (negative) remaining values,
  // if any remain unresolved.
  const rows = computeEffectiveBudget(prevAllocs, allPrevTransfers, prevExpenses, categories);
  const unresolvedDeficit = rows.reduce((acc, r) => {
    if (r.remaining_minor < 0) return addMinor(acc, Math.abs(r.remaining_minor));
    return acc;
  }, 0);

  // Compute the new period's end_date: it stays null until the *next* period
  // is confirmed. The previous period's end_date becomes newStart - 1.
  const prevEnd = addDays(newStart, -1);

  // Single transaction: write everything atomically.
  await db.rwTx(["periods", "period_allocations", "transfers", "savings_ledger"], async (tx) => {
    const periods = tx.objectStore("periods");
    const allocs = tx.objectStore("period_allocations");
    const transfers = tx.objectStore("transfers");
    const savings = tx.objectStore("savings_ledger");

    // Lock the previous period.
    const updatedPrev: Period = {
      ...prevPeriod,
      end_date: prevEnd,
      status: "closed",
      closed_at: now,
      unresolved_deficit_minor: unresolvedDeficit,
    };
    await periods.put(updatedPrev);

    // Write deficit transfers for the previous period.
    for (const t of deficitTransfers) {
      await transfers.put(t);
      if (t.from_kind === "savings") {
        await savings.put({
          id: uuid(),
          kind: "withdrawal",
          period_start_date: prevPeriod.start_date,
          source_category_id: null,
          transfer_id: t.id,
          amount_minor: t.amount_minor,
          created_at: now,
        });
      }
    }

    // Sweep unspent remaining into savings for the previous period (close).
    // We add sweep entries for each category with sweepAmountMinor > 0, plus
    // a single unallocated_in for the unallocated remainder.
    for (const c of carry) {
      if (c.sweepAmountMinor > 0) {
        await savings.put({
          id: uuid(),
          kind: "sweep_in",
          period_start_date: prevPeriod.start_date,
          source_category_id: c.categoryId,
          transfer_id: null,
          amount_minor: c.sweepAmountMinor,
          created_at: now,
        });
      }
    }
    // Unallocated remainder from the previous period (will be swept).
    // The previous period's unallocated is whatever was set at confirmation;
    // since we recompute, just use what was stored. But we should set it here.
    // We'll write it as an unallocated_in entry if > 0.
    const prevUnallocated = prevPeriod.unallocated_minor;
    if (prevUnallocated > 0) {
      await savings.put({
        id: uuid(),
        kind: "unallocated_in",
        period_start_date: prevPeriod.start_date,
        source_category_id: null,
        transfer_id: null,
        amount_minor: prevUnallocated,
        created_at: now,
      });
    }

    // Write new period allocations.
    const newAllocs = newPreview.map((p) => ({
      id: uuid(),
      period_start_date: newStart,
      category_id: p.categoryId,
      category_name: p.categoryName,
      rule_type: p.ruleType,
      rule_value: p.ruleValue,
      base_minor: p.baseMinor,
      carried_in_minor: p.carriedInMinor,
      resolved_unspent_mode: p.resolvedUnspentMode,
    }));
    for (const a of newAllocs) {
      await allocs.put(a);
    }

    // Write the new period record.
    const updatedNew: Period = {
      ...newPeriod,
      start_date: newStart,
      end_date: null,
      status: "active",
      salary_default_minor: settings.default_salary_minor,
      salary_adjustments_minor: salaryAdjustmentsMinor,
      salary_confirmed_minor: confirmedSalaryMinor,
      unallocated_minor: unallocated,
      unresolved_deficit_minor: 0,
      confirmed_at: now,
      closed_at: null,
    };
    await periods.put(updatedNew);
  });
}

// === Save a transfer (manual borrow from category or savings) =============

export interface SaveTransferArgs {
  periodStart: IsoDate;
  fromKind: "category" | "savings";
  fromCategoryId: string | null;
  toCategoryId: string;
  amountMinor: number;
  note: string | null;
  // Whether this transfer triggers an over-budget warning — only used for UI.
  capBefore?: number;
  capAfter?: number;
}

export async function saveTransfer(args: SaveTransferArgs): Promise<Transfer> {
  const now = nowTimestamp();
  const t: Transfer = {
    id: uuid(),
    period_start_date: args.periodStart,
    from_kind: args.fromKind,
    from_category_id: args.fromCategoryId,
    to_category_id: args.toCategoryId,
    amount_minor: args.amountMinor,
    created_at: now,
    note: args.note,
  };
  await db.putTransfer(t);
  // If borrowing from savings, record a savings ledger withdrawal entry.
  if (args.fromKind === "savings") {
    const entry: SavingsLedgerEntry = {
      id: uuid(),
      kind: "withdrawal",
      period_start_date: args.periodStart,
      source_category_id: null,
      transfer_id: t.id,
      amount_minor: args.amountMinor,
      created_at: now,
    };
    await db.putSavingsEntry(entry);
  }
  return t;
}

// === Active period discovery ===========================================

export async function getActivePeriod(): Promise<Period | null> {
  const all = await db.getAllPeriods();
  return all.find((p) => p.status === "active") ?? null;
}

export async function getPendingPeriods(): Promise<Period[]> {
  const all = await db.getAllPeriods();
  return all
    .filter((p) => p.status === "pending")
    .sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
}

export async function getClosedPeriods(): Promise<Period[]> {
  const all = await db.getAllPeriods();
  return all
    .filter((p) => p.status === "closed")
    .sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
}
