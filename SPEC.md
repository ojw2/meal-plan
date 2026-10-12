# Household Meal Planner: Specification

**Status:** Draft v1 · **Date:** 2026-10-12 · **Owner:** Omar

## 1. Overview

A self-hosted, web-first app, frameworks to embed your web app as a mobile app, that one household uses to plan **dinners** for the week and assign **who cooks** each dish. Meals come from one of two places:

1. **Suggest:** the user enters a protein, a cooking-time budget and optional side ingredients. The app queries Spoonacular and offers 3 main-dish options, then about 3 side-dish options for each side ingredient.
2. **Manual:** the user types what they plan to cook. Only the name is required.

From the week's plan the app derives a live, aggregated, editable **grocery list**.

### Goals
- Planning a week takes under 5 minutes, using defaults (cook schedule, recurring meals, copy last week, history).
- Everyone in the household can see tonight's dinner and who is cooking at a glance.
- The grocery list stays accurate as the plan changes, and two adults can use it at the same time.

### Non-goals (v1)
- Breakfast and lunch, or configurable meal slots
- Notifications or reminders of any kind
- Offline support (the app requires a connection)
- Dietary restrictions or allergy filtering
- Ratings, reviews or post-meal feedback
- Tracking who is attending each meal
- Pantry inventory or "hide staples" logic
- Multiple households, public sign-up, native app-store builds
- Swap-request workflows (adults just edit directly)

## 2. Users and roles

Single household, single tenant.

| Role | Can do | Auth |
|---|---|---|
| **Adult** | Everything: plan meals, assign cooks, edit the grocery list, manage settings and members, export data. Every adult is also an admin. | Username + password |
| **Kid** | Read-only: home screen, week view, recipe details, grocery list. Cannot be assigned as a cook. | Username + 4–6 digit PIN |

- The first account created at install time is an adult. After that, only adults can create, edit or remove members.
- **Removing a member** is a soft delete. Historical dinners keep showing their name. Their assignments on future dinners become *Unassigned* and are flagged in the UI, and their slots in the default cook schedule are cleared.
- At least one active adult must always exist. The UI blocks removing or demoting the last adult.

## 3. Core concepts and data model

All dinners are keyed by **local calendar date** in the household time zone, not by timestamp.

```
Household (singleton)
  name, timezone (IANA), weekStartDay (0–6), defaultServings (int)

User
  id, displayName, username, role: adult|kid,
  passwordHash (adults) | pinHash (kids), archivedAt?

CookSchedule
  weekday (0–6) -> userId?             -- default cook per weekday

Recipe                                  -- the household library
  id, source: spoonacular|manual, spoonacularId?, title,
  dishType: main|side, readyInMinutes?, servings?,
  imageUrl?, sourceUrl?, notes?, isFavorite, archivedAt?,
  createdAt

RecipeIngredient
  recipeId, rawText, name, spoonacularIngredientId?,
  amount?, unit?, aisle?, position

Dinner
  id, date (unique), status: planned|eat_out|leftovers|unplanned,
  servingsOverride?, recurringRuleId?, overridden (bool), notes?

Dish
  id, dinnerId, recipeId? , freeTextName?, role: main|side,
  cookUserId?, cookManuallySet (bool), position
  -- exactly one of recipeId / freeTextName

RecurringRule
  id, weekday, template (dishes: recipeId|freeTextName, role),
  startDate, endDate?, active

GroceryCheck
  weekStartDate, itemKey, checked, checkedAmountSnapshot, checkedBy, checkedAt

ManualGroceryItem
  id, weekStartDate, text, checked, createdBy

SearchCache
  queryHash, response (json), fetchedAt   -- TTL 1 hour

ApiUsage
  date, pointsUsed, pointsLeft (from response headers)
```

### Dinner status rules
- `unplanned`: no dishes yet. Shown as an empty slot.
- `planned`: one or more dishes, each with an optional cook.
- `eat_out` / `leftovers`: no dishes and **no cook**. The night counts toward no one's load, and the default cook is cleared for that night.

### Dishes and cooks
- One dinner can have multiple dishes (typically one main plus sides). **cooks are per day only 1 cook per day**
- When a dish is created, its cook defaults to `CookSchedule[weekday]`. Any adult can change it, which sets `cookManuallySet = true`.
- If the cook schedule changes, future dishes with `cookManuallySet = false` are updated. Past dinners and manually set cooks are left alone.
- The home card shows the distinct set of cooks across a dinner's dishes.

## 4. Feature specs

### 4.1 Home ("Tonight-first")
- A hero card for **tonight**: dish names, images, the cook(s), ready time, and a link to each recipe's source.
  - If tonight is `eat_out` or `leftovers`, the card says so. If it's `unplanned`, adults see a "Plan tonight" call to action.
