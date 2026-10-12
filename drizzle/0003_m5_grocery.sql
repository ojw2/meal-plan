ALTER TABLE "grocery_checks" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD COLUMN "parsed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "recipe_ingredients_pending_idx" ON "recipe_ingredients" USING btree ("recipe_id") WHERE "recipe_ingredients"."parsed_at" is null;