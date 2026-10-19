// Export / import: single JSON file with schema_version, exported_at, currency,
// all stores, and an embedded _schema_description block.
//
// Optional passphrase encryption using AES-GCM + PBKDF2 (see crypto.ts).
//
// Import is v1 replace-all only, with a clear confirmation. Validates
// schema_version (runs migrations for older versions; rejects newer versions
// with a clear message), referential integrity, integer money, and valid
// dates. Writes in one transaction so a failed import leaves existing data
// untouched.

import { SCHEMA_VERSION, SCHEMA_DESCRIPTION, type Settings } from "../db/schema";
import { dumpAllStores, replaceAll } from "../db/db";
import { nowTimestamp, type IsoDate } from "./dates";
import { encryptJson, decryptJson, type EncryptedBlob } from "./crypto";

export interface ExportPayload {
  format: "expense-tracker";
  schema_version: number;
  exported_at: string;
  currency: string;
  settings: Settings | undefined;
  categories: unknown[];
  periods: unknown[];
  period_allocations: unknown[];
  transfers: unknown[];
  expenses: unknown[];
  savings_ledger: unknown[];
  _schema_description: typeof SCHEMA_DESCRIPTION;
}

export async function buildExport(): Promise<ExportPayload> {
  const stores = await dumpAllStores();
  const currency = stores.settings?.currency ?? "INR";
  return {
    format: "expense-tracker",
    schema_version: SCHEMA_VERSION,
    exported_at: nowTimestamp(),
    currency,
    settings: stores.settings,
    categories: stores.categories,
    periods: stores.periods,
    period_allocations: stores.allocations,
    transfers: stores.transfers,
    expenses: stores.expenses,
    savings_ledger: stores.savings_ledger,
    _schema_description: SCHEMA_DESCRIPTION,
  };
}

// Serialize as a JSON string (for download). Optionally encrypt.
export async function buildExportJson(passphrase: string | null): Promise<string> {
  const payload = await buildExport();
  if (passphrase && passphrase.length > 0) {
    const encrypted = await encryptJson(payload, passphrase);
    return JSON.stringify(encrypted, null, 2);
  }
  return JSON.stringify(payload, null, 2);
}

export async function buildExportBlob(passphrase: string | null): Promise<Blob> {
  const json = await buildExportJson(passphrase);
  return new Blob([json], { type: "application/json" });
}

// === Import validation =====================================================

export interface ImportResult {
  ok: boolean;
  error?: string;
  needsPassphrase?: boolean;
}

export function looksEncrypted(parsed: unknown): parsed is EncryptedBlob {
  if (!parsed || typeof parsed !== "object") return false;
  const p = parsed as Record<string, unknown>;
  return p.encrypted === true && typeof p.ciphertext === "string" && !!p.header;
}

export function looksPlainExport(parsed: unknown): parsed is ExportPayload {
  if (!parsed || typeof parsed !== "object") return false;
  const p = parsed as Record<string, unknown>;
  return p.format === "expense-tracker" && typeof p.schema_version === "number";
}

