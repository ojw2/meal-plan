import type { SessionUser } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/errors";

/** Every mutation calls this first (CLAUDE.md: adult role enforced server-side). */
export function assertAdult(actor: SessionUser): void {
  if (actor.role !== "adult") throw new ForbiddenError();
}
