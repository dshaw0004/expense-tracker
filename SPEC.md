# Expense Tracker: Product & Technical Spec (v1)

Salary-driven envelope budgeting as a local-first PWA. No backend, no accounts, no notifications. All data lives on the user's device and can be exported and imported.

---

## 1. Principles

1. **Local-first and private.** IndexedDB only. No server, no telemetry.
2. **Portable data.** Export is versioned JSON using ISO dates, integer money, and descriptive field names, so users (and LLMs) can build their own tools on it.
3. **Auditable math.** Allocations are snapshotted per period. Every money movement (borrowing, sweeps, rollover) is a ledger entry. Remaining balances are always derived, never stored.
4. **Honest budgeting.** Overspending is never silently hidden. It is resolved by explicit transfers ("cut costs somewhere").
5. **2-tap expense entry.** Logging an expense is the hot path and must stay fast.

---

## 2. Core concepts

| Concept | Meaning |
|---|---|
| **Salary** | The user's in-hand monthly amount (default value; confirmed each period). |
| **Category** | User-defined envelope (food, commute, rent, non-essentials...). Allocated by percent of full salary or fixed amount. |
| **Period** | One budget cycle, identified by its start date. Boundaries may differ from calendar months. |
| **Allocation** | Snapshot of what each category received for a period. |
| **Transfer** | An explicit, permanent move of budget between categories or from savings to a category. |
| **Savings pool** | A single running balance fed by sweeps and drawn down by transfers. |
| **Protected category** | Category that cannot lend (rent, EMI). |

---

## 3. Allocation model

- Percent categories are a percent of the **full confirmed salary** for the period. Fixed categories are exact amounts.
- Validation: total allocated must not exceed the confirmed salary. Any remainder is shown as **Unallocated** and goes to the savings pool at close.
- Rules (percent/fixed values) are editable at any time. Changes affect **future periods only**, because past periods keep their snapshots.

**Effective budget per category for a period:**

```
effective = base_allocation + carried_in + borrowed_in - lent_out
remaining = effective - sum(expenses in period)
```

---

## 4. Period lifecycle

States: `pending` -> `active` -> `closed`.

### 4.1 Cycle configuration
- User picks a **cycle day** (1-31).
- If the chosen day does not exist in a month, the **last day** of that month is the trigger day. The cycle returns to the configured day the next month.
- Period length is the real day count of that period. Any per-day math uses it.

### 4.2 Check on mount (no cron)
On app mount, run in a single IndexedDB transaction:
1. Compute the latest period start date that is <= today.
2. If periods are missing between the last known period and that date, create **pending** periods **sequentially**, one per missed cycle.
3. Idempotent: the period start date is the primary key, so two open tabs cannot double-create.

### 4.3 Confirmation flow (per pending period, oldest first)
1. Show the default salary. The user can **deduct** (absence, loss of pay) or **add** (bonus), and sees the resulting confirmed salary.
2. A "same as usual" quick-confirm button keeps catch-up fast.
3. Show the allocation preview with carried-in amounts ("Food: 2,000 base + 1,000 carried").
4. On confirm:
   - The previous period's final remaining is computed and deficits must be resolved (see 6.5).
   - Carry/sweep is applied (see 5).
   - The previous period is **locked**.
   - The new period's allocations are **snapshotted** and it becomes `active`.

The previous period stays editable until the next one is confirmed (grace window for late or backdated expenses).

### 4.4 Cutover popup (now vs tomorrow)
After confirming a new period, ask when it begins:
- **Now**: the new period's `start_date` is today.
- **Tomorrow**: the `start_date` is today + 1.
- If the app was opened late, an extra option appears: **From the configured date** (backdated, N days ago).

Rules:
- The override applies **only to that period**. The next period still follows the configured cycle day.
- Expenses are assigned to a period by **date range** against stored `start_date`/`end_date`. The previous period's `end_date` is set to match the new period's `start_date - 1`.
- This state lives in IndexedDB (not localStorage) so it survives export/import and eviction together with the rest of the data.

---

## 5. Unspent money: rollover vs sweep

