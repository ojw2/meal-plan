CREATE TYPE "public"."dinner_status" AS ENUM('planned', 'eat_out', 'leftovers', 'unplanned');--> statement-breakpoint
CREATE TYPE "public"."dish_role" AS ENUM('main', 'side');--> statement-breakpoint
CREATE TYPE "public"."recipe_source" AS ENUM('spoonacular', 'manual');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('adult', 'kid');--> statement-breakpoint
CREATE TABLE "api_usage" (
	"date" date PRIMARY KEY NOT NULL,
	"points_used" real NOT NULL,
	"points_left" real
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cook_schedule" (
	"weekday" smallint PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "cook_schedule_weekday" CHECK ("cook_schedule"."weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "dinners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"status" "dinner_status" DEFAULT 'unplanned' NOT NULL,
	"servings_override" smallint,
	"recurring_rule_id" uuid,
	"overridden" boolean DEFAULT false NOT NULL,
	"notes" text,
	CONSTRAINT "dinners_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "dishes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dinner_id" uuid NOT NULL,
	"recipe_id" uuid,
	"free_text_name" text,
	"role" "dish_role" NOT NULL,
	"cook_user_id" uuid,
	"cook_manually_set" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "dishes_recipe_xor_free_text" CHECK (("dishes"."recipe_id" is null) <> ("dishes"."free_text_name" is null))
);
--> statement-breakpoint
CREATE TABLE "grocery_checks" (
	"week_start_date" date NOT NULL,
	"item_key" text NOT NULL,
	"checked" boolean NOT NULL,
	"checked_amount_snapshot" real,
	"checked_by" uuid,
	"checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "household" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"week_start_day" smallint DEFAULT 0 NOT NULL,
	"default_servings" smallint DEFAULT 4 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_singleton" CHECK ("household"."id" = 1),
	CONSTRAINT "household_week_start_day" CHECK ("household"."week_start_day" between 0 and 6),
	CONSTRAINT "household_default_servings" CHECK ("household"."default_servings" between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"success" boolean NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_grocery_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_start_date" date NOT NULL,
	"text" text NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"raw_text" text NOT NULL,
	"name" text,
	"spoonacular_ingredient_id" integer,
	"amount" real,
	"unit" text,
	"aisle" text,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "recipe_source" NOT NULL,
	"spoonacular_id" integer,
	"title" text NOT NULL,
	"dish_type" "dish_role" NOT NULL,
	"ready_in_minutes" integer,
	"servings" integer,
	"image_url" text,
	"source_url" text,
	"notes" text,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"weekday" smallint NOT NULL,
	"template" jsonb NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_rules_weekday" CHECK ("recurring_rules"."weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "search_cache" (
	"query_hash" text PRIMARY KEY NOT NULL,
	"response" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"username" text NOT NULL,
	"role" "role" NOT NULL,
	"password_hash" text,
	"pin_hash" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_credential_matches_role" CHECK (("users"."role" = 'adult' and "users"."password_hash" is not null and "users"."pin_hash" is null)
        or ("users"."role" = 'kid' and "users"."pin_hash" is not null and "users"."password_hash" is null))
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cook_schedule" ADD CONSTRAINT "cook_schedule_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dinners" ADD CONSTRAINT "dinners_recurring_rule_id_recurring_rules_id_fk" FOREIGN KEY ("recurring_rule_id") REFERENCES "public"."recurring_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dishes" ADD CONSTRAINT "dishes_dinner_id_dinners_id_fk" FOREIGN KEY ("dinner_id") REFERENCES "public"."dinners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dishes" ADD CONSTRAINT "dishes_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dishes" ADD CONSTRAINT "dishes_cook_user_id_users_id_fk" FOREIGN KEY ("cook_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_checks" ADD CONSTRAINT "grocery_checks_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_grocery_items" ADD CONSTRAINT "manual_grocery_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dishes_dinner_idx" ON "dishes" USING btree ("dinner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grocery_checks_week_item_idx" ON "grocery_checks" USING btree ("week_start_date","item_key");--> statement-breakpoint
CREATE INDEX "login_attempts_username_time_idx" ON "login_attempts" USING btree ("username","attempted_at");--> statement-breakpoint
CREATE INDEX "manual_grocery_items_week_idx" ON "manual_grocery_items" USING btree ("week_start_date");--> statement-breakpoint
CREATE INDEX "recipe_ingredients_recipe_idx" ON "recipe_ingredients" USING btree ("recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipes_spoonacular_id_idx" ON "recipes" USING btree ("spoonacular_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_idx" ON "users" USING btree (lower("username"));