// Validate the parsed export payload. Returns a list of issues. Empty list = OK.
export function validatePayload(payload: ExportPayload): string[] {
  const issues: string[] = [];
  // Schema version check: reject newer versions; accept older (migrations
  // would be applied here).
  if (payload.schema_version > SCHEMA_VERSION) {
    issues.push(`File schema_version is ${payload.schema_version}, but this app only supports up to ${SCHEMA_VERSION}. Update the app to import this file.`);
    return issues;
  }
  if (payload.schema_version < 1) {
    issues.push(`File schema_version is ${payload.schema_version}, which is invalid.`);
    return issues;
  }
  // Money integrity check: every *_minor field must be a non-negative integer
  // (except salary_adjustments_minor, which can be signed).
  const checkMoney = (label: string, v: unknown, opts?: { signed?: boolean }): void => {
    if (typeof v !== "number" || !Number.isInteger(v)) {
      issues.push(`${label} is not an integer: ${String(v)}`);
      return;
    }
    if (!opts?.signed && v < 0) issues.push(`${label} is negative: ${v}`);
  };

  const periods = (payload.periods ?? []) as Array<Record<string, unknown>>;
  const categories = (payload.categories ?? []) as Array<Record<string, unknown>>;
  const expenses = (payload.expenses ?? []) as Array<Record<string, unknown>>;
  const transfers = (payload.transfers ?? []) as Array<Record<string, unknown>>;
  const allocations = (payload.period_allocations ?? []) as Array<Record<string, unknown>>;
  const savingsLedger = (payload.savings_ledger ?? []) as Array<Record<string, unknown>>;

  // Date validity check.
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  const checkDate = (label: string, v: unknown): void => {
    if (typeof v !== "string" || !isoRe.test(v)) {
      issues.push(`${label} is not a valid YYYY-MM-DD date: ${String(v)}`);
    } else {
      const [y, m, d] = v.split("-").map(Number);
      if (m < 1 || m > 12) issues.push(`${label} has invalid month: ${v}`);
      if (d < 1 || d > 31) issues.push(`${label} has invalid day: ${v}`);
      void y;
    }
  };

  const catIds = new Set(categories.map((c) => c.id as string));
  const periodStarts = new Set(periods.map((p) => p.start_date as string));

  for (const p of periods) {
    if (!p.start_date || !isoRe.test(p.start_date as string)) issues.push(`Period start_date invalid: ${String(p.start_date)}`);
    if (p.end_date !== null && p.end_date !== undefined && !isoRe.test(p.end_date as string)) {
      issues.push(`Period end_date invalid: ${String(p.end_date)}`);
    }
    checkMoney("period.salary_default_minor", p.salary_default_minor);
    checkMoney("period.salary_adjustments_minor", p.salary_adjustments_minor, { signed: true });
    if (p.salary_confirmed_minor !== null && p.salary_confirmed_minor !== undefined) {
      checkMoney("period.salary_confirmed_minor", p.salary_confirmed_minor);
    }
    checkMoney("period.unallocated_minor", p.unallocated_minor);
    checkMoney("period.unresolved_deficit_minor", p.unresolved_deficit_minor);
  }

  for (const c of categories) {
    if (!c.id || typeof c.id !== "string") issues.push(`Category has no id`);
    if (!c.name || typeof c.name !== "string") issues.push(`Category ${String(c.id)} has no name`);
    if (c.type !== "percent" && c.type !== "fixed") issues.push(`Category ${String(c.id)} has invalid type: ${String(c.type)}`);
    checkMoney(`Category ${String(c.id)}.value`, c.value);
    if (c.protected !== true && c.protected !== false) issues.push(`Category ${String(c.id)} protected flag missing`);
    if (typeof c.sort_order !== "number") issues.push(`Category ${String(c.id)} sort_order missing`);
  }

  for (const e of expenses) {
    if (!e.id) issues.push(`Expense has no id`);
    if (!catIds.has(e.category_id as string)) issues.push(`Expense ${String(e.id)} references unknown category ${String(e.category_id)}`);
    checkMoney(`Expense ${String(e.id)}.amount_minor`, e.amount_minor);
    checkDate(`Expense ${String(e.id)}.date`, e.date);
  }

  for (const t of transfers) {
    if (!t.id) issues.push(`Transfer has no id`);
    if (!periodStarts.has(t.period_start_date as string)) {
      issues.push(`Transfer ${String(t.id)} references unknown period ${String(t.period_start_date)}`);
    }
    if (t.from_kind !== "category" && t.from_kind !== "savings") {
      issues.push(`Transfer ${String(t.id)} has invalid from_kind: ${String(t.from_kind)}`);
    }
    if (t.from_kind === "category" && !catIds.has(t.from_category_id as string)) {
      issues.push(`Transfer ${String(t.id)} from_category_id unknown: ${String(t.from_category_id)}`);
    }
    if (!catIds.has(t.to_category_id as string)) {
      issues.push(`Transfer ${String(t.id)} to_category_id unknown: ${String(t.to_category_id)}`);
    }
    checkMoney(`Transfer ${String(t.id)}.amount_minor`, t.amount_minor);
  }

  for (const a of allocations) {
    if (!a.id) issues.push(`Allocation has no id`);
    if (!periodStarts.has(a.period_start_date as string)) {
      issues.push(`Allocation references unknown period ${String(a.period_start_date)}`);
    }
    if (!catIds.has(a.category_id as string)) {
      issues.push(`Allocation references unknown category ${String(a.category_id)}`);
    }
    checkMoney(`Allocation.base_minor`, a.base_minor);
    checkMoney(`Allocation.carried_in_minor`, a.carried_in_minor);
    if (a.resolved_unspent_mode !== "rollover" && a.resolved_unspent_mode !== "sweep") {
      issues.push(`Allocation has invalid resolved_unspent_mode: ${String(a.resolved_unspent_mode)}`);
    }
  }

  for (const s of savingsLedger) {
    if (!s.id) issues.push(`Savings ledger entry has no id`);
    if (!periodStarts.has(s.period_start_date as string)) {
      issues.push(`Savings ledger ${String(s.id)} references unknown period ${String(s.period_start_date)}`);
    }
    if (s.kind !== "sweep_in" && s.kind !== "withdrawal" && s.kind !== "unallocated_in") {
      issues.push(`Savings ledger ${String(s.id)} has invalid kind: ${String(s.kind)}`);
    }
    checkMoney(`Savings ledger ${String(s.id)}.amount_minor`, s.amount_minor);
  }

  return issues;
}

