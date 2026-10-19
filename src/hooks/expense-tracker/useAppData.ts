"use client";

// Central data hook. Loads all settings/categories/periods/expenses once,
// re-runs mount check on every mount, and exposes derived helpers.
// Components subscribe to a refresh counter so they re-render after mutations.

import { useEffect, useState, useCallback, useRef } from "react";
import * as db from "@/lib/db/db";
import type { Category, Period, Settings, Expense, Transfer, PeriodAllocation, SavingsLedgerEntry } from "@/lib/db/schema";
import { runMountCheck } from "@/lib/budget/period";

export interface AppData {
  ready: boolean;
  needsOnboarding: boolean;
  settings: Settings | null;
  categories: Category[];
  periods: Period[];
  activePeriod: Period | null;
  pendingPeriods: Period[];
  expenses: Expense[];
  transfers: Transfer[];
  allocations: PeriodAllocation[];
  savingsLedger: SavingsLedgerEntry[];
  refresh: () => Promise<void>;
}

export function useAppData(): AppData {
  const [ready, setReady] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [activePeriod, setActivePeriod] = useState<Period | null>(null);
  const [pendingPeriods, setPendingPeriods] = useState<Period[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [allocations, setAllocations] = useState<PeriodAllocation[]>([]);
  const [savingsLedger, setSavingsLedger] = useState<SavingsLedgerEntry[]>([]);
  const mountedRef = useRef(false);

  const refresh = useCallback(async () => {
    const s = await db.getSettings();
    setSettings(s ?? null);
    if (!s) {
      setNeedsOnboarding(true);
      setReady(true);
      return;
    }
    setNeedsOnboarding(false);

    // Run the mount check — single-transaction period creation.
    await runMountCheck();

    const [cats, allPeriods, allExpenses, allTransfers, allAllocs, allSavings] = await Promise.all([
      db.getAllCategories(),
      db.getAllPeriods(),
      db.getAllExpenses(),
      db.getAllTransfers(),
      db.getAllFromAllocations(),
      db.getAllSavingsEntries(),
    ]);
    setCategories(cats);
    setPeriods(allPeriods);
    setActivePeriod(allPeriods.find((p) => p.status === "active") ?? null);
    setPendingPeriods(allPeriods.filter((p) => p.status === "pending").sort((a, b) => (a.start_date < b.start_date ? -1 : 1)));
    setExpenses(allExpenses);
    setTransfers(allTransfers);
    setAllocations(allAllocs);
    setSavingsLedger(allSavings);
    setReady(true);
  }, []);

  // Initial data load on mount.
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    void (async () => {
      try {
        await refresh();
      } catch (e) {
        console.error("Initial data load failed", e);
      }
    })();
  }, [refresh]);

  return { ready, needsOnboarding, settings, categories, periods, activePeriod, pendingPeriods, expenses, transfers, allocations, savingsLedger, refresh };
}
