import { describe, expect, it } from "vitest";
import { classifyUnit, formatCount, formatMeasure, formatQuantity, normalizeUnit } from "./units";

describe("normalizeUnit", () => {
  it.each([
    ["Cups", "cup"],
    ["lbs", "lb"],
    ["Tbsps.", "tbsp"],
    ["cloves", "clove"],
    ["bunches", "bunch"],
    ["oz", "oz"],
    ["", ""],
    [null, ""],
  ])("%s → %s", (input, expected) => {
    expect(normalizeUnit(input)).toBe(expected);
  });
});

describe("classifyUnit", () => {
  it("puts mass and volume units in their dimension", () => {
    expect(classifyUnit("lb")).toMatchObject({ bucket: "mass", toCanonical: 453.592, metric: false });
    expect(classifyUnit("grams")).toMatchObject({ bucket: "mass", toCanonical: 1, metric: true });
    expect(classifyUnit("cups")).toMatchObject({ bucket: "volume", toCanonical: 236.588 });
    expect(classifyUnit("ml")).toMatchObject({ bucket: "volume", metric: true });
    expect(classifyUnit("fl oz")).toMatchObject({ bucket: "volume" });
  });

  it("tells T (tablespoon) from t (teaspoon)", () => {
    expect(classifyUnit("T")).toMatchObject({ bucket: "volume", toCanonical: 14.7868 });
    expect(classifyUnit("t")).toMatchObject({ bucket: "volume", toCanonical: 4.92892 });
  });

  it("treats no unit, 'whole' and sizes as a plain count", () => {
    for (const u of ["", null, "whole", "large", "Medium"]) expect(classifyUnit(u).bucket).toBe("unit:");
  });

  it("gives every other unit its own bucket", () => {
    expect(classifyUnit("cans").bucket).toBe("unit:can");
    expect(classifyUnit("clove").bucket).toBe("unit:clove");
    expect(classifyUnit("head").bucket).toBe("unit:head");
  });
});

describe("formatting", () => {
  it("uses cooking fractions where close", () => {
    expect(formatQuantity(1.5)).toBe("1½");
    expect(formatQuantity(0.3333)).toBe("⅓");
    expect(formatQuantity(2)).toBe("2");
    expect(formatQuantity(2.1)).toBe("2.1");
    expect(formatQuantity(12.4)).toBe("12");
  });

  it("shows imperial mass in oz below a pound, lb above", () => {
    expect(formatMeasure(453.592 * 1.5, "mass", false)).toBe("1½ lb");
    expect(formatMeasure(28.3495 * 12, "mass", false)).toBe("12 oz");
    expect(formatMeasure(28.3495 * 16, "mass", false)).toBe("1 lb");
  });

  it("shows metric mass in g and kg", () => {
    expect(formatMeasure(450, "mass", true)).toBe("450 g");
    expect(formatMeasure(1500, "mass", true)).toBe("1.5 kg");
  });

  it("shows imperial volume in tsp, tbsp or cups", () => {
    expect(formatMeasure(4.92892 * 2, "volume", false)).toBe("2 tsp");
    expect(formatMeasure(14.7868 * 3, "volume", false)).toBe("3 tbsp");
    expect(formatMeasure(236.588 * 3, "volume", false)).toBe("3 cups");
    expect(formatMeasure(236.588, "volume", false)).toBe("1 cup");
    expect(formatMeasure(250, "volume", true)).toBe("250 ml");
  });

  it("pluralizes count units", () => {
    expect(formatCount(2, "")).toBe("2");
    expect(formatCount(1, "can")).toBe("1 can");
    expect(formatCount(3, "clove")).toBe("3 cloves");
    expect(formatCount(2, "bunch")).toBe("2 bunches");
  });
});
