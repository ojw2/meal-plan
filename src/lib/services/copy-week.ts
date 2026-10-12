import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { dinners, dishes } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";
import { publishDinnerDates } from "@/lib/events";
import { addDays, isIsoDate, weekStartOf } from "@/lib/time";
import { defaultCookFor, getDinners, plannerCalendar } from "./planner";
import { assertAdult } from "./permissions";
import { materializeIn } from "./recurring";

export type CopyResult = {
  /** Nights filled from last week. */
  filled: number;
  /** Nights skipped because they were already planned (or eat out / leftovers). */
  skipped: number;
  /** Nights skipped because they're already past. */
  past: number;
};

/**
 * Copy last week (SPEC §4.7): fills the empty nights of the week containing
 * `date`, from today on, with the same weekday's dishes or night status from
 * the week before. It never overwrites a night. Recurring meals go first, so
 * their nights count as taken. Cooks come from the current default schedule.
 */
export async function copyLastWeek(db: Db, actor: SessionUser, date: string, now = new Date()): Promise<CopyResult> {
  assertAdult(actor);
  if (!isIsoDate(date)) throw new ServiceError("Invalid date.");
  const cal = await plannerCalendar(db, now);
  const weekStart = weekStartOf(date, cal.weekStartDay);
  const result: CopyResult = { filled: 0, skipped: 0, past: 0 };
  const changed: string[] = [];

  await db.transaction(async (tx) => {
    changed.push(...(await materializeIn(tx, weekStart, addDays(weekStart, 6), cal.today)));
    const source = await getDinners(tx, addDays(weekStart, -7), addDays(weekStart, -1));
    for (const [i, from] of source.entries()) {
      if (from.status === "unplanned") continue;
      const target = addDays(weekStart, i);
      if (target < cal.today) {
        result.past++;
        continue;
      }
      await tx.insert(dinners).values({ date: target }).onConflictDoNothing({ target: dinners.date });
      const [dinner] = await tx.select().from(dinners).where(eq(dinners.date, target)).for("update");
      if (dinner.status !== "unplanned") {
        result.skipped++;
        continue;
      }
      const planned = from.status === "planned";
      await tx
        .update(dinners)
        .set({
          status: from.status,
          cookUserId: planned ? await defaultCookFor(tx, target) : null,
          cookManuallySet: false,
          // A copied night belongs to no rule.
          recurringRuleId: null,
          overridden: false,
        })
        .where(eq(dinners.id, dinner.id));
      if (planned) {
        await tx.insert(dishes).values(
          from.dishes.map((d, position) => ({
            dinnerId: dinner.id,
            recipeId: d.recipe?.id ?? null,
            freeTextName: d.recipe ? null : d.name,
            role: d.role,
            position,
          })),
        );
      }
      result.filled++;
      changed.push(target);
    }
  });

  publishDinnerDates(changed, cal.weekStartDay);
  return result;
}
