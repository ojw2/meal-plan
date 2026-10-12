// Unit handling for the grocery list (SPEC §4.8, §7): a small conversion
// table for mass and volume, no density-based conversions. Anything else
// ("can", "clove", no unit at all) is its own bucket and never merges with
// a different unit.

export type Dimension = "mass" | "volume";

/** Which bucket an amount sums into: a dimension, or one specific count unit. */
export type Bucket = Dimension | `unit:${string}`;

type Measure = { dimension: Dimension; toCanonical: number; metric: boolean };

// Canonical units: grams for mass, millilitres for volume.
const MASS: Record<string, Omit<Measure, "dimension">> = {
  mg: { toCanonical: 0.001, metric: true },
  g: { toCanonical: 1, metric: true },
  gram: { toCanonical: 1, metric: true },
  kg: { toCanonical: 1000, metric: true },
  kilogram: { toCanonical: 1000, metric: true },
  oz: { toCanonical: 28.3495, metric: false },
  ounce: { toCanonical: 28.3495, metric: false },
  lb: { toCanonical: 453.592, metric: false },
  pound: { toCanonical: 453.592, metric: false },
};

const TSP_ML = 4.92892;
const TBSP_ML = 14.7868;
const CUP_ML = 236.588;

const VOLUME: Record<string, Omit<Measure, "dimension">> = {
  ml: { toCanonical: 1, metric: true },
  milliliter: { toCanonical: 1, metric: true },
  millilitre: { toCanonical: 1, metric: true },
  cl: { toCanonical: 10, metric: true },
  dl: { toCanonical: 100, metric: true },
  l: { toCanonical: 1000, metric: true },
  liter: { toCanonical: 1000, metric: true },
  litre: { toCanonical: 1000, metric: true },
  tsp: { toCanonical: TSP_ML, metric: false },
  teaspoon: { toCanonical: TSP_ML, metric: false },
  tbsp: { toCanonical: TBSP_ML, metric: false },
  tbs: { toCanonical: TBSP_ML, metric: false },
  tablespoon: { toCanonical: TBSP_ML, metric: false },
  cup: { toCanonical: CUP_ML, metric: false },
  c: { toCanonical: CUP_ML, metric: false },
  "fl oz": { toCanonical: 29.5735, metric: false },
  "fluid ounce": { toCanonical: 29.5735, metric: false },
  pint: { toCanonical: 473.176, metric: false },
  pt: { toCanonical: 473.176, metric: false },
  quart: { toCanonical: 946.353, metric: false },
  qt: { toCanonical: 946.353, metric: false },
  gallon: { toCanonical: 3785.41, metric: false },
  gal: { toCanonical: 3785.41, metric: false },
};

/** Size words and "whole" describe a plain count ("2 large eggs" = 2 eggs). */
const COUNT_WORDS = new Set(["", "whole", "small", "medium", "large", "extra large", "piece", "serving"]);

/** Lowercase, trimmed, no trailing period, singular ("Cloves" → "clove", "Tbsps." → "tbsp"). */
export function normalizeUnit(unit: string | null | undefined): string {
  const u = (unit ?? "").trim().replace(/\.$/, "").replace(/\s+/g, " ").toLowerCase();
  if (u.length <= 2 || u.endsWith("ss")) return u;
  if (/(ch|sh|x)es$/.test(u)) return u.slice(0, -2);
  if (u.endsWith("s")) return u.slice(0, -1);
  return u;
}

export type UnitInfo =
  | ({ bucket: Dimension } & Measure)
  | { bucket: `unit:${string}`; dimension: null; unit: string };

export function classifyUnit(unit: string | null | undefined): UnitInfo {
  // "T" is the one unit where case matters: tablespoon, not teaspoon.
  const raw = (unit ?? "").trim();
  if (raw === "T" || raw === "Tb") return { bucket: "volume", dimension: "volume", ...VOLUME.tbsp };
  const u = normalizeUnit(raw);
  if (u === "t") return { bucket: "volume", dimension: "volume", ...VOLUME.tsp };
  if (MASS[u]) return { bucket: "mass", dimension: "mass", ...MASS[u] };
  if (VOLUME[u]) return { bucket: "volume", dimension: "volume", ...VOLUME[u] };
  const countUnit = COUNT_WORDS.has(u) ? "" : u;
  return { bucket: `unit:${countUnit}`, dimension: null, unit: countUnit };
}

// ---------------------------------------------------------------------------
// Display

const FRACTIONS: [number, string][] = [
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [1 / 2, "½"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
];

/** 1.5 → "1½", 0.333 → "⅓", 2.1 → "2.1". Cooking-friendly where it's close. */
export function formatQuantity(n: number): string {
  if (n <= 0) return "0";
  const whole = Math.floor(n + 0.02);
  const frac = n - whole;
  if (Math.abs(frac) < 0.02) return String(whole);
  for (const [value, glyph] of FRACTIONS) {
    if (Math.abs(frac - value) < 0.02) return whole ? `${whole}${glyph}` : glyph;
  }
  return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

/** Rounds to the nearest quarter, never down to zero. */
const quarter = (n: number) => Math.max(0.25, Math.round(n * 4) / 4);

const plural = (n: number, one: string, many = `${one}s`) => (n > 1 + 1e-9 ? many : one);

/**
 * Formats a canonical amount (g or ml) in friendly units: imperial unless
 * every contributing amount was metric.
 */
export function formatMeasure(canonical: number, dimension: Dimension, metric: boolean): string {
  if (dimension === "mass") {
    if (metric) {
      if (canonical >= 1000) return `${Math.round(canonical / 100) / 10} kg`;
      return `${Math.max(1, Math.round(canonical))} g`;
    }
    const oz = canonical / MASS.oz.toCanonical;
    if (oz >= 16 - 0.05) return `${formatQuantity(quarter(oz / 16))} lb`;
    return `${formatQuantity(Math.max(0.5, Math.round(oz * 2) / 2))} oz`;
  }
  if (metric) {
    if (canonical >= 1000) return `${Math.round(canonical / 100) / 10} l`;
    return `${Math.max(1, Math.round(canonical))} ml`;
  }
  if (canonical < TBSP_ML - 0.1) return `${formatQuantity(quarter(canonical / TSP_ML))} tsp`;
  if (canonical < CUP_ML / 4 - 0.1) return `${formatQuantity(quarter(canonical / TBSP_ML))} tbsp`;
  const cups = quarter(canonical / CUP_ML);
  return `${formatQuantity(cups)} ${plural(cups, "cup")}`;
}

/** "2", "1½ cans", "3 cloves". */
export function formatCount(amount: number, unit: string): string {
  const q = formatQuantity(amount);
  if (!unit) return q;
  const many = /(ch|sh|s|x)$/.test(unit) ? `${unit}es` : `${unit}s`;
  return `${q} ${plural(amount, unit, many)}`;
}
