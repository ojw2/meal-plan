import { describe, expect, it } from "vitest";
import { groceryList, normalizeAisle, scaleFor, type CheckRow, type DishSource, type IngredientLine } from "./aggregate";

const line = (
  rawText: string,
  parsed?: { id?: number | null; name: string; amount?: number | null; unit?: string; aisle?: string },
): IngredientLine => ({
  rawText,
  name: parsed?.name ?? null,
  ingredientId: parsed?.id ?? null,
  amount: parsed?.amount ?? null,
  unit: parsed?.unit ?? null,
  aisle: parsed?.aisle ?? null,
});

const dish = (dishName: string, ingredients: IngredientLine[], scale = 1, date = "2026-10-12"): DishSource => ({
  dishName,
  date,
  scale,
  ingredients,
});

const onionWhole = (n: number) => line(`${n} onion`, { id: 11282, name: "onion", amount: n, aisle: "Produce" });
const onionCup = (n: number) =>
  line(`${n} cup chopped onion`, { id: 11282, name: "onion", amount: n, unit: "cup", aisle: "Produce" });

const items = (list: ReturnType<typeof groceryList>) => list.aisles.flatMap((a) => a.items);
const item = (list: ReturnType<typeof groceryList>, name: string) => items(list).find((i) => i.name === name)!;

describe("scaleFor", () => {
  it("scales by servings over recipe servings", () => {
    expect(scaleFor(6, 4)).toBe(1.5);
    expect(scaleFor(2, 4)).toBe(0.5);
  });
  it("doesn't scale a recipe with no servings", () => {
    expect(scaleFor(6, null)).toBe(1);
  });
});

describe("normalizeAisle", () => {
  it("takes the first of several aisles and falls back to Other", () => {
    expect(normalizeAisle("Baking;Spices and Seasonings")).toBe("Baking");
    expect(normalizeAisle(null)).toBe("Other");
    expect(normalizeAisle("?")).toBe("Other");
  });
});

describe("aggregation", () => {
  it("sums the same ingredient across dishes after converting units", () => {
    const list = groceryList(
      [
        dish("Stir-fry", [line("1 lb chicken", { id: 5, name: "chicken breast", amount: 1, unit: "lb", aisle: "Meat" })]),
        dish("Fajitas", [line("8 oz chicken", { id: 5, name: "chicken breast", amount: 8, unit: "oz", aisle: "Meat" })]),
        dish("Soup", [line("2 cups broth", { id: 6, name: "broth", amount: 2, unit: "cups", aisle: "Canned" })]),
        dish("Rice", [line("4 tbsp broth", { id: 6, name: "broth", amount: 4, unit: "tbsp", aisle: "Canned" })]),
      ],
      [],
    );
    expect(item(list, "Chicken breast").text).toBe("1½ lb");
    // 2 cups + 4 tbsp = 2¼ cups.
    expect(item(list, "Broth").text).toBe("2¼ cups");
  });

  it("scales each dish before summing", () => {
    const list = groceryList(
      [
        dish("Tacos", [line("1 lb beef", { id: 1, name: "ground beef", amount: 1, unit: "lb" })], 1.5),
        dish("Chili", [line("1 lb beef", { id: 1, name: "ground beef", amount: 1, unit: "lb" })], 0.5),
      ],
      [],
    );
    expect(item(list, "Ground beef").text).toBe("2 lb");
    expect(item(list, "Ground beef").sources.map((s) => s.text)).toEqual(["1½ lb", "½ lb"]);
  });

  it("never merges incompatible units: lists them side by side", () => {
    const list = groceryList([dish("A", [onionWhole(2)]), dish("B", [onionCup(1)])], []);
    const onion = item(list, "Onion");
    expect(onion.text).toBe("2 whole + 1 cup");
    expect(onion.buckets.map((b) => b.itemKey)).toEqual(["id:11282|unit:", "id:11282|volume"]);
    expect(onion.sources).toEqual([
      { dishName: "A", date: "2026-10-12", text: "2" },
      { dishName: "B", date: "2026-10-12", text: "1 cup" },
    ]);
  });

  it("keeps count units apart from each other", () => {
    const list = groceryList(
      [
        dish("A", [line("1 can tomatoes", { id: 9, name: "tomatoes", amount: 1, unit: "can" })]),
        dish("B", [line("2 cans tomatoes", { id: 9, name: "tomatoes", amount: 2, unit: "cans" })]),
        dish("C", [line("3 tomatoes", { id: 9, name: "tomatoes", amount: 3 })]),
      ],
      [],
    );
    expect(item(list, "Tomatoes").text).toBe("3 whole + 3 cans");
  });

  it("groups parsed ingredients without an id by name", () => {
    const list = groceryList(
      [
        dish("A", [line("salt", { name: "Salt", amount: 1, unit: "tsp" })]),
        dish("B", [line("salt", { name: "salt", amount: 1, unit: "tsp" })]),
      ],
      [],
    );
    expect(items(list)).toHaveLength(1);
    expect(item(list, "Salt").text).toBe("2 tsp");
  });

  it("lists unparsed lines as written under Other", () => {
    const list = groceryList([dish("A", [line("A pinch of saffron"), line("2 Lemons")]), dish("B", [line("2 lemons")])], []);
    expect(list.aisles.map((a) => a.aisle)).toEqual(["Other"]);
    // Identical lines share their normalized name; nothing else merges.
    expect(items(list).map((i) => [i.name, i.text, i.sources.length])).toEqual([
      ["2 Lemons", "", 2],
      ["A pinch of saffron", "", 1],
    ]);
  });

  it("includes pantry staples and items with no amount", () => {
    const list = groceryList([dish("A", [line("salt to taste", { id: 2047, name: "salt", aisle: "Spices and Seasonings" })])], []);
    expect(item(list, "Salt")).toMatchObject({ text: "", aisle: "Spices and Seasonings" });
  });

  it("groups by aisle alphabetically with Other last", () => {
    const list = groceryList(
      [
        dish("A", [
          line("x"),
          line("1 onion", { id: 1, name: "onion", amount: 1, aisle: "Produce" }),
          line("1 lb beef", { id: 2, name: "beef", amount: 1, unit: "lb", aisle: "Meat" }),
        ]),
      ],
      [],
    );
    expect(list.aisles.map((a) => a.aisle)).toEqual(["Meat", "Produce", "Other"]);
  });

  it("shows metric only when every amount was metric", () => {
    const metric = groceryList([dish("A", [line("500 g flour", { id: 3, name: "flour", amount: 500, unit: "g" })])], []);
    expect(item(metric, "Flour").text).toBe("500 g");
    const mixed = groceryList(
      [
        dish("A", [line("500 g flour", { id: 3, name: "flour", amount: 500, unit: "g" })]),
        dish("B", [line("1 lb flour", { id: 3, name: "flour", amount: 1, unit: "lb" })]),
      ],
      [],
    );
    expect(item(mixed, "Flour").text).toBe("2 lb");
  });
});

