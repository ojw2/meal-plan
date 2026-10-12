# CLAUDE.md

Self-hosted household dinner planner (PWA). **[SPEC.md](SPEC.md) is the source of truth** for features, data model, and edge-case behavior. Read the relevant section before working on a feature.

@AGENTS.md

## Stack
- Next.js (App Router, TypeScript strict), `output: "standalone"`
- PostgreSQL 16 + Drizzle ORM / drizzle-kit migrations
- Tailwind CSS + shadcn/ui
- Vitest (unit), Playwright (e2e)
- pnpm (do not use npm/yarn; commit `pnpm-lock.yaml`)
- Docker Compose: `app`, `db`, `backup`; reached via Tailscale only

Dependencies: free to add whatever fits; prefer well-maintained, widely used packages.

## Commands
Node comes from fnm (`~/.local/share/fnm`); pnpm via corepack. Copy `.env.example` to `.env` first.
- `pnpm db:up`: start the dev Postgres container (localhost:54329)
- `pnpm dev`: dev server (runs pending migrations on start via `src/instrumentation.ts`)
- `pnpm typecheck`: `next typegen && tsc --noEmit` (typegen provides `LayoutProps`/`PageProps`)
- `pnpm lint`: ESLint
- `pnpm test`: Vitest. Recreates and migrates a `<db>_test` database each run.
- `pnpm test:e2e`: Playwright. Builds standalone and serves it on :3100 against a fresh `<db>_e2e` database. `E2E_SKIP_BUILD=1` reuses the last build; `E2E_BASE_URL=…` targets an already-running deployment (must be un-set-up).
- `pnpm db:generate`: generate a migration after editing `src/db/schema.ts` (commit the SQL in `drizzle/`)
- `docker compose up -d --build`: full stack (`app`, `db`, `backup`)
- Verify Docker without touching dev data: `APP_PORT=3200 docker compose -p mealplan-verify up -d --build app db`, then `E2E_BASE_URL=http://127.0.0.1:3200 pnpm test:e2e`, then `docker compose -p mealplan-verify down -v`

## Code conventions
- **Cache Components is off** (`next.config.ts`). Pages render per request. A page that reads the DB but no cookies/headers must call `await connection()`, or the build will try to prerender it.
- **Services** (`src/lib/services/*`) take `(db, actor, …)` and call `assertAdult(actor)` first for every mutation. Server actions only parse the form, call `requireUser()`, and call a service. Test permissions at the service level.
- Services throw `ServiceError` for user-facing failures. Actions wrap service calls in `toFormState()`, which turns these into form errors.
- Forms use `ActionForm` (submits via a transition so failed submits keep input; pass `resetOnSuccess` for "add" forms). Use native `<select>` via `SelectField` (better on phones).
- Links that look like buttons: `<Link className={buttonVariants(...)}>`. Don't use Base UI `Button render={<Link/>}`, because it gives the link `role="button"`.
- Tap targets: default `Button`/`Input` are 44px on mobile (`h-11 md:h-9`). Keep it that way.

## Workflow
- Build in **milestone order (SPEC §11)**. Stop and check in with Omar at the end of each milestone. Don't start the next one unasked.
- Use the context7 mcp for the most accurate information before writing any code.
- **Git:** one feature branch per milestone/feature off `main` (e.g. `m2-planning-core`), small focused commits, open a PR to `main`. Never commit directly to `main`; Omar merges.
- **Spec ambiguity or deviation:** ask first, then update SPEC.md (including §9 "Decisions") so the spec stays accurate. Don't silently diverge.

## Definition of done
A change is not done until all of these pass; report actual results, including failures:
1. `pnpm typecheck` and `pnpm lint` are clean
2. Vitest covers the logic. **Required** for grocery aggregation/unit conversion/scaling, constraint relaxation, recurrence and cook-schedule propagation, past-week locking, and auth/permissions.
3. Playwright covers each user-facing flow touched
4. Verified running under `docker compose up --build`, not just `pnpm dev`

## Spoonacular
- Free tier is about 150 points/day, so **mock by default**. Dev and tests use recorded fixtures. Hit the real API only when `SPOONACULAR_LIVE=1`.
- All calls go through server-side route handlers. The API key (`SPOONACULAR_API_KEY`) must never reach the client bundle.
- When recording new fixtures, strip the API key from saved URLs/headers.

## Domain rules that are easy to get wrong
- Dinners are keyed by **local `DATE` in the household timezone**, never timestamps. Compute "today" in the household TZ.
- Exactly one of `Dish.recipeId` / `Dish.freeTextName` is set.
- `eat_out` / `leftovers` nights have no dishes and no cook.
- Recurring-rule and cook-schedule changes only affect **future, non-overridden** rows (`overridden`, `cookManuallySet`).
- Recipes and users are **archived, never hard-deleted**. Past dinners must still resolve.
- The grocery list is **derived on read**. Only check-offs (with amount snapshot) and manual items are stored.
- Never merge incompatible units by guessing. List them side by side.
- Every mutation enforces the adult role **server-side**. Kids are read-only everywhere.
- Every mutation must emit an SSE event for the affected week.
