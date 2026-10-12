import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/db";
import { dinners, dishes, recipes, recurringRules } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";
import { publish, publishDinnerDates } from "@/lib/events";
import { addDays, isIsoDate, weekdayOf } from "@/lib/time";
import { defaultCookFor, getDinner, plannerCalendar, type Tx } from "./planner";
import { assertAdult } from "./permissions";

// Recurring meals (SPEC §4.6). A rule is a weekday plus a template of dishes.
// Instances are created lazily: whenever a view reads a range of nights, any
// night from today on with no dinner row yet gets the matching rule's dishes
// and the default cook. Editing an instance marks it overridden; rule changes
// only replace future, non-overridden instances.

const role = z.enum(["main", "side"], { error: "Pick main or side" });

/** Dishes per recurring meal (and rows in its form). */
export const MAX_RULE_DISHES = 6;

const templateDishSchema = z.union([
  z.object({ recipeId: z.uuid(), role }),
  z.object({ freeTextName: z.string().min(1).max(120), role }),
]);
export type TemplateDish = z.infer<typeof templateDishSchema>;
const templateSchema = z.array(templateDishSchema).min(1).max(MAX_RULE_DISHES);

type Rule = typeof recurringRules.$inferSelect;

const isoDate = z.string().trim().refine(isIsoDate, "Enter a valid date");

export const ruleInputSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startDate: isoDate,
    endDate: z.union([z.literal(""), isoDate]).transform((v) => v || null),
    /** Typed dish names. A name matching a library recipe's title links that recipe. */
    dishes: z
      .array(z.object({ role, name: z.string().trim().max(120, "Dish name is too long") }))
      .transform((ds) => ds.filter((d) => d.name))
      .pipe(z.array(z.object({ role, name: z.string() })).min(1, "Add at least one dish").max(MAX_RULE_DISHES, `At most ${MAX_RULE_DISHES} dishes`)),
  })
  .refine((r) => !r.endDate || r.endDate >= r.startDate, { message: "The end date must be after the start date" });
export type RuleInput = z.input<typeof ruleInputSchema>;

// ---------------------------------------------------------------------------
// Reads

export type RuleView = {
  id: string;
  weekday: number;
  startDate: string;
  endDate: string | null;
  active: boolean;
  dishes: { role: "main" | "side"; name: string; recipeId: string | null }[];
};

/** Active rules first, then by weekday. */
export async function listRules(db: DbOrTx): Promise<RuleView[]> {
  const rows = await db
    .select()
    .from(recurringRules)
    .orderBy(desc(recurringRules.active), asc(recurringRules.weekday), asc(recurringRules.createdAt));
  const templates = rows.map((r) => templateSchema.parse(r.template));
  const recipeIds = [...new Set(templates.flat().flatMap((d) => ("recipeId" in d ? [d.recipeId] : [])))];
  const titles = new Map(
    recipeIds.length
      ? (
          await db.select({ id: recipes.id, title: recipes.title }).from(recipes).where(inArray(recipes.id, recipeIds))
        ).map((r) => [r.id, r.title])
      : [],
  );
  return rows.map((r, i) => ({
    id: r.id,
    weekday: r.weekday,
    startDate: r.startDate,
    endDate: r.endDate,
    active: r.active,
    dishes: templates[i].map((d) =>
      "recipeId" in d
        ? { role: d.role, name: titles.get(d.recipeId) ?? "", recipeId: d.recipeId }
        : { role: d.role, name: d.freeTextName, recipeId: null },
    ),
  }));
}

// ---------------------------------------------------------------------------
// Instances

const ruleCovers = (rule: Rule, date: string) =>
  rule.weekday === weekdayOf(date) && rule.startDate <= date && (!rule.endDate || date <= rule.endDate);

async function activeRules(db: DbOrTx): Promise<Rule[]> {
  return db
    .select()
    .from(recurringRules)
    .where(eq(recurringRules.active, true))
    .orderBy(asc(recurringRules.createdAt));
}

/**
 * Fills `dates` (already filtered to today on) from the rules that cover
 * them, skipping nights that already have a dinner row. Returns the dates
 * filled.
 */
async function fillNights(tx: Tx, rules: Rule[], dates: string[]): Promise<string[]> {
  const filled: string[] = [];
  for (const date of dates) {
    const rule = rules.find((r) => ruleCovers(r, date));
    if (!rule) continue;
    const [dinner] = await tx
      .insert(dinners)
      .values({
        date,
        status: "planned",
        cookUserId: await defaultCookFor(tx, date),
        recurringRuleId: rule.id,
      })
      .onConflictDoNothing({ target: dinners.date })
      .returning({ id: dinners.id });
    if (!dinner) continue;
    await tx.insert(dishes).values(
      templateSchema.parse(rule.template).map((d, position) => ({
        dinnerId: dinner.id,
        recipeId: "recipeId" in d ? d.recipeId : null,
        freeTextName: "freeTextName" in d ? d.freeTextName : null,
        role: d.role,
        position,
      })),
    );
    filled.push(date);
  }
  return filled;
}

