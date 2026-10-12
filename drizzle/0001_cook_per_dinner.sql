CREATE TABLE "week_unlocks" (
	"session_token_hash" text NOT NULL,
	"week_start_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "week_unlocks_session_token_hash_week_start_date_pk" PRIMARY KEY("session_token_hash","week_start_date")
);
--> statement-breakpoint
ALTER TABLE "dishes" DROP CONSTRAINT "dishes_cook_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "dinners" ADD COLUMN "cook_user_id" uuid;--> statement-breakpoint
ALTER TABLE "dinners" ADD COLUMN "cook_manually_set" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "week_unlocks" ADD CONSTRAINT "week_unlocks_session_token_hash_sessions_token_hash_fk" FOREIGN KEY ("session_token_hash") REFERENCES "public"."sessions"("token_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dinners" ADD CONSTRAINT "dinners_cook_user_id_users_id_fk" FOREIGN KEY ("cook_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Carry any existing per-dish cook over to its night (first dish wins; planned nights only).
UPDATE "dinners" SET "cook_user_id" = d."cook_user_id", "cook_manually_set" = d."cook_manually_set"
FROM (
	SELECT DISTINCT ON ("dinner_id") "dinner_id", "cook_user_id", "cook_manually_set"
	FROM "dishes" ORDER BY "dinner_id", "position"
) d
WHERE d."dinner_id" = "dinners"."id" AND "dinners"."status" = 'planned';--> statement-breakpoint
ALTER TABLE "dishes" DROP COLUMN "cook_user_id";--> statement-breakpoint
ALTER TABLE "dishes" DROP COLUMN "cook_manually_set";--> statement-breakpoint
ALTER TABLE "dinners" ADD CONSTRAINT "dinners_cook_only_when_planned" CHECK ("dinners"."status" = 'planned' or "dinners"."cook_user_id" is null);--> statement-breakpoint
ALTER TABLE "dinners" ADD CONSTRAINT "dinners_servings_override" CHECK ("dinners"."servings_override" between 1 and 50);