- Below the hero card are the remaining days of the current week as compact day cards.
- A banner appears if the **current or next week** has unplanned nights or unassigned dishes ("Next week: 3 nights unplanned, 1 dish without a cook").
- "Tonight" is computed in the household time zone.

### 4.2 Week view
- Mobile: a vertical list of 7 day cards, starting on the household's `weekStartDay`. Desktop (≥1024px): a 7-column grid.
- Previous/next week navigation, plus a "Today" jump.
- Tapping a day opens the **day editor**: add a dish (Suggest, Manual, or From library), reorder or remove dishes, set each dish's cook, set the servings override, or mark the night Eat out / Leftovers.
- Week actions (adults only): **Copy last week**, **Grocery list**.

### 4.3 Suggest flow (Spoonacular)
**Inputs:** protein (free text with autocomplete from common proteins), max cook time (minutes; presets 15/30/45/60 plus custom), and side ingredients (0–3 chips, free text).

**Step 1: pick a main.**
- Call `GET /recipes/complexSearch` with `includeIngredients=<protein>`, `type=main course`, `maxReadyTime=<time>`, `addRecipeInformation=true`, `fillIngredients=true`, `number=3`, `sort=popularity`.
- Each card shows the image, title, ready time, the time-budget badge, and a source link.
- **Show 3 more** fetches the next page (`offset += 3`) and excludes recipe IDs already shown in this session.
- Household library recipes with `dishType=main` that match the protein and time are shown first under the label "From your recipes". They cost no API points.

**Step 2: pick sides (one row per side ingredient).**
- For each side ingredient, call `complexSearch` with `includeIngredients=<ingredient>`, `type=side dish`, `maxReadyTime=<time>`, `number=3`.
- Each row has its own **Show 3 more** button and a **Skip** option.

**Constraint relaxation.** If a search returns fewer than 3 results, the app retries with progressively relaxed constraints and labels every relaxed result with the reason:
1. Strict.
2. `maxReadyTime × 1.5`, then `× 2`. Badge: "35 min (over your 20 min)".
3. Move the ingredient from `includeIngredients` to a `query` text match. Badge: "Similar to ‘tofu’".
4. If results are still empty, show "No matches for X. Try a different protein/ingredient or add it manually."

Relaxation steps stop as soon as 3 results are collected. The time budget applies **per dish**, on the assumption that dishes are cooked in parallel.

**Commit.** Selecting the main and sides saves each chosen recipe to the household library (deduplicated by `spoonacularId`), then creates `Dish` rows on that dinner with the default cook.

### 4.4 Manual entry
- Required: dish name and role (main or side).
- Optional: ingredients (one per line), source URL, ready time, notes, "Save to library" (on by default).
- On save, ingredient lines go through Spoonacular `POST /recipes/parseIngredients` to get a name, amount, unit, aisle and ingredient ID, so they can feed the grocery list. If parsing fails or the quota is exhausted, the raw lines are stored and appear unmerged under "Other".
- A dish saved without ingredients does not contribute to the grocery list.

### 4.5 Library, favorites and history
- The library lists all non-archived recipes. Search by title. Filter by main/side and favorites.
- Each recipe shows "Last made N days ago" (computed from past dinners) and a times-made count.
- Adults can star a recipe as a favorite.
- **Archive, never delete.** Archived recipes disappear from pickers and search but still resolve on past dinners.
- The "From library" picker in the day editor sorts favorites first, then least recently made, to discourage repeats.

### 4.6 Recurring meals
- A rule is a weekday plus a template of dishes (for example, every Tuesday: "Tacos" main + "Mexican rice" side), with a start date and an optional end date.
- When a week is first opened or generated, dinners for matching weekdays get dishes from the template, plus default cooks. They are linked via `recurringRuleId` with `overridden = false`.
- Editing that dinner in any way sets `overridden = true`.
- **Rule changes apply only to future, non-overridden instances.** Past dinners and overridden instances are never changed.
- Deactivating a rule removes its future non-overridden instances. Overridden instances stay.
- Precedence when filling an empty night: recurring rule first, then Copy last week (which only fills nights still empty).

### 4.7 Copy last week
- Copies dishes and the night status (eat out, leftovers) from the previous week into the **empty, non-past** nights of the target week. It never overwrites existing dinners.
- Cooks are reset to the current default schedule rather than copied, since the schedule may have changed.
- A toast reports the result: "Filled 5 nights; skipped 2 already planned."

### 4.8 Grocery list
**Scope:** one list per planning week (`weekStartDate`). It covers all `planned` dinners in that week, including days that have already passed.

**Live derivation.** The list is computed on read from the week's dishes, so it is never stored as a snapshot. The only persisted state is check-offs (`GroceryCheck`) and manual items (`ManualGroceryItem`).

