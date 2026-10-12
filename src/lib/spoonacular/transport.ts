import "server-only";
import { fixtureTransport } from "./fixtures";

export type SpoonacularResponse = { status: number; headers: Headers; body: unknown };

/**
 * One HTTP request to Spoonacular: a GET with `params` in the query string,
 * or a form POST when `form` is given. Throws on network failure or timeout.
 */
export type Transport = (path: string, params: URLSearchParams, form?: URLSearchParams) => Promise<SpoonacularResponse>;

const BASE_URL = "https://api.spoonacular.com";
export const TIMEOUT_MS = 8_000;

/**
 * The real API. The key goes in a header, never the URL, so it can't leak
 * into logs, caches or recorded fixtures.
 */
export const liveTransport: Transport = async (path, params, form) => {
  const apiKey = process.env.SPOONACULAR_API_KEY;
  if (!apiKey) throw new Error("SPOONACULAR_API_KEY is not set");
  const res = await fetch(`${BASE_URL}${path}?${params}`, {
    method: form ? "POST" : "GET",
    body: form,
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  return { status: res.status, headers: res.headers, body };
};

export function isLive() {
  return process.env.SPOONACULAR_LIVE === "1";
}

/** Fixtures unless SPOONACULAR_LIVE=1 (CLAUDE.md: mock by default). */
export function defaultTransport(): Transport {
  return isLive() ? liveTransport : fixtureTransport;
}