describe("check-offs", () => {
  const check = (itemKey: string, snapshot: number | null, label = "Onion"): CheckRow => ({
    itemKey,
    checked: true,
    snapshot,
    label,
  });

  it("an item is checked when all its buckets are", () => {
    const list = groceryList([dish("A", [onionWhole(2)])], [check("id:11282|unit:", 2)]);
    expect(item(list, "Onion")).toMatchObject({ checked: true, increase: null });
  });

  it("an unchecked row doesn't count", () => {
    const list = groceryList([dish("A", [onionWhole(2)])], [{ ...check("id:11282|unit:", 2), checked: false }]);
    expect(item(list, "Onion")).toMatchObject({ checked: false, increase: null });
  });

  it("stays checked when the amount drops", () => {
    const list = groceryList([dish("A", [onionWhole(1)])], [check("id:11282|unit:", 2)]);
    expect(item(list, "Onion").checked).toBe(true);
  });

  it("resurfaces with a note when more is needed", () => {
    const list = groceryList([dish("A", [onionWhole(2)]), dish("B", [onionWhole(1)])], [check("id:11282|unit:", 2)]);
    expect(item(list, "Onion")).toMatchObject({ checked: false, increase: "+1 onion" });
  });

  it("resurfaces when a new unit bucket appears", () => {
    const list = groceryList([dish("A", [onionWhole(2)]), dish("B", [onionCup(1)])], [check("id:11282|unit:", 2)]);
    expect(item(list, "Onion")).toMatchObject({ checked: false, increase: "+1 cup" });
  });

  it("describes increases in friendly units", () => {
    const beef = (lb: number) => line("beef", { id: 2, name: "beef", amount: lb, unit: "lb" });
    const list = groceryList([dish("A", [beef(1)]), dish("B", [beef(1)])], [check("id:2|mass", 453.592)]);
    expect(item(list, "Beef").increase).toBe("+1 lb");
  });

  it("moves checked items that left the plan to No longer needed; unchecked ones vanish", () => {
    const list = groceryList(
      [dish("A", [onionWhole(1)])],
      [
        check("id:1|mass", 900, "Beef: 2 lb"),
        check("id:1|unit:", 1, "Beef: 2 lb"),
        { itemKey: "id:3|unit:", checked: false, snapshot: null, label: "Limes" },
      ],
    );
    expect(list.noLongerNeeded).toEqual([{ key: "id:1", label: "Beef: 2 lb" }]);
    expect(items(list).map((i) => i.name)).toEqual(["Onion"]);
  });

  it("a checked bucket that disappeared doesn't affect a still-needed item", () => {
    const list = groceryList([dish("A", [onionWhole(2)])], [check("id:11282|unit:", 2), check("id:11282|volume", 236)]);
    expect(item(list, "Onion").checked).toBe(true);
    expect(list.noLongerNeeded).toEqual([]);
  });
});
