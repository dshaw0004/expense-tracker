"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MoneyInput } from "../shared/Money";
import { useNav } from "@/lib/store/nav";
import { useAppData, type AppData } from "@/hooks/expense-tracker/useAppData";
import { parseMoneyToMinor, basisPointsToPercent, percentToBasisPoints, listCurrencies, getCurrency } from "@/lib/budget/money";
import { nowTimestamp, uuid, formatDisplayDate } from "@/lib/budget/dates";
import * as db from "@/lib/db/db";
import type { Category, Settings as SettingsType } from "@/lib/db/schema";
import { useToast } from "@/hooks/use-toast";
import { buildExportJson, buildExportBlob, triggerDownload, suggestedExportFilename, parseExportText, decryptPayload, validatePayload, applyImport } from "@/lib/budget/export";
import { markExportedAt, daysSinceExport, triggerInstallPrompt, registerServiceWorker, navigatorStoragePersist, isStoragePersisted } from "@/lib/budget/persistence";
import * as persistence from "@/lib/budget/persistence";
import { ChevronLeft, Download, Upload, Plus, Trash2, ShieldCheck, RefreshCw, AlertTriangle, Loader2 } from "lucide-react";
import { wipeAll } from "@/lib/db/db";

interface SettingsScreenProps {
  data: AppData;
}

