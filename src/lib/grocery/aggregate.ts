import { classifyUnit, formatCount, formatMeasure, formatQuantity, type Bucket, type Dimension } from "./units";

// Grocery list derivation (SPEC §4.8). Pure: the service loads a week's
// dishes and check-offs, and this turns them into the list. Nothing here is
// stored except what `snapshotFor` hands back when an item is checked.

export type IngredientLine = {
  rawText: string;
  /** Null until Spoonacular has parsed the line (or if it couldn't). */
  name: string | null;
  ingredientId: number | null;
  amount: number | null;
  unit: string | null;
  aisle: string | null;
};

/** One dish on a planned night, with its scale factor already worked out. */
export type DishSource = {
  dishName: string;
  date: string;
  /** (servings override ?? household default) / recipe servings, or 1. */
  scale: number;
  ingredients: IngredientLine[];
};

export type CheckRow = {
  itemKey: string;
  checked: boolean;
  snapshot: number | null;
  /** What the item read as when it was checked, for "No longer needed". */
  label: string | null;
};

export type Contribution = { dishName: string; date: string; text: string };

export type GroceryBucket = {
  /** `<group key>|<bucket>`: what a check-off is stored under. */
  itemKey: string;
  bucket: Bucket;
  /** Grams, millilitres, or a count in the bucket's unit. Null if no line gave an amount. */
  amount: number | null;
  text: string;
};

export type GroceryItem = {
  /** `id:<spoonacular id>` or `name:<lowercase name>`. */
  key: string;
  name: string;
  aisle: string;
  /** "2 + 1 cup": every bucket, side by side. Empty if no amounts are known. */
  text: string;
  buckets: GroceryBucket[];
  sources: Contribution[];
  checked: boolean;
  /** Set when more is needed than when it was checked, e.g. "+1 cup". */
  increase: string | null;
};

export type GroceryList = {
  aisles: { aisle: string; items: GroceryItem[] }[];
  /** Checked items that dropped out of the plan (already bought). */
  noLongerNeeded: { key: string; label: string }[];
};

export const OTHER_AISLE = "Other";

