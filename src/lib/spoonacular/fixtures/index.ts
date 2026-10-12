import corpus from "./recipes.json";
import { parseLine } from "./parse";
import type { SpoonacularResponse, Transport } from "../transport";

/**
 * Stand-in for the Spoonacular API (used unless SPOONACULAR_LIVE=1). It
 * answers `complexSearch` by filtering a small fixture corpus the way the
 * real endpoint does, so relaxation and paging behave realistically, and it
 * sends quota headers for a 150-point free tier.
 *
 * `parseIngredients` uses a small rule-based parser (./parse.ts).
 *
 * Two magic ingredients exercise the failure paths in dev and e2e:
 * "quota-exhausted" answers 402 and "spoonacular-down" times out. In
 * `parseIngredients`, a line containing either does the same.
 */

type Fixture = (typeof corpus.recipes)[number];

const DAILY_POINTS = 150;
const usedByDay = new Map<string, number>();

const contains = (haystack: string, needle: string) => haystack.toLowerCase().includes(needle.toLowerCase());

function quotaHeaders(cost: number): Headers {
  const day = new Date().toISOString().slice(0, 10); // quota resets at midnight UTC
  const used = (usedByDay.get(day) ?? 0) + cost;
  usedByDay.set(day, used);
  return new Headers({
    "content-type": "application/json",
    "x-api-quota-request": String(cost),
    "x-api-quota-used": String(Math.round(used * 100) / 100),
    "x-api-quota-left": String(Math.max(0, Math.round((DAILY_POINTS - used) * 100) / 100)),
  });
}

const QUOTA_EXHAUSTED: SpoonacularResponse = {
  status: 402,
  headers: new Headers({ "content-type": "application/json" }),
  body: { status: "failure", code: 402, message: "Your daily points limit of 150 has been reached." },
};

const timeout = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");

function complexSearch(params: URLSearchParams): SpoonacularResponse {
  const include = (params.get("includeIngredients") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const query = params.get("query")?.trim() ?? "";
  const terms = [...include, query];
  if (terms.includes("quota-exhausted")) return QUOTA_EXHAUSTED;
  if (terms.includes("spoonacular-down")) throw timeout();

  const type = params.get("type");
  const maxReadyTime = Number(params.get("maxReadyTime") ?? Infinity);
  const matches = corpus.recipes.filter(
    (r) =>
      (!type || r.dishTypes.includes(type)) &&
      r.readyInMinutes <= maxReadyTime &&
      include.every((term) => r.extendedIngredients.some((i) => contains(i.name, term))) &&
      (!query || contains(r.title, query)),
  );

  const offset = Number(params.get("offset") ?? 0);
  const number = Number(params.get("number") ?? 10);
  const page = matches.slice(offset, offset + number);
  const withInfo = params.get("addRecipeInformation") === "true";
  const withIngredients = params.get("fillIngredients") === "true";
  const results = page.map((r) => toResult(r, include, withInfo, withIngredients));
  // Roughly Spoonacular's pricing: 1 point plus a little per result and per add-on.
  const cost = 1 + page.length * (0.01 + (withInfo ? 0.025 : 0) + (withIngredients ? 0.025 : 0));
  return {
    status: 200,
    headers: quotaHeaders(cost),
    body: { offset, number, totalResults: matches.length, results },
  };
}

function toResult(r: Fixture, include: string[], withInfo: boolean, withIngredients: boolean) {
  const used = r.extendedIngredients.filter((i) => include.some((t) => contains(i.name, t)));
  return {
    id: r.id,
    title: r.title,
    image: r.image,
    imageType: r.imageType,
    ...(withInfo && {
      readyInMinutes: r.readyInMinutes,
      servings: r.servings,
      sourceUrl: r.sourceUrl,
      sourceName: r.sourceName,
      dishTypes: r.dishTypes,
    }),
    ...(withIngredients && {
      usedIngredients: used,
      missedIngredients: r.extendedIngredients.filter((i) => !used.includes(i)),
    }),
  };
}

function parseIngredients(form: URLSearchParams): SpoonacularResponse {
  const lines = (form.get("ingredientList") ?? "").split("\n").filter((l) => l.trim());
  if (lines.some((l) => l.includes("quota-exhausted"))) return QUOTA_EXHAUSTED;
  if (lines.some((l) => l.includes("spoonacular-down"))) throw timeout();
  // Like the real endpoint, lines it can't make sense of are left out.
  const body = lines.flatMap((l) => parseLine(l) ?? []);
  return { status: 200, headers: quotaHeaders(1 + lines.length * 0.5), body };
}

export const fixtureTransport: Transport = async (path, params, form) => {
  if (path === "/recipes/complexSearch") return complexSearch(params);
  if (path === "/recipes/parseIngredients" && form) return parseIngredients(form);
  return {
    status: 404,
    headers: new Headers({ "content-type": "application/json" }),
    body: { status: "failure", code: 404, message: `No fixture for ${path}` },
  };
};