/**
 * Creates any missing recurring instances for nights in [from, to] from
 * today on. Views call this before reading dinners. Returns the dates filled.
 */
export async function materializeRecurring(db: Db, from: string, to: string, now = new Date()): Promise<string[]> {
  const cal = await plannerCalendar(db, now);
  const filled = await db.transaction((tx) => materializeIn(tx, from, to, cal.today));
  publishDinnerDates(filled, cal.weekStartDay);
  return filled;
}

/** `materializeRecurring` inside an existing transaction; the caller publishes. */
export async function materializeIn(tx: Tx, from: string, to: string, today: string): Promise<string[]> {
  const start = from < today ? today : from;
  if (start > to) return [];
  const rules = (await activeRules(tx)).filter((r) => r.startDate <= to && (!r.endDate || r.endDate >= start));
  if (!rules.length) return [];
  const taken = new Set(
    (
      await tx
        .select({ date: dinners.date })
        .from(dinners)
        .where(and(gte(dinners.date, start), lte(dinners.date, to)))
    ).map((r) => r.date),
  );
  const open: string[] = [];
  for (let date = start; date <= to; date = addDays(date, 1)) if (!taken.has(date)) open.push(date);
  return fillNights(tx, rules, open);
}

/**
 * Re-applies a rule after it changed: its future, non-overridden instances
 * are removed and refilled from whichever active rule now covers them.
 * Returns every date touched.
 */
async function refreshInstances(tx: Tx, ruleId: string, today: string): Promise<string[]> {
  const removed = await tx
    .delete(dinners)
    .where(and(eq(dinners.recurringRuleId, ruleId), eq(dinners.overridden, false), gte(dinners.date, today)))
    .returning({ date: dinners.date });
  const dates = removed.map((r) => r.date).sort();
  await fillNights(tx, await activeRules(tx), dates);
  return dates;
}

// ---------------------------------------------------------------------------
// Mutations

/** Serializes rule changes so the overlap check can't race. */
async function lockRules(tx: Tx) {
  await tx.execute(sql`select pg_advisory_xact_lock(4242002)`);
}

/** Two active rules can't claim the same night. */
async function assertNoOverlap(
  tx: Tx,
  r: { weekday: number; startDate: string; endDate: string | null },
  exceptId?: string,
) {
  const forever = "9999-12-31";
  const [clash] = await tx
    .select({ id: recurringRules.id })
    .from(recurringRules)
    .where(
      and(
        eq(recurringRules.active, true),
        eq(recurringRules.weekday, r.weekday),
        lte(recurringRules.startDate, r.endDate ?? forever),
        gte(sql`coalesce(${recurringRules.endDate}, ${forever}::date)`, r.startDate),
        exceptId ? ne(recurringRules.id, exceptId) : undefined,
      ),
    );
  if (clash) throw new ServiceError("Another recurring meal already covers that weekday for those dates.", "conflict");
}

/**
 * Turns typed names into template dishes. A name that matches a recipe
 * already in the template keeps that recipe (even if it's since been
 * archived); otherwise an exact title match in the library links the recipe
 * (favorites, then newest, win ties); anything else is free text.
 */
async function resolveDishes(
  tx: Tx,
  input: { role: "main" | "side"; name: string }[],
  current: TemplateDish[] = [],
): Promise<TemplateDish[]> {
  const currentIds = current.flatMap((d) => ("recipeId" in d ? [d.recipeId] : []));
  const known = currentIds.length
    ? await tx.select({ id: recipes.id, title: recipes.title }).from(recipes).where(inArray(recipes.id, currentIds))
    : [];
  const out: TemplateDish[] = [];
  for (const d of input) {
    const key = d.name.toLowerCase();
    let recipeId = known.find((k) => k.title.toLowerCase() === key)?.id;
    if (!recipeId) {
      const [match] = await tx
        .select({ id: recipes.id })
        .from(recipes)
        .where(and(isNull(recipes.archivedAt), eq(sql`lower(${recipes.title})`, key)))
        .orderBy(desc(recipes.isFavorite), desc(recipes.createdAt))
        .limit(1);
      recipeId = match?.id;
    }
    out.push(recipeId ? { recipeId, role: d.role } : { freeTextName: d.name, role: d.role });
  }
  return out;
}

