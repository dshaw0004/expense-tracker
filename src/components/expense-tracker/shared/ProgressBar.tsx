"use client";

import { cn } from "@/lib/utils";

interface ProgressBarProps {
  used: number; // minor units
  total: number; // minor units (effective budget)
  className?: string;
  warning?: boolean;
}

export function ProgressBar({ used, total, className, warning: warnOverride }: ProgressBarProps) {
  // Defensive: clamp negatives to 0, total to >= 1.
  const safeUsed = Math.max(0, used);
  const safeTotal = Math.max(1, total);
  const pct = Math.min(100, Math.round((safeUsed / safeTotal) * 100));
  const over = used > total;
  const warn = warnOverride ?? pct >= 80;
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-all duration-300",
          over ? "bg-destructive" : warn ? "bg-amber-500" : "bg-primary"
        )}
        style={{ width: `${Math.max(2, pct)}%` }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}