- Two modes: `rollover` (add remaining to the same category next period) and `sweep` (move remaining to the savings pool).
- Setting resolution: `category.mode ?? global.mode`. `null` on a category means inherit. **Per-category takes priority.**
- The resolved mode is **snapshotted** on each closed allocation, so later setting changes never rewrite history.
- Only positive remaining is carried or swept. Deficits are handled by borrowing (section 6), not carried as negatives.
- Each sweep creates a `savings_ledger` entry with `source_category_id` for traceability.
- Rollover compounds across periods and is displayed as base + carried.

---

## 6. Borrowing (overspend handling)

Borrowing is an explicit, permanent transfer. It is **not a loan** and is never repaid automatically.

### 6.1 Triggers
- **On overspend**: when an expense pushes a category below zero, prompt "Borrow how much, from where?". The user can dismiss.
- **At period close**: all unresolved deficits must be resolved before the next period starts (see 6.5).

### 6.2 Sources
- Other categories that are not protected and have positive remaining.
- The **savings pool** (allowed in the normal flow, subject to the cap in 6.4).
- Suggested order: unprotected categories by largest remaining balance first, then savings (not the default selection, balance shown).

### 6.3 Rules
- A transfer can never exceed the source's current remaining (or the savings balance).
- Borrowing from a category reduces its `remaining`, so its rollover/sweep is computed afterward on the reduced value.
- Transfers are manual, reversible entries. If an expense is edited or deleted, show a hint ("this transfer may no longer be needed") instead of auto-recomputing.
- Undoing a transfer from savings restores the balance automatically (balance is derived).

### 6.4 Savings withdrawal cap (optional)
- Setting: `savings_withdrawal_cap_minor` (integer or `null`). **Off by default (`null`).**
- Scope: total withdrawn from savings via transfers **per period**.
- When set and reached, the savings option in the borrow prompt is disabled and shows "Cap reached (X of X used this period)". The prompt also shows remaining cap when partially used.
- The cap applies during close-time deficit resolution too.
- The user can change or remove the cap at any time in settings. Changing it affects the current and future periods; past withdrawals are unaffected.
- Visibility regardless of cap: the close summary shows "Withdrew X from savings this period", and the borrow sheet shows the savings balance.

### 6.5 Close-time deficit resolution
Order of options for each remaining deficit:
1. Borrow from unprotected categories.
2. Borrow from savings (within cap, if set).
3. If everything is exhausted, close with a recorded **overall deficit** on the period (`unresolved_deficit_minor`), shown in the history.

---

## 7. Savings pool

- `savings_balance = sum(sweeps_in) - sum(withdrawals)`, derived from `savings_ledger`.
- Single pool. Each sweep records `source_category_id` for history only.
- Savings can never go negative.
- Not in v1: repaying savings, goals, interest.

---

## 8. Data model

All IDs are UUIDs. All money is **integer minor units** (paise). Never floats.

### Stores

```
settings        (single row)
  schema_version, currency, cycle_day, default_salary_minor,
  global_unspent_mode: "rollover" | "sweep",
  savings_withdrawal_cap_minor: integer | null,
  last_exported_at, created_at

categories
  id, name, type: "percent" | "fixed", value (basis points for percent, minor units for fixed),
  unspent_mode: "rollover" | "sweep" | null,
  protected: boolean, sort_order, archived: boolean

periods                          (primary key: start_date)
  start_date, end_date, status: "pending" | "active" | "closed",
  salary_default_minor, salary_adjustment_minor, salary_confirmed_minor,
  unallocated_minor, unresolved_deficit_minor, confirmed_at, closed_at

period_allocations               (snapshot)
  id, period_start_date, category_id, category_name, rule_type, rule_value,
  base_minor, carried_in_minor, resolved_unspent_mode

transfers
  id, period_start_date, from: {kind: "category"|"savings", category_id?},
  to_category_id, amount_minor, created_at, note

expenses
  id, category_id, amount_minor, date (YYYY-MM-DD), note, created_at

savings_ledger
  id, kind: "sweep_in" | "withdrawal" | "unallocated_in",
  period_start_date, source_category_id?, transfer_id?, amount_minor, created_at
```

Notes:
- Expenses are assigned to a period **by date range**, not by a stored period id.
- Category names are copied into allocation snapshots so renames do not alter history.
- Archived categories keep history; deleting a category with history is not allowed.

### Indexes
- `expenses`: by `date`, by `category_id`
- `transfers`: by `period_start_date`
- `savings_ledger`: by `period_start_date`
- `period_allocations`: by `period_start_date`

