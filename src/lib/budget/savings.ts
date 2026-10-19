// Savings pool logic. Derived from savings_ledger entries.
// savings_balance = sum(sweep_in + unallocated_in) - sum(withdrawal)

import type { SavingsLedgerEntry } from "../db/schema";
import { addMinor, subMinor } from "./money";

export function computeSavingsBalance(entries: SavingsLedgerEntry[]): number {
  const positive = entries
    .filter((e) => e.kind === "sweep_in" || e.kind === "unallocated_in")
    .reduce((acc, e) => addMinor(acc, e.amount_minor), 0);
  const negative = entries
    .filter((e) => e.kind === "withdrawal")
    .reduce((acc, e) => addMinor(acc, e.amount_minor), 0);
  return subMinor(positive, negative);
}

// Total withdrawals in a period (used for cap check).
export function withdrawalsInPeriod(entries: SavingsLedgerEntry[], periodStart: string): number {
  return entries
    .filter((e) => e.kind === "withdrawal" && e.period_start_date === periodStart)
    .reduce((acc, e) => addMinor(acc, e.amount_minor), 0);
}

// Remaining cap for a period (null = no cap).
export function remainingCap(withdrawn: number, cap: number | null): number | null {
  if (cap === null) return null;
  return Math.max(0, subMinor(cap, withdrawn));
}