const normalizeName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Spoonacular aisles can list several ("Baking;Spices and Seasonings"); use the first. */
export function normalizeAisle(aisle: string | null): string {
  const first = aisle?.split(";")[0]?.trim();
  return first && first !== "?" ? first : OTHER_AISLE;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The group key part of an item key (everything before the last "|"). */
export const groupKeyOf = (itemKey: string) => itemKey.slice(0, itemKey.lastIndexOf("|"));

type Acc = {
  key: string;
  name: string;
  aisle: string;
  buckets: Map<Bucket, { amount: number | null; metric: boolean; dimension: Dimension | null; unit: string }>;
  sources: Contribution[];
};

function lineGroup(line: IngredientLine): { key: string; name: string; aisle: string; parsed: boolean } {
  if (line.name) {
    const name = normalizeName(line.name);
    return {
      key: line.ingredientId != null ? `id:${line.ingredientId}` : `name:${name}`,
      name,
      aisle: normalizeAisle(line.aisle),
      parsed: true,
    };
  }
  // Unparsed: fall back to the line itself, unmerged under "Other".
  return { key: `name:${normalizeName(line.rawText)}`, name: line.rawText.trim(), aisle: OTHER_AISLE, parsed: false };
}

function bucketText(b: { amount: number | null; metric: boolean; dimension: Dimension | null; unit: string }): string {
  if (b.amount === null) return "";
  return b.dimension ? formatMeasure(b.amount, b.dimension, b.metric) : formatCount(b.amount, b.unit);
}

// Plain counts first, as in "Onion: 2 whole + 1 cup".
const BUCKET_ORDER = (b: Bucket) => (b === "unit:" ? 0 : b === "mass" ? 1 : b === "volume" ? 2 : 3);

/** Sums every dish's ingredients into items, before check-offs are applied. */
export function aggregate(dishes: DishSource[]): Omit<GroceryItem, "checked" | "increase">[] {
  const groups = new Map<string, Acc>();
  for (const dish of dishes) {
    for (const line of dish.ingredients) {
      const g = lineGroup(line);
      const acc =
        groups.get(g.key) ??
        groups.set(g.key, { key: g.key, name: g.name, aisle: g.aisle, buckets: new Map(), sources: [] }).get(g.key)!;
      // A parsed line knows its aisle even if an unparsed one came first.
      if (acc.aisle === OTHER_AISLE && g.aisle !== OTHER_AISLE) acc.aisle = g.aisle;

      const scaled = line.amount != null && g.parsed ? line.amount * dish.scale : null;
      const info = classifyUnit(g.parsed ? line.unit : null);
      const prev = acc.buckets.get(info.bucket);
      const add = scaled === null ? null : info.dimension ? scaled * info.toCanonical : scaled;
      acc.buckets.set(info.bucket, {
        amount: add === null ? (prev?.amount ?? null) : (prev?.amount ?? 0) + add,
        // Show metric only if every amount in the bucket was metric.
        metric: (prev?.metric ?? true) && (info.dimension ? info.metric : true),
        dimension: info.dimension,
        unit: info.dimension ? "" : info.unit,
      });

      acc.sources.push({
        dishName: dish.dishName,
        date: dish.date,
        text:
          scaled === null
            ? line.rawText
            : `${formatQuantity(scaled)}${line.unit ? ` ${line.unit}` : ""}`,
      });
    }
  }

  return [...groups.values()].map((acc) => {
    const buckets = [...acc.buckets.entries()]
      .sort(([a], [b]) => BUCKET_ORDER(a) - BUCKET_ORDER(b) || a.localeCompare(b))
      .map(([bucket, b]) => ({ itemKey: `${acc.key}|${bucket}`, bucket, amount: b.amount, text: bucketText(b) }));
    return {
      key: acc.key,
      name: capitalize(acc.name),
      aisle: acc.aisle,
      text: buckets
        .filter((b) => b.text)
        // A bare count needs a word when other units sit beside it.
        .map((b) => (b.bucket === "unit:" && buckets.length > 1 ? `${b.text} whole` : b.text))
        .join(" + "),
      buckets,
      sources: acc.sources,
    };
  });
}

const EPSILON = 1e-6;
const more = (current: number | null, snapshot: number | null) =>
  (current ?? 0) > (snapshot ?? 0) * (1 + EPSILON) + EPSILON;

/**
 * Applies check-offs. An item is checked when all its buckets are and none
 * needs more than when it was checked; otherwise it resurfaces with a note.
 */
export function applyChecks(items: Omit<GroceryItem, "checked" | "increase">[], checks: CheckRow[]): GroceryList {
  const byKey = new Map(checks.map((c) => [c.itemKey, c]));
  const out: GroceryItem[] = items.map((item) => {
    const rows = item.buckets.map((b) => byKey.get(b.itemKey));
    if (!rows.some((r) => r?.checked)) return { ...item, checked: false, increase: null };
    const increases: string[] = [];
    item.buckets.forEach((b, i) => {
      const row = rows[i];
      // A bucket that wasn't there when the item was checked is all new.
      const snapshot = row?.checked ? row.snapshot : 0;
      if (!row?.checked || more(b.amount, snapshot)) increases.push(increaseText(item.name, b, snapshot));
    });
    return { ...item, checked: increases.length === 0, increase: increases.length ? increases.join(", ") : null };
  });

  const present = new Set(items.map((i) => i.key));
  const gone = new Map<string, string>();
  for (const c of checks) {
    const key = groupKeyOf(c.itemKey);
    if (c.checked && !present.has(key) && !gone.has(key)) gone.set(key, c.label ?? key.replace(/^\w+:/, ""));
  }

  const aisles = new Map<string, GroceryItem[]>();
  for (const item of out.sort((a, b) => a.name.localeCompare(b.name))) {
    aisles.set(item.aisle, [...(aisles.get(item.aisle) ?? []), item]);
  }
  return {
    aisles: [...aisles.entries()]
      .sort(([a], [b]) => (a === OTHER_AISLE ? 1 : b === OTHER_AISLE ? -1 : a.localeCompare(b)))
      .map(([aisle, items]) => ({ aisle, items })),
    noLongerNeeded: [...gone.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

function increaseText(name: string, b: GroceryBucket, snapshot: number | null): string {
  if (b.amount === null) return "more";
  const delta = b.amount - (snapshot ?? 0);
  if (b.bucket === "mass" || b.bucket === "volume") {
    // Imperial unless the current amount reads as metric.
    const metric = /\b(g|kg|ml|l)$/.test(b.text);
    return `+${formatMeasure(delta, b.bucket, metric)}`;
  }
  const unit = b.bucket.slice("unit:".length);
  return unit ? `+${formatCount(delta, unit)}` : `+${formatQuantity(delta)} ${name.toLowerCase()}`;
}

/** The full list for a week. */
export function groceryList(dishes: DishSource[], checks: CheckRow[]): GroceryList {
  return applyChecks(aggregate(dishes), checks);
}

/** The scale factor for one dish (SPEC §4.8). */
export function scaleFor(servings: number, recipeServings: number | null): number {
  return recipeServings && recipeServings > 0 ? servings / recipeServings : 1;
}