---

## 9. Date and time formats

- Dates without time (expense date, period boundaries): **ISO 8601 `YYYY-MM-DD`**, in the user's local time.
- Timestamps: **ISO 8601 with offset**, e.g. `2026-10-19T14:30:00+05:30`.
- Money: integer minor units with an explicit field suffix (`_minor`) and a top-level `currency` code (ISO 4217).
- Never store UTC-only timestamps for date-semantic fields, because timezone shifts would move expenses across period boundaries.

---

## 10. Export / import

### Export
- Single JSON file with `schema_version`, `exported_at`, `currency`, and all stores.
- Include an embedded `_schema_description` block (field meanings, units, relationships) so a user can hand the file to an LLM or script and query it directly. Optionally ship a JSON Schema alongside.
- Optional **passphrase encryption** using WebCrypto (AES-GCM, PBKDF2/Argon2-derived key). Encrypted exports carry a header with KDF params and `encrypted: true`.
- Update `last_exported_at` on success.

### Import
- v1: **replace-all** only, with a clear confirmation ("this replaces all data on this device").
- Validate `schema_version`; run migrations for older versions; reject newer versions with a clear message.
- Validate integrity before writing: referential checks, integer money, valid dates. Write in one transaction so a failed import leaves existing data untouched.
- Merge import is explicitly out of scope for v1.

---

## 11. PWA and storage risks

- Call `navigator.storage.persist()` at first run, and prompt users to **install the PWA** (important for Safari, which can evict script-written storage after about 7 days of non-use when not installed).
- **Backup nudges**: on mount, show a banner when the last export is old ("last exported 45 days ago"). Offer configurable threshold.
- Optional enhancement: File System Access API for auto-backup to a chosen file where supported (Chromium). Not available on iOS, so it can never be required.
- Service worker caches the app shell so it works offline.
- Multi-tab safety: single-transaction mount check, with the period start date as primary key.
- No notifications. The month-change check only runs when the app is opened, which is an accepted trade-off for privacy.

---

## 12. Screens (v1)

1. **Onboarding**: currency, in-hand salary, cycle day, categories (percent/fixed, protected flag), global unspent mode, request persistence/install.
2. **Home**: per-category cards with progress bar, remaining amount, effective budget (base + carried), warning at about 80% used, and "safe to spend per day" (remaining / days left in the real period length).
3. **Quick add expense**: amount, category, date (default today), optional note.
4. **Confirm period**: salary adjust, allocation preview, deficit resolution, cutover choice.
5. **Borrow sheet**: sources with balances, savings balance, cap status.
6. **Period history**: closed periods with allocations, transfers, sweeps, and any unresolved deficit.
7. **Savings**: balance, ledger.
8. **Settings**: salary, cycle day, categories, unspent modes, savings cap, export/import, backup reminder threshold.

---

## 13. Edge cases checklist

- Skipped multiple periods: process sequentially, one confirmation each.
- Cycle day 29-31 in short months: clamp to the last day, then return to the configured day.
- Cycle day changed mid-year: affects future periods only; closed periods keep their boundaries.
- Late open: offer backdated start option.
- Salary changed or adjusted: only the confirmed amount for that period changes; defaults update separately.
- Rules changed mid-period: apply to the next period; the active period keeps its snapshot.
- Percent total plus fixed total exceeds salary: block confirmation with a clear error.
- Borrow exceeds source balance or cap: blocked.
- Expense edited or deleted after a transfer: show hint, never auto-modify transfers.
- Currency: single currency per data set in v1.
- Rounding: percent allocations computed in integer math; any rounding remainder goes to Unallocated.

---

## 14. Out of scope for v1

- Merge import, multi-device sync, multiple currencies
- Recurring expenses, receipts/attachments, charts beyond progress bars
- Savings goals and repaying savings
- Notifications, background jobs
- Shared/household budgets

---

## 15. Suggested build order

1. Storage layer, schema, migrations, money/date utilities
2. Categories, allocation math, period snapshot
3. Expense entry and per-category remaining
4. Mount check, pending periods, confirmation and cutover flow
5. Rollover/sweep and the savings ledger
6. Borrowing (categories, then savings, then cap)
7. Export/import with versioning (and optional encryption)
8. PWA install, persistence, backup banner, polish