// Parse a JSON file (potentially encrypted). Returns either the plaintext
// payload or signals that a passphrase is required.
export interface ParseOutcome {
  kind: "plaintext";
  payload: ExportPayload;
}

export function parseExportText(text: string): ParseOutcome | { kind: "needs-passphrase" } | { kind: "error"; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { kind: "error", error: `Not valid JSON: ${(e as Error).message}` };
  }
  if (looksPlainExport(parsed)) {
    return { kind: "plaintext", payload: parsed };
  }
  if (looksEncrypted(parsed)) {
    return { kind: "needs-passphrase" };
  }
  return { kind: "error", error: "Unrecognized file format. Expected an expense-tracker export." };
}

export async function decryptPayload(text: string, passphrase: string): Promise<ParseOutcome | { kind: "error"; error: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { kind: "error", error: `Not valid JSON: ${(e as Error).message}` };
  }
  if (!looksEncrypted(parsed)) {
    return { kind: "error", error: "File is not an encrypted export." };
  }
  try {
    const data = await decryptJson(parsed, passphrase);
    if (!looksPlainExport(data)) {
      return { kind: "error", error: "Decrypted file is not a valid expense-tracker export." };
    }
    return { kind: "plaintext", payload: data };
  } catch (e) {
    return { kind: "error", error: (e as Error).message };
  }
}

// Replace all data with the parsed payload. Single transaction.
export async function applyImport(payload: ExportPayload): Promise<void> {
  // Run migrations here if schema_version < SCHEMA_VERSION. For v1 there are
  // no older versions, so we just write directly.
  await replaceAll({
    settings: payload.settings,
    categories: payload.categories as never,
    periods: payload.periods as never,
    allocations: payload.period_allocations as never,
    transfers: payload.transfers as never,
    expenses: payload.expenses as never,
    savings_ledger: payload.savings_ledger as never,
  });
}

// Download helper.
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function suggestedExportFilename(currency: string): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = (today.getMonth() + 1).toString().padStart(2, "0");
  const d = today.getDate().toString().padStart(2, "0");
  return `expense-tracker-${currency}-${y}${m}${d}.json`;
}

// Type re-export for callers.
export type { IsoDate } from "./dates";