**Scaling.** Each dish's ingredients are scaled by `(dinner.servingsOverride ?? household.defaultServings) / recipe.servings`. If a recipe has no servings value, no scaling is applied.

**Aggregation.**
1. Group by `spoonacularIngredientId`. Unparsed lines fall back to their normalized lowercase name.
2. Within a group, bucket amounts by dimension: **mass**, **volume** or **count/other unit**.
3. Sum within each bucket after converting to a canonical unit (g, ml), then display in friendly units (e.g. 1.5 lb, 3 cups).
4. When buckets can't convert into each other, list them together: **"Onion: 2 whole + 1 cup chopped"**.
5. Each item expands to show its source dishes and per-dish amounts.
6. Group items by Spoonacular `aisle`, falling back to "Other".
7. Pantry staples (salt, oil, etc.) are **always included**, with no special handling.

**Check-offs.** These are keyed by `itemKey = ingredientId|name + bucket` and store a snapshot of the amount at the time of checking.
- If the needed amount later **increases** beyond the snapshot, the item reappears unchecked with a note: "+1 onion needed since you checked this".
- If an item drops out of the plan entirely: unchecked items vanish, and checked items move to a collapsed **"No longer needed (already bought)"** section.

**Manual items.** Free-text, per week, checkable, and deletable by adults.

**Permissions.** Only adults can check items or add them. Kids can view the list.

**Week-start changes.** If `weekStartDay` changes, check-offs and manual items for the current and future weeks are re-keyed to the new week boundaries where possible. Before saving, the settings screen warns: "Grocery check-offs for this week may reset."

### 4.9 Past weeks are read-only
- A week is **past** when its last day is before today in the household time zone. Past weeks render read-only.
- Within the current week, earlier days stay editable, for example to record that the family actually ate out.
- Any adult can **Unlock** a past week behind a confirmation dialog. The unlock lasts for that session only and is logged (who and when).

### 4.10 Settings (any adult)
- Household name, time zone, week start day, default servings
- Default cook schedule (weekday to adult, or none)
- Members: add, edit, reset password or PIN, archive
- Recurring rules
- Spoonacular quota meter: points used and left today, from the API response headers
- **Export all data as JSON** (download)

## 5. Real-time sync
- Every mutation publishes an event (`dinner.updated`, `grocery.checked`, etc.) carrying the affected week.
- Clients hold an **SSE** connection (`GET /api/events`) and refetch the affected week or list when an event arrives. The UI applies changes optimistically.
- The app runs as a single instance on a home server, so an in-process event emitter is sufficient. If it ever runs as more than one instance, switch to Postgres `LISTEN/NOTIFY`.
- Conflicts resolve as **last write wins** at the row level (dish, check). Checking a grocery item is idempotent.
- The client reconnects with backoff and does a full refetch after reconnecting.

## 6. Spoonacular integration
- The API key is set in the **`SPOONACULAR_API_KEY` env var** and used **server-side only** (Next.js route handlers proxy all calls). It is never sent to the browser.
- **Caching:** search responses are cached by normalized query hash for **1 hour** (`SearchCache`). The 3-more pagination reuses cached pages when possible.
- **Quota:** the server reads `X-API-Quota-Used` and `X-API-Quota-Left` from each response and records them in `ApiUsage`.
  - When fewer than about 20 points are left, a warning shows in the suggest flow.
  - When the quota is exhausted (HTTP 402), the suggest flow falls back to **library-only matches** with a banner. Manual entry still works, and ingredient parsing is deferred to a background retry the next day.
- **Library persistence:** chosen recipes are copied into the household library (title, ready time, servings, image URL, source URL, ingredients). Images are hotlinked rather than downloaded. Cooking instructions are **not** stored. The app links to `sourceUrl` instead.
- Errors and timeouts (8 s) show a retry button and never block manual entry.

## 7. Technical architecture

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router, TypeScript), `output: "standalone"` |
| DB | PostgreSQL 16 |
| ORM / migrations | Drizzle (drizzle-kit), migrations run on container start |
| Auth | Custom: argon2id hashes, httpOnly secure session cookie (90-day rolling), server-side session table |
| Real-time | SSE route handler and in-process emitter |
| PWA | Web app manifest and minimal service worker (installability only; **no offline caching**) |
| UI | Tailwind CSS + shadcn/ui. Mobile-first, accessible tap targets (≥44px), light and dark themes |
| Units | A small conversion table in the app for mass and volume. No density-based conversions. |
| Tests | Vitest unit tests for aggregation, scaling, relaxation and recurrence. Playwright for the main flows. |

