import corpus from "./recipes.json";

/**
 * Stand-in for `POST /recipes/parseIngredients`. A small rule-based parser:
 * leading amount, then a unit word, then the longest known ingredient name
 * in what's left. Known names come from the fixture corpus (with its ids)
 * plus a few staples, so suggested recipes and typed lines group the same
 * way they would with the real API.
 */

const AISLES: Record<string, string[]> = {
  Produce: [
    "lemon", "lime", "garlic", "bell pepper", "onion", "red onion", "snap peas", "romaine lettuce", "tomato",
    "broccoli", "cucumber", "mixed vegetables", "cauliflower", "apple", "cilantro", "potatoes", "rosemary",
    "celery", "asparagus", "carrots", "spinach", "zucchini", "mushrooms", "ginger", "scallions", "avocado",
  ],
  Meat: [
    "chicken thighs", "chicken breast", "chicken sausage", "ground beef", "flank steak", "pork chops", "bacon",
    "ground turkey",
  ],
  Seafood: ["salmon", "shrimp"],
  "Milk, Eggs, Other Dairy": ["yogurt", "heavy cream", "eggs", "butter", "milk", "sour cream"],
  Cheese: ["mozzarella", "parmesan", "cheddar"],
  "Oil, Vinegar, Salad Dressing": ["olive oil", "vegetable oil", "sesame oil", "caesar dressing", "mayonnaise"],
  "Spices and Seasonings": ["salt", "chili powder", "paprika", "garam masala", "taco seasoning", "black pepper", "cumin"],
  "Ethnic Foods": ["soy sauce", "teriyaki sauce", "flour tortillas", "taco shells", "coconut milk", "tofu", "sesame seeds"],
  "Canned and Jarred": ["marinara sauce", "chicken broth", "crushed tomatoes", "tomato sauce", "black beans"],
  Condiments: ["ketchup", "buffalo sauce"],
  Baking: ["honey", "breadcrumbs", "cornstarch", "flour", "maple syrup", "sugar"],
  "Pasta and Rice": ["rice", "linguine", "spaghetti", "pasta"],
  "Dried Fruits": ["dried cranberries"],
  Beverages: ["apple cider"],
};

type Known = { id: number; name: string; aisle: string };

const known: Known[] = (() => {
  const ids = new Map<string, number>();
  for (const r of corpus.recipes) for (const i of r.extendedIngredients) ids.set(i.name, i.id);
  let next = 20_000;
  return Object.entries(AISLES).flatMap(([aisle, names]) =>
    names.map((name) => ({ id: ids.get(name) ?? next++, name, aisle })),
  );
})();
// Longest first, so "red onion" wins over "onion".
known.sort((a, b) => b.name.length - a.name.length);

const UNITS = new Set([
  "g", "gram", "grams", "kg", "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds",
  "ml", "l", "liter", "liters", "tsp", "teaspoon", "teaspoons", "tbsp", "tablespoon", "tablespoons", "cup", "cups",
  "pint", "pints", "quart", "quarts",
  "can", "cans", "clove", "cloves", "head", "heads", "bunch", "bunches", "packet", "packets", "slice", "slices",
  "stalk", "stalks", "pinch", "pinches", "fillet", "fillets", "large", "medium", "small", "whole",
]);

const VULGAR: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };

function parseAmount(s: string): number {
  if (VULGAR[s] !== undefined) return VULGAR[s];
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(s);
}

export type FixtureParsed = {
  id: number | null;
  original: string;
  name: string;
  amount: number;
  unit: string;
  unitShort: string;
  aisle: string | null;
};

/** Parses one line, or returns null when there's nothing to parse. */
export function parseLine(original: string): FixtureParsed | null {
  let rest = original.trim();
  let amount = 1;
  const m = rest.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+|[½¼¾⅓⅔])(?:\s*-\s*\d*\.?\d+)?\s*/);
  if (m) {
    amount = parseAmount(m[1]);
    rest = rest.slice(m[0].length);
  }
  let unit = "";
  const fl = rest.match(/^fl\.?\s*oz\b\.?\s*/i);
  if (fl) {
    unit = "fl oz";
    rest = rest.slice(fl[0].length);
  } else {
    const word = rest.match(/^([A-Za-z]+)\.?\s+/);
    if (word && UNITS.has(word[1].toLowerCase())) {
      unit = word[1].toLowerCase();
      rest = rest.slice(word[0].length);
    }
  }
  rest = rest.replace(/^of\s+/i, "");
  const text = rest.split(",")[0].replace(/\(.*?\)/g, "").trim().toLowerCase();
  if (!text) return null;
  const match = known.find((k) => text.includes(k.name));
  return {
    id: match?.id ?? null,
    original,
    name: match?.name ?? text,
    amount,
    unit,
    unitShort: unit,
    aisle: match?.aisle ?? null,
  };
}
