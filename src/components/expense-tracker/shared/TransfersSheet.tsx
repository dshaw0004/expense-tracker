"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "./Money";
import { formatDisplayDate } from "@/lib/budget/dates";
import { ArrowRightLeft, PiggyBank, ShieldCheck, Undo2, AlertTriangle } from "lucide-react";
import type { Transfer } from "@/lib/db/schema";
import type { EffectiveBudgetRow } from "@/lib/budget/period";
import { cn } from "@/lib/utils";

const CONFIRM_PHRASE = "return";

interface TransferRow {
  transfer: Transfer;
  fromName: string; // display name of the source
  toName: string;   // display name of the destination category
  // Amount that can actually be returned: capped by how much the destination
  // still has remaining (they may have already spent some/all of the borrowed funds).
  returnableMinor: number;
}

interface TransfersSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  transfers: Transfer[];
  rows: EffectiveBudgetRow[];      // effective budget rows for the active period
  currency: string;
  onRevert: (transfer: Transfer) => Promise<void>;
}

export function TransfersSheet({
  open,
  onOpenChange,
  transfers,
  rows,
  currency,
  onRevert,
}: TransfersSheetProps) {
  const [pending, setPending] = useState<TransferRow | null>(null);
  const [phrase, setPhrase] = useState("");
  const [reverting, setReverting] = useState(false);

  // Build enriched rows.
  const transferRows: TransferRow[] = transfers
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map((t) => {
      const toRow = rows.find((r) => r.category_id === t.to_category_id);
      const fromName =
        t.from_kind === "savings"
          ? "Savings pool"
          : (rows.find((r) => r.category_id === t.from_category_id)?.category_name ?? "Unknown category");
      const toName = toRow?.category_name ?? "Unknown category";

      // How much of the borrowed amount is still unspent in the destination.
      // remaining_minor already accounts for all transfers and expenses, so if
      // the category still has ≥ transfer amount left, the full amount is returnable.
      // We cap at transfer.amount_minor — you can only return what was transferred.
      const destinationRemaining = toRow?.remaining_minor ?? 0;
      const returnableMinor = Math.max(0, Math.min(t.amount_minor, destinationRemaining));

      return { transfer: t, fromName, toName, returnableMinor };
    });

  function requestRevert(row: TransferRow) {
    setPending(row);
    setPhrase("");
  }

  function cancelConfirm() {
    setPending(null);
    setPhrase("");
  }

  async function confirmRevert() {
    if (!pending) return;
    setReverting(true);
    try {
      await onRevert(pending.transfer);
    } finally {
      setReverting(false);
      setPending(null);
      setPhrase("");
    }
  }

  const phraseMatch = phrase.trim().toLowerCase() === CONFIRM_PHRASE;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="flex max-h-[85vh] flex-col gap-0 p-0">
          <SheetHeader className="border-b border-border px-4 pt-4 pb-3">
            <SheetTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" />
              Transfers this period
            </SheetTitle>
            <SheetDescription>
              Transfers move funds permanently between envelopes or from savings. You can cancel a transfer if the destination envelope still has the funds unspent.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {transferRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-center">
                <ArrowRightLeft className="h-8 w-8 text-muted-foreground/50" />
                <p className="mt-3 text-sm font-medium">No transfers this period</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Transfers appear here when you borrow funds from another envelope or savings to cover an overspend.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {transferRows.map((row) => (
                  <TransferCard
                    key={row.transfer.id}
                    row={row}
                    currency={currency}
                    onRevert={() => requestRevert(row)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
            <Button variant="ghost" className="w-full" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Confirmation dialog */}
      <Dialog open={pending !== null} onOpenChange={(v) => { if (!v) cancelConfirm(); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 className="h-5 w-5 text-amber-500" />
              Cancel transfer
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  This will cancel the transfer of{" "}
                  <span className="font-medium text-foreground">
                    <Money minor={pending?.transfer.amount_minor ?? 0} currency={currency} />
                  </span>{" "}
                  from{" "}
                  <span className="font-medium text-foreground">{pending?.fromName}</span>{" "}
                  to{" "}
                  <span className="font-medium text-foreground">{pending?.toName}</span>.
                </p>
                {pending && pending.returnableMinor < pending.transfer.amount_minor && (
                  <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                      <span className="font-medium text-foreground">
                        <Money minor={pending.transfer.amount_minor - pending.returnableMinor} currency={currency} />
                      </span>{" "}
                      of this transfer has already been spent. Only{" "}
                      <span className="font-medium text-foreground">
                        <Money minor={pending.returnableMinor} currency={currency} />
                      </span>{" "}
                      is still unspent in {pending.toName}. Cancelling will put that envelope into deficit.
                    </p>
                  </div>
                )}
                {pending && pending.returnableMinor === 0 && pending.transfer.amount_minor > 0 && (
                  <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                      The full transferred amount has already been spent. Cancelling will leave {pending?.toName} in deficit.
                    </p>
                  </div>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="revert-phrase">
              Type <span className="font-mono font-semibold text-foreground">{CONFIRM_PHRASE}</span> to confirm
            </Label>
            <Input
              id="revert-phrase"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && phraseMatch && !reverting) void confirmRevert(); }}
              placeholder={CONFIRM_PHRASE}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={cancelConfirm} disabled={reverting}>
              Keep transfer
            </Button>
            <Button
              variant="destructive"
              disabled={!phraseMatch || reverting}
              onClick={() => void confirmRevert()}
            >
              {reverting ? "Cancelling…" : "Cancel transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TransferCard({
  row,
  currency,
  onRevert,
}: {
  row: TransferRow;
  currency: string;
  onRevert: () => void;
}) {
  const { transfer, fromName, toName, returnableMinor } = row;
  const fullySpent = returnableMinor === 0;
  const partiallySpent = returnableMinor > 0 && returnableMinor < transfer.amount_minor;

  return (
    <div className="rounded-lg border border-border p-3">
      {/* Header row: source → destination + amount */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          {transfer.from_kind === "savings" ? (
            <PiggyBank className="h-4 w-4 shrink-0 text-amber-500" />
          ) : (
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
          )}
          <div>
            <span className="font-medium">{fromName}</span>
            <span className="mx-1.5 text-muted-foreground">→</span>
            <span className="font-medium">{toName}</span>
          </div>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          <Money minor={transfer.amount_minor} currency={currency} />
        </span>
      </div>

      {/* Meta: date + note */}
      <div className="mt-1 text-xs text-muted-foreground">
        {formatDisplayDate(transfer.created_at.slice(0, 10))}
        {transfer.note && <> · {transfer.note}</>}
      </div>

      {/* Returnable status */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className={cn("text-xs", fullySpent ? "text-muted-foreground" : partiallySpent ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
          {fullySpent
            ? "Fully spent — reverting will cause a deficit"
            : partiallySpent
              ? <>
                  <Money minor={returnableMinor} currency={currency} /> unspent ·{" "}
                  <Money minor={transfer.amount_minor - returnableMinor} currency={currency} /> already spent
                </>
              : <><Money minor={returnableMinor} currency={currency} /> fully unspent</>
          }
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={onRevert}
        >
          <Undo2 className="mr-1 h-3 w-3" />
          {fullySpent ? "Cancel anyway" : "Cancel"}
        </Button>
      </div>
    </div>
  );
}
