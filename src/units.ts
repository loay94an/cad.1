import type { LengthUnit } from './model/schema';

export const UNIT_FACTOR: Record<LengthUnit, number> = { m: 1000, cm: 10, mm: 1 };
const DECIMALS: Record<LengthUnit, number> = { m: 3, cm: 1, mm: 0 };

/** Fixed decimals, for labels on the plan: 3.450 */
export function formatLength(mm: number, unit: LengthUnit): string {
  return (mm / UNIT_FACTOR[unit]).toFixed(DECIMALS[unit]);
}

/** For input fields: no trailing zeros, blank for 0. */
export function formatInput(mm: number, unit: LengthUnit): string {
  if (!mm) return '';
  return String(Number((mm / UNIT_FACTOR[unit]).toFixed(DECIMALS[unit])));
}

/** Accepts "3.45", "3,45", ".5", "3." — blank is 0, anything else is NaN. */
export function parseNumber(text: string): number {
  const t = text.trim().replace(',', '.');
  if (t === '') return 0;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  return parseFloat(t);
}

/** Parses a length typed in `unit` and returns millimetres (0.1 mm precision). */
export function parseLength(text: string, unit: LengthUnit): number {
  const n = parseNumber(text);
  return Number.isFinite(n) ? Math.round(n * UNIT_FACTOR[unit] * 10) / 10 : NaN;
}
