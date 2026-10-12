/**
 * CSRF guard for state-changing or quota-spending route handlers (SPEC §7).
 * Server actions get this check from Next; route handlers must do it
 * themselves. Browsers always send `Origin` on a POST from fetch.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
