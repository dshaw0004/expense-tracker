// IndexedDB wrapper for the expense tracker. Local-first, no backend.
// All data lives on-device. Single-transaction mount check is in period.ts.

import { openDB, type DBSchema, type IDBPTransaction } from "idb";
import type {
  Settings,
  Category,
  Period,
  PeriodAllocation,
  Transfer,
  Expense,
  SavingsLedgerEntry,
} from "./schema";

const DB_NAME = "expense-tracker";
const DB_VERSION = 1;

interface ExpenseTrackerDB extends DBSchema {
  settings: {
    key: string;
    value: Settings;
  };
  categories: {
    key: string;
    value: Category;
    indexes: { "by-sort": number; "by-archived": number };
  };
  periods: {
    key: string; // start_date
    value: Period;
    indexes: { "by-status": string };
  };
  period_allocations: {
    key: string;
    value: PeriodAllocation;
    indexes: { "by-period": string; "by-period-category": [string, string] };
  };
  transfers: {
    key: string;
    value: Transfer;
    indexes: { "by-period": string; "by-to-category": [string, string] };
  };
  expenses: {
    key: string;
    value: Expense;
    indexes: { "by-date": string; "by-category": string };
  };
  savings_ledger: {
    key: string;
    value: SavingsLedgerEntry;
    indexes: { "by-period": string; "by-source-category": string };
  };
}

import type { IDBPDatabase } from "idb";

export type StoreName =
  | "settings"
  | "categories"
  | "periods"
  | "period_allocations"
  | "transfers"
  | "expenses"
  | "savings_ledger";

let dbPromise: Promise<IDBPDatabase<ExpenseTrackerDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<ExpenseTrackerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ExpenseTrackerDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion, tx) {
        // v1: create all stores with indexes.
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings");
        }
        if (!db.objectStoreNames.contains("categories")) {
          const store = db.createObjectStore("categories", { keyPath: "id" });
          store.createIndex("by-sort", "sort_order");
          store.createIndex("by-archived", "sort_order");
        }
        if (!db.objectStoreNames.contains("periods")) {
          const store = db.createObjectStore("periods", { keyPath: "start_date" });
          store.createIndex("by-status", "status");
        }
        if (!db.objectStoreNames.contains("period_allocations")) {
          const store = db.createObjectStore("period_allocations", { keyPath: "id" });
          store.createIndex("by-period", "period_start_date");
          store.createIndex("by-period-category", ["period_start_date", "category_id"]);
        }
        if (!db.objectStoreNames.contains("transfers")) {
          const store = db.createObjectStore("transfers", { keyPath: "id" });
          store.createIndex("by-period", "period_start_date");
          store.createIndex("by-to-category", ["period_start_date", "to_category_id"]);
        }
        if (!db.objectStoreNames.contains("expenses")) {
          const store = db.createObjectStore("expenses", { keyPath: "id" });
          store.createIndex("by-date", "date");
          store.createIndex("by-category", "category_id");
        }
        if (!db.objectStoreNames.contains("savings_ledger")) {
          const store = db.createObjectStore("savings_ledger", { keyPath: "id" });
          store.createIndex("by-period", "period_start_date");
          store.createIndex("by-source-category", "source_category_id");
        }
        // Future migrations: switch on oldVersion.
        void tx;
        void oldVersion;
        void newVersion;
      },
      // Multi-tab safety: when another tab writes, our reads will see the new state.
      // We additionally use start_date as primary key for periods to make the
      // mount check idempotent across tabs.
    });
  }
  return dbPromise!;
}

// Helper to run a readwrite transaction across multiple stores atomically.
export async function rwTx<T>(
  stores: StoreName[],
  fn: (tx: IDBPTransaction<ExpenseTrackerDB, StoreName[], "readwrite">) => Promise<T>
): Promise<T> {
  const db = await getDB();
  const tx = db.transaction(stores, "readwrite");
  const result = await fn(tx);
  await tx.done;
  return result;
}

// Helper to run a readonly transaction.
export async function roTx<T>(
  stores: StoreName[],
  fn: (tx: IDBPTransaction<ExpenseTrackerDB, StoreName[], "readonly">) => Promise<T>
): Promise<T> {
  const db = await getDB();
  const tx = db.transaction(stores, "readonly");
  return await fn(tx);
}

// --- Settings -----------------------------------------------------------------

export async function getSettings(): Promise<Settings | undefined> {
  const db = await getDB();
  return db.get("settings", "singleton");
}

export async function putSettings(settings: Settings): Promise<void> {
  const db = await getDB();
  // "settings" store has no keyPath — pass the explicit key "singleton".
  await db.put("settings", { ...settings, schema_version: 1 }, "singleton");
}

// --- Categories ----------------------------------------------------------------

export async function getAllCategories(): Promise<Category[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex("categories", "by-sort");
  return all.sort((a, b) => a.sort_order - b.sort_order);
}

export async function getCategory(id: string): Promise<Category | undefined> {
  const db = await getDB();
  return db.get("categories", id);
}

export async function putCategory(cat: Category): Promise<void> {
  const db = await getDB();
  await db.put("categories", cat);
}

export async function deleteCategory(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("categories", id);
}

// --- Periods ------------------------------------------------------------------