### Deployment
- `docker-compose.yml` with three services: `app`, `db` (Postgres, volume-backed) and `backup` (nightly `pg_dump`, keeping the last 14 dumps on a mounted NAS path).
- **Remote access via Tailscale.** The server is reachable only on the tailnet. HTTPS uses Tailscale MagicDNS certificates (`tailscale serve` or `tailscale cert` with a reverse proxy), which PWA install and secure cookies require. Each household phone runs the Tailscale app. No ports are exposed to the internet.
- Env vars: `DATABASE_URL`, `SPOONACULAR_API_KEY`, `SESSION_SECRET`, `TZ` (the household time zone is still stored in the DB).

### Security
- Login rate limiting: 5 failed attempts per username per 15 minutes, then a temporary lockout. This matters most for short kid PINs.
- Authorization is enforced server-side for every mutation (adult role required). Kid sessions are read-only.
- Even though the app is tailnet-only, it still uses CSRF protection (SameSite=Lax cookies plus an origin check).

## 8. Edge cases (summary)

| Case | Behavior |
|---|---|
| Fewer than 3 API matches | Relaxation ladder with labeled badges (§4.3) |
| Quota exhausted | Library-only suggestions; manual entry still works; parsing deferred |
| Plan changes after shopping | Live list; increases resurface; removed bought items go to "No longer needed" |
| Mixed units that can't merge | Listed side by side, never guessed |
| Recipe missing servings | No scaling |
| Manual dish without ingredients | Contributes nothing to the list |
| Member removed | History keeps their name; future dishes become Unassigned and flagged; schedule slots cleared |
| Last adult removal | Blocked |
| Recipe archived | Hidden from pickers; past dinners still resolve |
| Recurring rule edited | Only future, non-overridden instances change |
| Schedule edited | Only future dishes whose cook wasn't set manually change |
| Eat out / leftovers night | No dishes, no cook |
| Week start day changed | Weeks re-window; grocery check-offs may reset (warned) |
| Past week edit | Read-only; adults can unlock with a confirmation (logged) |
| Two adults edit the same dish | Last write wins; SSE refreshes the other client |
| DST or time zone | Dates stored as local `DATE`; "today" computed in the household time zone |
| Same recipe chosen twice | Library deduplicates by `spoonacularId` |

## 9. Decisions made on your behalf (please confirm)
1. **Time budget is for meal**, the total time it takes to have dinner ready.
2. **Copy last week resets cooks** to the current default schedule instead of copying them.
3. **Spoonacular API key lives in an env var**, not in the settings UI, so the secret never touches the DB or the browser.
4. **Cook-schedule changes propagate** to future dishes whose cook wasn't set manually, using the same semantics as recurrence.
5. **Kids cannot check off grocery items** (they are strictly view-only).
6. **Library matches appear first** in the suggest flow, to save quota.
7. **Cooking instructions are not stored**. The app links to the source.

## 10. Risks and open questions
- **Spoonacular ToS:** the free tier limits caching (around 1 hour). Persisting chosen recipes to the library may exceed what's allowed, even for private non-commercial use. **Action:** read the current terms before building §4.5. A fallback is to store only `spoonacularId`, title and the user's own copy of the ingredients.
- **Free-tier quota (~150 points/day):** a full suggest flow with 2 sides and a couple of rerolls costs several points. Heavy planning days could exhaust the quota. Watch `ApiUsage` for the first few weeks, then decide whether the paid tier is worth it.
- **iOS PWA quirks:** no notifications are planned, so the main risks are session cookie persistence and Tailscale VPN reconnect latency when the app is opened.
- **Unit conversion quality:** Spoonacular ingredient IDs make grouping reliable, but amounts like "1 can" or "1 bunch" won't merge. This is acceptable by design.

## 11. Milestones
1. **Foundation:** Docker Compose, DB schema, auth (password and PIN), roles, settings, members.
2. **Planning core:** week view, day editor, manual dishes, cook schedule, eat out/leftovers, home screen, past-week lock.
3. **Suggest flow:** Spoonacular proxy, cache, quota tracking, mains and sides, relaxation, library save.
4. **Library and reuse:** favorites, history and last-made, archive, copy last week, recurring rules.
5. **Grocery list:** parsing, scaling, aggregation, aisles, check-offs with snapshots, manual items.
6. **Real-time and polish:** SSE sync, PWA manifest, JSON export, backup container, Playwright end-to-end tests.

## 12. Acceptance criteria (v1)
- An adult can plan a full week (mix of suggested, manual, recurring and eat-out nights) on a phone in under 5 minutes, with cooks auto-filled.
- A kid logged in with a PIN sees tonight's dinner and cook, and cannot change anything.
- With two phones on the grocery list, a check on one appears on the other within 2 s.
- Swapping a dinner after shopping correctly resurfaces newly needed items and moves bought, no-longer-needed items to their own section.
- When the quota is exhausted, the suggest flow degrades to library matches without errors.
- A JSON export contains household settings, users (no hashes), recipes, dinners, dishes, rules and grocery state.
