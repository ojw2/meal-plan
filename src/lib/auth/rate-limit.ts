// SPEC §7: 5 failed attempts per username per 15 minutes → temporary lockout.
export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;

export type Attempt = { success: boolean; attemptedAt: Date };

/**
 * Returns when the lockout ends, or null if the username may try again.
 * Only failures after the most recent success, within the window, count.
 */
export function lockedUntil(attempts: Attempt[], now: Date): Date | null {
  const sorted = [...attempts].sort((a, b) => b.attemptedAt.getTime() - a.attemptedAt.getTime());
  const recentFailures: Date[] = [];
  for (const a of sorted) {
    if (a.success) break;
    if (now.getTime() - a.attemptedAt.getTime() >= WINDOW_MS) break;
    recentFailures.push(a.attemptedAt);
  }
  if (recentFailures.length < MAX_FAILURES) return null;
  // Unlocks once the 5th-most-recent failure leaves the window.
  return new Date(recentFailures[MAX_FAILURES - 1].getTime() + WINDOW_MS);
}
