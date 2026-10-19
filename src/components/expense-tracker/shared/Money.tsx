"use client";

import { formatMoney } from "@/lib/budget/money";

interface MoneyProps {
  minor: number;
  currency: string;
  withSymbol?: boolean;
  signed?: boolean;
  className?: string;
}

export function Money({ minor, currency, withSymbol = true, signed = false, className }: MoneyProps) {
  return <span className={className}>{formatMoney(minor, currency, { withSymbol, signed })}</span>;
}

interface MoneyInputProps {
  value: string;
  onChange: (s: string) => void;
  currency: string;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  inputMode?: "decimal" | "numeric";
}

export function MoneyInput({ value, onChange, currency, placeholder, className, autoFocus, inputMode = "decimal" }: MoneyInputProps) {
  // Display the symbol to the left of the input.
  const sym = new Intl.NumberFormat("en", { style: "currency", currency }).format(0).replace(/[\d.,\s]/g, "") || currency;
  return (
    <div className={`flex items-center gap-1 rounded-lg border border-input bg-background px-3 py-2 ${className ?? ""}`}>
      <span className="text-muted-foreground text-sm font-medium">{sym}</span>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "0.00"}
        autoFocus={autoFocus}
        className="w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
