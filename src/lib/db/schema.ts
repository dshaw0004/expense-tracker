// Type definitions for all IndexedDB stores in the expense tracker.
// All IDs are UUIDs. All money is integer minor units (paise). Never floats.
// Dates: YYYY-MM-DD; timestamps: ISO 8601 with offset.

import type { IsoDate } from "../budget/dates";

export const SCHEMA_VERSION = 1;

export type UnspentMode = "rollover" | "sweep";
export type CategoryType = "percent" | "fixed" | "remainder";
export type PeriodStatus = "pending" | "active" | "closed";
export type TransferSourceKind = "category" | "savings";
export type SavingsLedgerKind = "sweep_in" | "withdrawal" | "unallocated_in";

export interface Settings {
  schema_version: number;
  currency: string; // ISO 4217
  cycle_day: number; // 1-31
  default_salary_minor: number;
  global_unspent_mode: UnspentMode;
  savings_withdrawal_cap_minor: number | null;
  last_exported_at: string | null; // ISO with offset
  backup_reminder_days: number; // nag threshold
  created_at: string; // ISO with offset
}

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  // For "percent": basis points (50% = 5000). For "fixed": integer minor units. For "remainder": unused (always 0).
  value: number;
  unspent_mode: UnspentMode | null; // null = inherit global
  protected: boolean;
  sort_order: number;
  archived: boolean;
  created_at: string;
}

export interface Period {
  start_date: IsoDate; // primary key
  end_date: IsoDate | null; // null until next period confirmed
  status: PeriodStatus;
  salary_default_minor: number;
  salary_adjustments_minor: number; // signed: +bonus / -deduction
  salary_confirmed_minor: number | null; // null until confirmed
  unallocated_minor: number; // swept at close
  unresolved_deficit_minor: number; // only at close
  confirmed_at: string | null;
  closed_at: string | null;
}

export interface PeriodAllocation {
  id: string;
  period_start_date: IsoDate;
  category_id: string;
  category_name: string; // snapshot
  rule_type: CategoryType;
  rule_value: number; // snapshot
  base_minor: number; // snapshot
  carried_in_minor: number; // snapshot (rollover from previous period)
  resolved_unspent_mode: UnspentMode; // snapshot of effective mode
}

export interface Transfer {
  id: string;
  period_start_date: IsoDate;
  from_kind: TransferSourceKind;
  from_category_id: string | null;
  to_category_id: string;
  amount_minor: number;
  created_at: string;
  note: string | null;
}

export interface Expense {
  id: string;
  category_id: string;
  amount_minor: number;
  date: IsoDate;
  note: string | null;
  created_at: string;
}

export interface SavingsLedgerEntry {
  id: string;
  kind: SavingsLedgerKind;
  period_start_date: IsoDate;
  source_category_id: string | null;
  transfer_id: string | null;
  amount_minor: number;
  created_at: string;
}

// Effective budget view (derived).
export interface EffectiveBudget {
  category_id: string;
  category_name: string;
  base_minor: number;
  carried_in_minor: number;
  borrowed_in_minor: number; // sum of incoming transfers
  lent_out_minor: number; // sum of outgoing transfers
  expenses_minor: number; // sum of expenses in period
  effective_minor: number; // base + carried + borrowed - lent
  remaining_minor: number; // effective - expenses
  protected: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  schema_version: SCHEMA_VERSION,
  currency: "INR",
  cycle_day: 1,
  default_salary_minor: 0,
  global_unspent_mode: "sweep",
  savings_withdrawal_cap_minor: null,
  last_exported_at: null,
  backup_reminder_days: 30,
  created_at: "",
};

// Embedded schema description block for export files.
export const SCHEMA_DESCRIPTION = {
  format: "expense-tracker export v1",
  conventions: {
    money: "All monetary amounts are stored as integer minor units (paise), with field names suffixed _minor. Currency code is at the top level.",
    dates: "Date-only fields use ISO 8601 YYYY-MM-DD in local time. Timestamps use ISO 8601 with offset, e.g. 2026-10-19T14:30:00+05:30.",
    ids: "All entity IDs are UUID v4 strings.",
    relations: "Expenses belong to a category by category_id. Expenses belong to a period by date range against period.start_date/end_date. Transfers reference period_start_date and either a source category (from_category_id) or savings pool (from_kind='savings').",
    derived: "Savings balance is derived: sum(savings_ledger.amount_minor where kind='sweep_in' or 'unallocated_in') - sum(amount_minor where kind='withdrawal'). Category remaining is derived: base + carried_in + borrowed_in - lent_out - sum(expenses).",
  },
  stores: {
    settings: "Singleton row with currency, cycle_day, default_salary_minor, global_unspent_mode, savings_withdrawal_cap_minor, last_exported_at, created_at.",
    categories: "User-defined envelopes. type='percent' uses basis points; type='fixed' uses minor units; type='remainder' receives salary minus all other allocations (value field unused). unspent_mode=null means inherit global. protected=true forbids lending out. At most one remainder category may exist.",
    periods: "One per budget cycle, primary key = start_date. status transitions pending -> active -> closed. end_date is null until the next period is confirmed.",
    period_allocations: "Snapshot per period per category. Created at period confirmation. Renames do not alter snapshots.",
    transfers: "Manual money movements. from_kind='category' borrows from another envelope; 'savings' draws from the savings pool. to_category_id is the recipient.",
    expenses: "Per-category spends. assigned to a period by date range.",
    savings_ledger: "Append-only ledger. kind='sweep_in' (positive, from unspent sweep), 'unallocated_in' (positive, from remainder at close), 'withdrawal' (negative, transfer out of savings).",
  },
  math: {
    effective: "effective = base_allocation + carried_in + borrowed_in - lent_out",
    remaining: "remaining = effective - sum(expenses in period)",
    savings_balance: "savings_balance = sum(sweep_in + unallocated_in) - sum(withdrawal)",
  },
} as const;