export function SettingsScreen({ data }: SettingsScreenProps) {
  const { go } = useNav();
  const { settings, categories, refresh } = data;
  const { toast } = useToast();

  const [salaryStr, setSalaryStr] = useState("");
  const [cycleDay, setCycleDay] = useState(1);
  const [globalMode, setGlobalMode] = useState<"rollover" | "sweep">("sweep");
  const [savingsCapStr, setSavingsCapStr] = useState("");
  const [backupReminder, setBackupReminder] = useState(30);
  const [persisted, setPersisted] = useState(false);
  const [installState, setInstallState] = useState<"unavailable" | "available" | "accepted" | "dismissed">("unavailable");
  const [installing, setInstalling] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [passphraseModal, setPassphraseModal] = useState<{ text: string; mode: "encrypt" | "decrypt" } | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [pendingImportText, setPendingImportText] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setSalaryStr(settings.default_salary_minor ? (settings.default_salary_minor / Math.pow(10, getCurrency(settings.currency).fractionDigits)).toString() : "");
    setCycleDay(settings.cycle_day);
    setGlobalMode(settings.global_unspent_mode);
    setSavingsCapStr(settings.savings_withdrawal_cap_minor ? (settings.savings_withdrawal_cap_minor / Math.pow(10, getCurrency(settings.currency).fractionDigits)).toString() : "");
    setBackupReminder(settings.backup_reminder_days);
  }, [settings]);

  useEffect(() => {
    void isStoragePersisted().then(setPersisted);
    // Check install prompt availability on a polling basis (1s for the first 30s).
    const cleanup = persistence.attachInstallPrompt();
    const t = setInterval(() => {
      if (persistence.getDeferredPrompt()) setInstallState("available");
    }, 1000);
    return () => { cleanup(); clearInterval(t); };
  }, []);

  if (!settings) return null;
  const cur = getCurrency(settings.currency);
  const daysSinceExp = daysSinceExport(settings.last_exported_at);

  async function saveSettings(patch: Partial<SettingsType>) {
    if (!settings) return;
    const next: SettingsType = { ...settings, ...patch };
    await db.putSettings(next);
    await refresh();
  }

  async function handleSaveBasic() {
    const salary = parseMoneyToMinor(salaryStr, settings!.currency);
    if (salary === null || salary < 0) {
      toast({ title: "Invalid salary", variant: "destructive" });
      return;
    }
    const cap = savingsCapStr.trim() ? parseMoneyToMinor(savingsCapStr, settings!.currency) : null;
    if (cap !== null && cap < 0) {
      toast({ title: "Invalid cap", variant: "destructive" });
      return;
    }
    await saveSettings({
      default_salary_minor: salary,
      cycle_day: cycleDay,
      global_unspent_mode: globalMode,
      savings_withdrawal_cap_minor: cap,
      backup_reminder_days: backupReminder,
    });
    toast({ title: "Saved" });
  }

  async function handleExport(passphrase: string | null) {
    try {
      const blob = await buildExportBlob(passphrase);
      triggerDownload(blob, suggestedExportFilename(settings!.currency));
      await markExportedAt();
      await refresh();
      toast({ title: "Exported", description: "Your data is saved as a JSON file." });
    } catch (e) {
      toast({ title: "Export failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function handleFile(file: File) {
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = parseExportText(text);
      if (parsed.kind === "error") {
        toast({ title: "Import failed", description: parsed.error, variant: "destructive" });
        return;
      }
      if (parsed.kind === "needs-passphrase") {
        setPendingImportText(text);
        setPassphraseModal({ text: "Enter the passphrase to decrypt this file.", mode: "decrypt" });
        return;
      }
      const issues = validatePayload(parsed.payload);
      if (issues.length > 0) {
        toast({ title: "Validation failed", description: issues[0], variant: "destructive" });
        return;
      }
      const ok = window.confirm("Importing will REPLACE ALL data on this device. This cannot be undone. Continue?");
      if (!ok) return;
      await applyImport(parsed.payload);
      await refresh();
      toast({ title: "Imported", description: `Loaded ${parsed.payload.expenses.length} expenses.` });
    } catch (e) {
      toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }

  async function handleDecryptImport() {
    if (!pendingImportText || !passphrase) return;
    setImporting(true);
    try {
      const parsed = await decryptPayload(pendingImportText, passphrase);
      if (parsed.kind === "error") {
        toast({ title: "Decryption failed", description: parsed.error, variant: "destructive" });
        return;
      }
      const issues = validatePayload(parsed.payload);
      if (issues.length > 0) {
        toast({ title: "Validation failed", description: issues[0], variant: "destructive" });
        return;
      }
      const ok = window.confirm("Importing will REPLACE ALL data on this device. Continue?");
      if (!ok) return;
      await applyImport(parsed.payload);
      await refresh();
      toast({ title: "Imported", description: `Loaded ${parsed.payload.expenses.length} expenses.` });
      setPassphraseModal(null);
      setPassphrase("");
      setPendingImportText(null);
    } finally {
      setImporting(false);
    }
  }

  async function handleInstall() {
    setInstalling(true);
    const result = await triggerInstallPrompt();
    setInstallState(result);
    setInstalling(false);
    if (result === "accepted") toast({ title: "Installed", description: "Find Envelope on your home screen." });
  }

  async function handlePersist() {
    const ok = await navigatorStoragePersist();
    setPersisted(await isStoragePersisted());
    if (ok) toast({ title: "Storage will persist" });
    else toast({ title: "Persistence not granted", description: "Install the app for stronger guarantees." });
  }

  async function handleWipe() {
    const ok = window.confirm("This will ERASE ALL data on this device. Export first if you want a backup. Continue?");
    if (!ok) return;
    await wipeAll();
    await refresh();
    toast({ title: "All data wiped" });
  }

  function addCategory() {
    if (!settings) return;
    const now = nowTimestamp();
    const c: Category = {
      id: uuid(),
      name: "",
      type: "fixed",
      value: 0,
      unspent_mode: null,
      protected: false,
      sort_order: categories.length,
      archived: false,
      created_at: now,
    };
    void db.putCategory(c).then(refresh);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-2">
          <button onClick={() => go("home")} className="rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label="Back">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Settings</div>
            <div className="font-semibold tracking-tight">Budget configuration</div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-4">
        <div className="space-y-4">
          {/* Basics */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Salary & cycle</CardTitle>
              <CardDescription>Changes affect future periods only.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label>Default in-hand salary</Label>
                <MoneyInput value={salaryStr} onChange={setSalaryStr} currency={settings.currency} placeholder="0.00" inputMode="decimal" />
              </div>
              <div className="space-y-2">
                <Label>Cycle day (1–31)</Label>
                <Input type="number" min={1} max={31} value={cycleDay} onChange={(e) => setCycleDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))} inputMode="numeric" />
                <p className="text-xs text-muted-foreground">If the day doesn&apos;t exist in a month, the last day is used.</p>
              </div>
              <div className="space-y-2">
                <Label>Global unspent mode</Label>
                <Select value={globalMode} onValueChange={(v) => setGlobalMode(v as "rollover" | "sweep")}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rollover">Rollover</SelectItem>
                    <SelectItem value="sweep">Sweep</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Savings withdrawal cap (per period)</Label>
                <MoneyInput value={savingsCapStr} onChange={setSavingsCapStr} currency={settings.currency} placeholder="No cap" inputMode="decimal" />
                <p className="text-xs text-muted-foreground">Null = no cap. Past withdrawals are unaffected.</p>
              </div>
              <div className="space-y-2">
                <Label>Backup reminder (days)</Label>
                <Input type="number" min={1} value={backupReminder} onChange={(e) => setBackupReminder(Math.max(1, Number(e.target.value) || 1))} inputMode="numeric" />
              </div>
              <Button onClick={handleSaveBasic} className="w-full">Save</Button>
            </CardContent>
          </Card>

          {/* Categories */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>Categories</span>
                <Button size="sm" variant="outline" onClick={addCategory}><Plus className="mr-1 h-3.5 w-3.5" /> Add</Button>
              </CardTitle>
              <CardDescription>Rules are editable at any time. Changes affect future periods only.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {categories.length === 0 && (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No categories. Add one above.</div>
              )}
              {categories.map((c) => (
                <CategoryEditor
                  key={c.id}
                  category={c}
                  currency={settings.currency}
                  onChange={async (patch) => {
                    await db.putCategory({ ...c, ...patch });
                    await refresh();
                  }}
                  onDelete={async () => {
                    // Disallow deleting categories with history.
                    if (data.allocations.some((a) => a.category_id === c.id) || data.expenses.some((e) => e.category_id === c.id)) {
                      toast({ title: "Cannot delete", description: "This category has history. Archive it instead.", variant: "destructive" });
                      return;
                    }
                    await db.deleteCategory(c.id);
                    await refresh();
                  }}
                />
              ))}
            </CardContent>
          </Card>

          {/* Export / Import */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Export / Import</CardTitle>
              <CardDescription>
                {settings.last_exported_at ? `Last exported ${daysSinceExp ?? 0} day(s) ago.` : "Never exported."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => handleExport(null)}>
                  <Download className="mr-1 h-4 w-4" /> Export
                </Button>
                <Button variant="outline" onClick={() => setPassphraseModal({ text: "Optional encryption passphrase.", mode: "encrypt" })}>
                  <ShieldCheck className="mr-1 h-4 w-4" /> Export encrypted
                </Button>
              </div>
              <Button variant="outline" className="w-full" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                {importing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
                Import (replaces all)
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = "";
                }}
              />
            </CardContent>
          </Card>

          {/* PWA & persistence */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">App & storage</CardTitle>
              <CardDescription>Install for stronger persistence and offline use.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                <div>
                  <div className="font-medium">Storage persistence</div>
                  <div className="text-xs text-muted-foreground">{persisted ? "Persistent — browser won't auto-clear." : "Not persistent — browser may evict after inactivity."}</div>
                </div>
                <Button size="sm" variant="outline" onClick={handlePersist} disabled={persisted}>
                  {persisted ? "Secured" : "Request"}
                </Button>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                <div>
                  <div className="font-medium">Install app</div>
                  <div className="text-xs text-muted-foreground">Adds to home screen; survives Safari's 7-day eviction.</div>
                </div>
                <Button size="sm" variant="outline" onClick={handleInstall} disabled={installState === "unavailable" || installState === "accepted" || installing}>
                  {installState === "accepted" ? "Installed" : installState === "unavailable" ? "N/A" : installing ? "Installing…" : "Install"}
                </Button>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                <div>
                  <div className="font-medium">Service worker</div>
                  <div className="text-xs text-muted-foreground">Cache app shell for offline use.</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => registerServiceWorker()}>
                  <RefreshCw className="mr-1 h-3.5 w-3.5" /> Register
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Danger zone */}
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-destructive">
                <AlertTriangle className="h-4 w-4" /> Danger zone
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button variant="destructive" className="w-full" onClick={handleWipe}>
                <Trash2 className="mr-1 h-4 w-4" /> Wipe all data
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">Erases everything on this device. Export first if you want a backup.</p>
            </CardContent>
          </Card>

          <div className="py-2 text-center text-xs text-muted-foreground">
            <div>Envelope · v1 · local-first</div>
            <div className="mt-1">All money is integer minor units. All math is auditable.</div>
          </div>
        </div>
      </main>

      {/* Passphrase modal */}
      {passphraseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-base">
                {passphraseModal.mode === "encrypt" ? "Encrypt export" : "Decrypt import"}
              </CardTitle>
              <CardDescription>{passphraseModal.text}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Passphrase"
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setPassphraseModal(null);
                    setPassphrase("");
                    setPendingImportText(null);
                  }}
                >
                  Cancel
                </Button>
                {passphraseModal.mode === "encrypt" ? (
                  <Button
                    className="flex-1"
                    disabled={!passphrase}
                    onClick={() => {
                      void handleExport(passphrase);
                      setPassphraseModal(null);
                      setPassphrase("");
                    }}
                  >
                    Export
                  </Button>
                ) : (
                  <Button
                    className="flex-1"
                    disabled={!passphrase || importing}
                    onClick={() => void handleDecryptImport()}
                  >
                    {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Decrypt & import"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

interface CategoryEditorProps {
  category: Category;
  currency: string;
  onChange: (patch: Partial<Category>) => void;
  onDelete: () => void;
}

function CategoryEditor({ category, currency, onChange, onDelete }: CategoryEditorProps) {
  const cur = getCurrency(currency);
  const [name, setName] = useState(category.name);
  const [value, setValue] = useState(
    category.type === "percent"
      ? basisPointsToPercent(category.value)
      : category.type === "remainder"
        ? ""
        : (category.value / Math.pow(10, cur.fractionDigits)).toString()
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(category.name);
    setValue(
      category.type === "percent"
        ? basisPointsToPercent(category.value)
        : category.type === "remainder"
          ? ""
          : (category.value / Math.pow(10, cur.fractionDigits)).toString()
    );
  }, [category]);

  function commitName(v: string) {
    setName(v);
    onChange({ name: v });
  }
  function commitValue(v: string) {
    setValue(v);
    if (category.type === "percent") {
      const bps = percentToBasisPoints(Number(v) || 0);
      onChange({ value: bps });
    } else {
      const minor = parseMoneyToMinor(v, currency);
      if (minor !== null) onChange({ value: minor });
    }
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start gap-2">
        <Input value={name} onChange={(e) => commitName(e.target.value)} placeholder="Category name" className="flex-1" />
        <button onClick={onDelete} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent" aria-label="Delete">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        {category.type === "remainder" ? (
          <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
            Remainder — absorbs unallocated salary
          </span>
        ) : (
          <>
            <Select
              value={category.type}
              onValueChange={(v) => onChange({ type: v as "percent" | "fixed" | "remainder" })}
            >
              <SelectTrigger className="h-8 w-[100px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">Percent</SelectItem>
                <SelectItem value="fixed">Fixed</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number"
              inputMode="decimal"
              value={value}
              onChange={(e) => commitValue(e.target.value)}
              className="flex-1"
              placeholder={category.type === "percent" ? "30" : "5000"}
            />
            {category.type === "percent" && <span className="self-center text-sm text-muted-foreground">%</span>}
          </>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <Label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={category.protected} onCheckedChange={(v) => onChange({ protected: v })} />
          Protected
        </Label>
        <Select
          value={category.unspent_mode ?? "inherit"}
          onValueChange={(v) => onChange({ unspent_mode: v === "inherit" ? null : v as "rollover" | "sweep" })}
        >
          <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Inherit</SelectItem>
            <SelectItem value="rollover">Rollover</SelectItem>
            <SelectItem value="sweep">Sweep</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
