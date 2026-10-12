import { z } from "zod";

// Only the fields we read. Spoonacular adds fields freely, so objects are loose.

const ingredient = z.looseObject({
  id: z.number().nullish(),
  name: z.string().nullish(),
  original: z.string().nullish(),
});

export const searchResultSchema = z.looseObject({
  id: z.number(),
  title: z.string(),
  image: z.string().nullish(),
  readyInMinutes: z.number().nullish(),
  servings: z.number().nullish(),
  sourceUrl: z.string().nullish(),
  sourceName: z.string().nullish(),
  // `fillIngredients=true` splits the list into used/missed; recipe
  // information responses carry `extendedIngredients` instead.
  extendedIngredients: z.array(ingredient).nullish(),
  usedIngredients: z.array(ingredient).nullish(),
  missedIngredients: z.array(ingredient).nullish(),
});

export const complexSearchSchema = z.looseObject({
  offset: z.number(),
  number: z.number(),
  totalResults: z.number(),
  results: z.array(searchResultSchema),
});

export type SearchResult = z.infer<typeof searchResultSchema>;
export type ComplexSearchResponse = z.infer<typeof complexSearchSchema>;

/** The recipe's ingredient lines as written ("1 lb chicken thighs"). */
export function ingredientLines(r: SearchResult): string[] {
  const list = r.extendedIngredients ?? [...(r.usedIngredients ?? []), ...(r.missedIngredients ?? [])];
  return list.map((i) => (i.original ?? i.name ?? "").trim()).filter(Boolean);
}

export const parsedIngredientSchema = z.looseObject({
  id: z.number().nullish(),
  original: z.string().nullish(),
  name: z.string().nullish(),
  amount: z.number().nullish(),
  unit: z.string().nullish(),
  unitShort: z.string().nullish(),
  aisle: z.string().nullish(),
});

export const parseIngredientsSchema = z.array(parsedIngredientSchema);

export type ParsedIngredient = z.infer<typeof parsedIngredientSchema>;
