# CLAUDE.md

Self-hosted household dinner planner (PWA). **[SPEC.md](SPEC.md) is the source of truth** for features, data model, and edge-case behavior. Read the relevant section before working on a feature.

## Stack
- Next.js (App Router, TypeScript strict), `output: "standalone"`
- PostgreSQL 16 + Drizzle ORM / drizzle-kit migrations
- Tailwind CSS + shadcn/ui
- Vitest (unit), Playwright (e2e)
- pnpm (do not use npm/yarn; commit `pnpm-lock.yaml`)
- Docker Compose: `app`, `db`, `backup`; reached via Tailscale only

Dependencies: free to add whatever fits; prefer well-maintained, widely used packages.

## Commands
> Fill in / correct these once the project is scaffolded (Milestone 1).
- `pnpm dev`: dev server
- `pnpm typecheck`: `tsc --noEmit`
- `pnpm lint`: ESLint
- `pnpm test`: Vitest
- `pnpm test:e2e`: Playwright
- `pnpm db:generate` / `pnpm db:migrate`: Drizzle migrations
- `docker compose up --build`: full stack

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
