// Allocation math and period snapshot logic.
// All money is integer minor units. All math is integer math.
// Percent categories use basis points (1% = 100 bps). Remainder goes to Unallocated.

import type { Category, Period, PeriodAllocation, Settings } from "../db/schema";
import { percentToMinor, subMinor, addMinor } from "./money";
import type { IsoDate } from "./dates";

export interface AllocationPreview {
  categoryId: string;
  categoryName: string;
  ruleType: "percent" | "fixed" | "remainder";
  ruleValue: number;
  baseMinor: number;
  carriedInMinor: number;
  resolvedUnspentMode: "rollover" | "sweep";
  protected: boolean;
}

// Compute the base allocation for a category given the confirmed salary.
// percent: salaryMinor * basisPoints / 10000 (integer math, remainder is unallocated)
// fixed: the literal value
// remainder: receives everything not claimed by percent/fixed categories (pass unallocatedMinor)
export function computeBaseAllocation(category: Category, salaryMinor: number, unallocatedMinor = 0): number {
  if (category.type === "percent") {
    return percentToMinor(salaryMinor, category.value);
  }
  if (category.type === "remainder") {
    return Math.max(0, unallocatedMinor);
  }
  return Math.max(0, Math.trunc(category.value));
}

// Resolve the unspent mode for a category: per-category wins over global.
export function resolveUnspentMode(category: Category, globalMode: "rollover" | "sweep"): "rollover" | "sweep" {
  return category.unspent_mode ?? globalMode;
}

// Compute the allocation preview for a period that is about to be confirmed.
// carriedInMinor is the rollover from the previous period's closing remaining
// (per category), if the resolved unspent mode is "rollover".
export function buildAllocationPreview(
  categories: Category[],
  settings: Settings,
  confirmedSalaryMinor: number,
  carriedInByCategory: Record<string, number>,
  periodStart: IsoDate
): {
  preview: AllocationPreview[];
  totalAllocatedMinor: number;
  unallocatedMinor: number;
} {
  const visible = categories.filter((c) => !c.archived);
  const nonRemainder = visible.filter((c) => c.type !== "remainder");
  const remainderCats = visible.filter((c) => c.type === "remainder");
  const preview: AllocationPreview[] = [];
  let total = 0;

  // Allocate non-remainder categories first.
  for (const c of nonRemainder) {
    const base = computeBaseAllocation(c, confirmedSalaryMinor);
    const carriedIn = carriedInByCategory[c.id] ?? 0;
    const resolved = resolveUnspentMode(c, settings.global_unspent_mode);
    preview.push({
      categoryId: c.id,
      categoryName: c.name,
      ruleType: c.type,
      ruleValue: c.value,
      baseMinor: base,
      carriedInMinor: carriedIn,
      resolvedUnspentMode: resolved,
      protected: c.protected,
    });
    total = addMinor(total, base);
  }

  // The remainder category absorbs what's left.
  const leftover = Math.max(0, subMinor(confirmedSalaryMinor, total));
  for (const c of remainderCats) {
    const base = computeBaseAllocation(c, confirmedSalaryMinor, leftover);
    const carriedIn = carriedInByCategory[c.id] ?? 0;
    const resolved = resolveUnspentMode(c, settings.global_unspent_mode);
    preview.push({
      categoryId: c.id,
      categoryName: c.name,
      ruleType: c.type,
      ruleValue: c.value,
      baseMinor: base,
      carriedInMinor: carriedIn,
      resolvedUnspentMode: resolved,
      protected: c.protected,
    });
    total = addMinor(total, base);
  }

  const unallocated = remainderCats.length > 0 ? 0 : Math.max(0, subMinor(confirmedSalaryMinor, total));
  return { preview, totalAllocatedMinor: total, unallocatedMinor: unallocated };
}

// Check whether the allocation exceeds the salary. v1 blocks confirmation in
// this case with a clear error.
export function isAllocationOverBudget(totalAllocated: number, salaryMinor: number): boolean {
  return totalAllocated > salaryMinor;
}

// Snapshot allocations at confirmation time. Returns PeriodAllocation rows.
export function snapshotAllocations(preview: AllocationPreview[], periodStart: IsoDate): PeriodAllocation[] {
  return preview.map((p) => ({
    id: crypto.randomUUID(),
    period_start_date: periodStart,
    category_id: p.categoryId,
    category_name: p.categoryName,
    rule_type: p.ruleType,
    rule_value: p.ruleValue,
    base_minor: p.baseMinor,
    carried_in_minor: p.carriedInMinor,
    resolved_unspent_mode: p.resolvedUnspentMode,
  }));
}

// Build a "should-be" period record (not yet stored) for a pending period.
export function makePendingPeriod(start: IsoDate, defaultSalaryMinor: number): Period {
  return {
    start_date: start,
    end_date: null,
    status: "pending",
    salary_default_minor: defaultSalaryMinor,
    salary_adjustments_minor: 0,
    salary_confirmed_minor: null,
    unallocated_minor: 0,
    unresolved_deficit_minor: 0,
    confirmed_at: null,
    closed_at: null,
  };
}