async function getRule(tx: Tx, id: string): Promise<Rule> {
  if (!z.uuid().safeParse(id).success) throw new ServiceError("That recurring meal no longer exists.", "not_found");
  const [rule] = await tx.select().from(recurringRules).where(eq(recurringRules.id, id)).for("update");
  if (!rule) throw new ServiceError("That recurring meal no longer exists.", "not_found");
  return rule;
}

export async function createRule(db: Db, actor: SessionUser, input: RuleInput): Promise<string> {
  assertAdult(actor);
  const rule = ruleInputSchema.parse(input);
  const id = await db.transaction(async (tx) => {
    await lockRules(tx);
    await assertNoOverlap(tx, rule);
    const [row] = await tx
      .insert(recurringRules)
      .values({
        weekday: rule.weekday,
        startDate: rule.startDate,
        endDate: rule.endDate,
        template: await resolveDishes(tx, rule.dishes),
      })
      .returning({ id: recurringRules.id });
    return row.id;
  });
  // New instances appear as views read the nights it covers.
  publish({ type: "rules.updated" });
  return id;
}

/** Changes a rule. Only its future, non-overridden instances follow. */
export async function updateRule(db: Db, actor: SessionUser, id: string, input: RuleInput, now = new Date()) {
  assertAdult(actor);
  const next = ruleInputSchema.parse(input);
  const cal = await plannerCalendar(db, now);
  const touched = await db.transaction(async (tx) => {
    await lockRules(tx);
    const rule = await getRule(tx, id);
    if (rule.active) await assertNoOverlap(tx, next, id);
    await tx
      .update(recurringRules)
      .set({
        weekday: next.weekday,
        startDate: next.startDate,
        endDate: next.endDate,
        template: await resolveDishes(tx, next.dishes, templateSchema.parse(rule.template)),
      })
      .where(eq(recurringRules.id, id));
    return refreshInstances(tx, id, cal.today);
  });
  publish({ type: "rules.updated" });
  publishDinnerDates(touched, cal.weekStartDay);
}

/** Deactivating removes future, non-overridden instances; reactivating lets them fill again. */
export async function setRuleActive(db: Db, actor: SessionUser, id: string, active: boolean, now = new Date()) {
  assertAdult(actor);
  const cal = await plannerCalendar(db, now);
  const touched = await db.transaction(async (tx) => {
    await lockRules(tx);
    const rule = await getRule(tx, id);
    if (rule.active === active) return [];
    if (active) await assertNoOverlap(tx, rule, id);
    await tx.update(recurringRules).set({ active }).where(eq(recurringRules.id, id));
    return active ? [] : refreshInstances(tx, id, cal.today);
  });
  publish({ type: "rules.updated" });
  publishDinnerDates(touched, cal.weekStartDay);
}

/**
 * "Repeat every <weekday>": makes a rule from a planned night's dishes,
 * starting that night. A night from today on becomes the rule's first
 * instance, unless its cook or servings were set by hand (rule changes
 * would otherwise undo them).
 */
export async function createRuleFromDinner(db: Db, actor: SessionUser, date: string, now = new Date()) {
  assertAdult(actor);
  if (!isIsoDate(date)) throw new ServiceError("Invalid date.");
  const cal = await plannerCalendar(db, now);
  const dinner = await getDinner(db, date);
  if (dinner.status !== "planned" || !dinner.dishes.length) throw new ServiceError("Add a dish before repeating a night.");
  if (dinner.recurring && !dinner.recurring.overridden) throw new ServiceError("This night already repeats.");
  if (dinner.dishes.length > MAX_RULE_DISHES) {
    throw new ServiceError(`A recurring meal can have at most ${MAX_RULE_DISHES} dishes.`);
  }
  const template: TemplateDish[] = dinner.dishes.map((d) =>
    d.recipe ? { recipeId: d.recipe.id, role: d.role } : { freeTextName: d.name, role: d.role },
  );
  const weekday = weekdayOf(date);
  const id = await db.transaction(async (tx) => {
    await lockRules(tx);
    await assertNoOverlap(tx, { weekday, startDate: date, endDate: null });
    const [rule] = await tx
      .insert(recurringRules)
      .values({ weekday, startDate: date, template })
      .returning({ id: recurringRules.id });
    if (date >= cal.today) {
      await tx
        .update(dinners)
        .set({
          recurringRuleId: rule.id,
          overridden: sql`${dinners.cookManuallySet} or ${dinners.servingsOverride} is not null`,
        })
        .where(eq(dinners.date, date));
    }
    return rule.id;
  });
  publish({ type: "rules.updated" });
  publishDinnerDates([date], cal.weekStartDay);
  return id;
}
