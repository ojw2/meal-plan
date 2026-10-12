import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Full data model from SPEC §3. Tables beyond auth/settings/members are
// created now so later milestones only add columns, not reshape the core.

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum("role", ["adult", "kid"]);
export const recipeSourceEnum = pgEnum("recipe_source", ["spoonacular", "manual"]);
export const dishRoleEnum = pgEnum("dish_role", ["main", "side"]);
export const dinnerStatusEnum = pgEnum("dinner_status", [
  "planned",
  "eat_out",
  "leftovers",
  "unplanned",
]);

/** Singleton row (id is always 1). */
export const household = pgTable(
  "household",
  {
    id: smallint("id").primaryKey().default(1),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    weekStartDay: smallint("week_start_day").notNull().default(0),
    defaultServings: smallint("default_servings").notNull().default(4),
    createdAt: createdAt(),
  },
  (t) => [
    check("household_singleton", sql`${t.id} = 1`),
    check("household_week_start_day", sql`${t.weekStartDay} between 0 and 6`),
    check("household_default_servings", sql`${t.defaultServings} between 1 and 50`),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayName: text("display_name").notNull(),
    username: text("username").notNull(),
    role: roleEnum("role").notNull(),
    // Adults authenticate with a password, kids with a PIN. Only one is set.
    passwordHash: text("password_hash"),
    pinHash: text("pin_hash"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("users_username_lower_idx").on(sql`lower(${t.username})`),
    check(
      "users_credential_matches_role",
      sql`(${t.role} = 'adult' and ${t.passwordHash} is not null and ${t.pinHash} is null)
        or (${t.role} = 'kid' and ${t.pinHash} is not null and ${t.passwordHash} is null)`,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    // HMAC of the cookie token; the raw token never touches the DB.
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(), // lower-cased
    success: boolean("success").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_username_time_idx").on(t.username, t.attemptedAt)],
);

/** Default cook per weekday (0 = Sunday). Missing row = no default. */
export const cookSchedule = pgTable(
  "cook_schedule",
  {
    weekday: smallint("weekday").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => [check("cook_schedule_weekday", sql`${t.weekday} between 0 and 6`)],
);

export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: recipeSourceEnum("source").notNull(),
    spoonacularId: integer("spoonacular_id"),
    title: text("title").notNull(),
    dishType: dishRoleEnum("dish_type").notNull(),
    readyInMinutes: integer("ready_in_minutes"),
    servings: integer("servings"),
    imageUrl: text("image_url"),
    sourceUrl: text("source_url"),
    notes: text("notes"),
    isFavorite: boolean("is_favorite").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("recipes_spoonacular_id_idx").on(t.spoonacularId)],
);

export const recipeIngredients = pgTable(
  "recipe_ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    rawText: text("raw_text").notNull(),
    name: text("name"),
    spoonacularIngredientId: integer("spoonacular_ingredient_id"),
    amount: real("amount"),
    unit: text("unit"),
    aisle: text("aisle"),
    position: integer("position").notNull(),
  },
  (t) => [index("recipe_ingredients_recipe_idx").on(t.recipeId)],
);

export const recurringRules = pgTable(
  "recurring_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    weekday: smallint("weekday").notNull(),
    // [{ recipeId?: string, freeTextName?: string, role: "main" | "side" }]
    template: jsonb("template").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [check("recurring_rules_weekday", sql`${t.weekday} between 0 and 6`)],
);

export const dinners = pgTable(
  "dinners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Local calendar date in the household timezone — never a timestamp.
    date: date("date", { mode: "string" }).notNull().unique(),
    status: dinnerStatusEnum("status").notNull().default("unplanned"),
    // One cook per night (SPEC §3). Defaults from cook_schedule.
    cookUserId: uuid("cook_user_id").references(() => users.id),
    cookManuallySet: boolean("cook_manually_set").notNull().default(false),
    servingsOverride: smallint("servings_override"),
    recurringRuleId: uuid("recurring_rule_id").references(() => recurringRules.id),
    overridden: boolean("overridden").notNull().default(false),
    notes: text("notes"),
  },
  (t) => [
    // Only a planned night can have a cook; eat out / leftovers count toward no one.
    check("dinners_cook_only_when_planned", sql`${t.status} = 'planned' or ${t.cookUserId} is null`),
    check("dinners_servings_override", sql`${t.servingsOverride} between 1 and 50`),
  ],
);

export const dishes = pgTable(
  "dishes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dinnerId: uuid("dinner_id")
      .notNull()
      .references(() => dinners.id, { onDelete: "cascade" }),
    recipeId: uuid("recipe_id").references(() => recipes.id),
    freeTextName: text("free_text_name"),
    role: dishRoleEnum("role").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    index("dishes_dinner_idx").on(t.dinnerId),
    // Library history: last made / times made per recipe.
    index("dishes_recipe_idx").on(t.recipeId),
    check(
      "dishes_recipe_xor_free_text",
      sql`(${t.recipeId} is null) <> (${t.freeTextName} is null)`,
    ),
  ],
);

export const groceryChecks = pgTable(
  "grocery_checks",
  {
    weekStartDate: date("week_start_date", { mode: "string" }).notNull(),
    itemKey: text("item_key").notNull(),
    checked: boolean("checked").notNull(),
    checkedAmountSnapshot: real("checked_amount_snapshot"),
    checkedBy: uuid("checked_by").references(() => users.id),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("grocery_checks_week_item_idx").on(t.weekStartDate, t.itemKey)],
);

export const manualGroceryItems = pgTable(
  "manual_grocery_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    weekStartDate: date("week_start_date", { mode: "string" }).notNull(),
    text: text("text").notNull(),
    checked: boolean("checked").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("manual_grocery_items_week_idx").on(t.weekStartDate)],
);

export const searchCache = pgTable("search_cache", {
  queryHash: text("query_hash").primaryKey(),
  response: jsonb("response").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiUsage = pgTable("api_usage", {
  date: date("date", { mode: "string" }).primaryKey(),
  pointsUsed: real("points_used").notNull(),
  pointsLeft: real("points_left"),
});

/** Past weeks a session has unlocked for editing (SPEC §4.9). Dies with the session. */
export const weekUnlocks = pgTable(
  "week_unlocks",
  {
    sessionTokenHash: text("session_token_hash")
      .notNull()
      .references(() => sessions.tokenHash, { onDelete: "cascade" }),
    weekStartDate: date("week_start_date", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.sessionTokenHash, t.weekStartDate] })],
);

/** Who did what, for actions the spec says must be logged (e.g. past-week unlock). */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(),
  details: jsonb("details"),
  createdAt: createdAt(),
});

export type User = typeof users.$inferSelect;
export type Household = typeof household.$inferSelect;
export type DinnerStatus = (typeof dinnerStatusEnum.enumValues)[number];