export async function getAllPeriods(): Promise<Period[]> {
  const db = await getDB();
  const all = await db.getAll("periods");
  return all.sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
}

export async function getPeriod(start: string): Promise<Period | undefined> {
  const db = await getDB();
  return db.get("periods", start);
}

export async function putPeriod(period: Period): Promise<void> {
  const db = await getDB();
  await db.put("periods", period);
}

// --- Allocations ---------------------------------------------------------------

export async function getAllocationsForPeriod(periodStart: string): Promise<PeriodAllocation[]> {
  const db = await getDB();
  return db.getAllFromIndex("period_allocations", "by-period", periodStart);
}

export async function putAllocation(alloc: PeriodAllocation): Promise<void> {
  const db = await getDB();
  await db.put("period_allocations", alloc);
}

// --- Transfers ----------------------------------------------------------------

export async function getTransfersForPeriod(periodStart: string): Promise<Transfer[]> {
  const db = await getDB();
  return db.getAllFromIndex("transfers", "by-period", periodStart);
}

export async function putTransfer(t: Transfer): Promise<void> {
  const db = await getDB();
  await db.put("transfers", t);
}

export async function deleteTransfer(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("transfers", id);
}

// --- Expenses ------------------------------------------------------------------

export async function getAllExpenses(): Promise<Expense[]> {
  const db = await getDB();
  return db.getAll("expenses");
}

export async function getExpensesForPeriod(start: string, end: string): Promise<Expense[]> {
  const db = await getDB();
  // Use date index range to fetch only expenses in [start, end] inclusive.
  return db.getAllFromIndex("expenses", "by-date", IDBKeyRange.bound(start, end));
}

export async function putExpense(e: Expense): Promise<void> {
  const db = await getDB();
  await db.put("expenses", e);
}

export async function deleteExpense(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("expenses", id);
}

// --- Savings ledger ------------------------------------------------------------

export async function getAllSavingsEntries(): Promise<SavingsLedgerEntry[]> {
  const db = await getDB();
  const all = await db.getAll("savings_ledger");
  return all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function getSavingsEntriesForPeriod(periodStart: string): Promise<SavingsLedgerEntry[]> {
  const db = await getDB();
  return db.getAllFromIndex("savings_ledger", "by-period", periodStart);
}

export async function putSavingsEntry(entry: SavingsLedgerEntry): Promise<void> {
  const db = await getDB();
  await db.put("savings_ledger", entry);
}

// --- Bulk reads (all entries) for export and global state ---------------------

export async function getAllFromAllocations(): Promise<PeriodAllocation[]> {
  const db = await getDB();
  return db.getAll("period_allocations");
}

export async function getAllTransfers(): Promise<Transfer[]> {
  const db = await getDB();
  return db.getAll("transfers");
}

export async function getAllExpensesList(): Promise<Expense[]> {
  const db = await getDB();
  return db.getAll("expenses");
}

// --- Bulk reads for export -----------------------------------------------------

export async function dumpAllStores() {
  const db = await getDB();
  const [settings, categories, periods, allocations, transfers, expenses, savingsLedger] = await Promise.all([
    db.get("settings", "singleton"),
    db.getAll("categories"),
    db.getAll("periods"),
    db.getAll("period_allocations"),
    db.getAll("transfers"),
    db.getAll("expenses"),
    db.getAll("savings_ledger"),
  ]);
  return { settings, categories, periods, allocations, transfers, expenses, savings_ledger: savingsLedger };
}

// --- Bulk replace (import) -----------------------------------------------------

export async function replaceAll(data: {
  settings?: Settings;
  categories?: Category[];
  periods?: Period[];
  allocations?: PeriodAllocation[];
  transfers?: Transfer[];
  expenses?: Expense[];
  savings_ledger?: SavingsLedgerEntry[];
}): Promise<void> {
  const db = await getDB();
  const allStores: StoreName[] = [
    "settings",
    "categories",
    "periods",
    "period_allocations",
    "transfers",
    "expenses",
    "savings_ledger",
  ];
  const tx = db.transaction(allStores, "readwrite");
  for (const s of allStores) {
    await tx.objectStore(s).clear();
  }
  // Use the tx-bound store APIs so all writes are atomic.
  if (data.settings) await tx.objectStore("settings").put({ ...data.settings, schema_version: 1 }, "singleton");
  for (const c of data.categories ?? []) await tx.objectStore("categories").put(c);
  for (const p of data.periods ?? []) await tx.objectStore("periods").put(p);
  for (const a of data.allocations ?? []) await tx.objectStore("period_allocations").put(a);
  for (const t of data.transfers ?? []) await tx.objectStore("transfers").put(t);
  for (const e of data.expenses ?? []) await tx.objectStore("expenses").put(e);
  for (const s of data.savings_ledger ?? []) await tx.objectStore("savings_ledger").put(s);
  await tx.done;
}

// --- Wipe (reset) --------------------------------------------------------------

export async function wipeAll(): Promise<void> {
  const db = await getDB();
  const allStores: StoreName[] = [
    "settings",
    "categories",
    "periods",
    "period_allocations",
    "transfers",
    "expenses",
    "savings_ledger",
  ];
  const tx = db.transaction(allStores, "readwrite");
  for (const s of allStores) {
    await tx.objectStore(s).clear();
  }
  await tx.done;
}
