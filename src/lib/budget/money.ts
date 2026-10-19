// Money utilities — all money is integer minor units (paise). Never floats.
// Currency codes follow ISO 4217. Field suffix is `_minor` per spec.

export type Minor = number; // integer minor units

export interface CurrencyInfo {
  code: string; // ISO 4217
  symbol: string;
  fractionDigits: number; // typically 2
  thousandsSeparator: string;
  decimalSeparator: string;
}

// Currency catalog. v1 supports a single currency per data set, but we ship a
// handful of common ones for display. The display uses the data-set's code.
const CATALOG: Record<string, CurrencyInfo> = {
  INR: { code: "INR", symbol: "₹", fractionDigits: 2, thousandsSeparator: ",", decimalSeparator: "." },
  USD: { code: "USD", symbol: "$", fractionDigits: 2, thousandsSeparator: ",", decimalSeparator: "." },
  EUR: { code: "EUR", symbol: "€", fractionDigits: 2, thousandsSeparator: ".", decimalSeparator: "," },
  GBP: { code: "GBP", symbol: "£", fractionDigits: 2, thousandsSeparator: ",", decimalSeparator: "." },
  JPY: { code: "JPY", symbol: "¥", fractionDigits: 0, thousandsSeparator: ",", decimalSeparator: "." },
  AED: { code: "AED", symbol: "AED", fractionDigits: 2, thousandsSeparator: ",", decimalSeparator: "." },
  SGD: { code: "SGD", symbol: "S$", fractionDigits: 2, thousandsSeparator: ",", decimalSeparator: "." },
  AUD: { code: "AUD", symbol: "A$", fractionDigits: 2, thousandsSeparator: ",", decimalSeparator: "." },
  CAD: { code: "CAD", symbol: "C$", fractionDigits: 2, thousandsSeparator: ",", decimalSeparator: "." },
  PKR: { code: "PKR", symbol: "₨", fractionDigits: 2, thousandsSeparator: ",", decimalSeparator: "." },
  BDT: { code: "BDT", symbol: "৳", fractionDigits: 2, thousandsSeparator: ",", decimalSeparator: "." },
  NGN: { code: "NGN", symbol: "₦", fractionDigits: 2, thousandsSeparator: ",", decimalSeparator: "." },
  KES: { code: "KES", symbol: "KSh", fractionDigits: 2, thousandsSeparator: ",", decimalSeparator: "." },
  ZAR: { code: "ZAR", symbol: "R", fractionDigits: 2, thousandsSeparator: " ", decimalSeparator: "." },
};

export const CURRENCY_CODES = Object.keys(CATALOG);

export function getCurrency(code: string): CurrencyInfo {
  return CATALOG[code] ?? {
    code,
    symbol: code,
    fractionDigits: 2,
    thousandsSeparator: ",",
    decimalSeparator: ".",
  };
}

export function listCurrencies(): CurrencyInfo[] {
  return CURRENCY_CODES.map((c) => CATALOG[c]);
}

// Format an integer-minor-unit amount as a human-readable string.
export function formatMoney(
  minor: number,
  currencyCode: string,
  opts?: { withSymbol?: boolean; signed?: boolean }
): string {
  const cur = getCurrency(currencyCode);
  const neg = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const factor = Math.pow(10, cur.fractionDigits);
  const whole = Math.floor(abs / factor);
  const frac = abs % factor;

  const wholeStr = whole
    .toLocaleString("en-US", {
      useGrouping: true,
    })
    .replace(/,/g, cur.thousandsSeparator);

  let fracStr = "";
  if (cur.fractionDigits > 0) {
    fracStr = cur.decimalSeparator + frac.toString().padStart(cur.fractionDigits, "0");
  }

  const signStr = neg ? "-" : opts?.signed ? "+" : "";
  const sym = opts?.withSymbol === false ? "" : cur.symbol + (cur.symbol.length > 1 ? " " : "");
  return `${signStr}${sym}${wholeStr}${fracStr}`;
}

// Parse a user-typed money string into integer minor units.
// Accepts forms like "100", "100.50", "1,000.50", "100.5".
// Trims, ignores thousands separators, and rounds half-to-even.
export function parseMoneyToMinor(input: string, currencyCode: string): number | null {
  const cur = getCurrency(currencyCode);
  const trimmed = input.trim();
  if (!trimmed) return 0;
  const noSep = trimmed.replace(new RegExp(`[${cur.thousandsSeparator}]`, "g"), "");
  const normalized = cur.decimalSeparator !== "." ? noSep.replace(cur.decimalSeparator, ".") : noSep;
  const ok = /^[-+]?\d*(\.\d+)?$/.test(normalized);
  if (!ok) return null;
  if (normalized === "-" || normalized === "+" || normalized === "") return 0;
  const num = Number(normalized);
  if (!isFinite(num)) return null;
  const minor = Math.round(num * Math.pow(10, cur.fractionDigits));
  return Math.trunc(minor);
}

// Format minor units into a major-unit number string (used for inputs that show major units).
export function minorToMajorInput(minor: number, currencyCode: string): string {
  const cur = getCurrency(currencyCode);
  const factor = Math.pow(10, cur.fractionDigits);
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / factor);
  const frac = abs % factor;
  const sign = minor < 0 ? "-" : "";
  if (cur.fractionDigits === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${frac.toString().padStart(cur.fractionDigits, "0")}`;
}

export function addMinor(a: number, b: number): number {
  return Math.trunc(a) + Math.trunc(b);
}
export function subMinor(a: number, b: number): number {
  return Math.trunc(a) - Math.trunc(b);
}

// Compute percent allocation: percent is in basis points (1% = 100 bps).
// Result is integer minor units; any rounding remainder goes to Unallocated.
export function percentToMinor(salaryMinor: number, basisPoints: number): number {
  const product = Math.trunc(salaryMinor) * Math.trunc(basisPoints);
  return Math.trunc(product / 10000);
}

export function percentToBasisPoints(percent: number): number {
  return Math.round(percent * 100);
}

export function basisPointsToPercent(bps: number): string {
  const whole = bps / 100;
  return whole % 1 === 0 ? whole.toFixed(0) : whole.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
