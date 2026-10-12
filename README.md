# Meal Plan

A self-hosted web app (installable PWA) for planning a household's weekly dinners and who cooks them. See [SPEC.md](SPEC.md) for the full design.

## Deploy (home server)

Requires Docker with Compose, and Tailscale on the server and on each household phone.

```sh
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD, and set SESSION_SECRET (openssl rand -base64 48).
# Update DATABASE_URL to use the same password.
docker compose up -d --build
tailscale serve --bg 3000        # HTTPS at https://<server>.<tailnet>.ts.net
```

Open the Tailscale URL. The first visit asks you to create the household and its first adult. Add everyone else under **Settings → Members**: adults sign in with a password, kids with a 4–6 digit PIN.

For real recipe suggestions, add a [Spoonacular](https://spoonacular.com/food-api) API key to `.env` as `SPOONACULAR_API_KEY` and set `SPOONACULAR_LIVE=1`. Without them, suggestions come from a small built-in sample set. The free tier allows about 150 points a day, and **Settings** shows today's usage.

The app listens only on `127.0.0.1:3000` (`APP_BIND` / `APP_PORT`), so it's reachable only through Tailscale. Migrations run automatically when the app starts.

### Install on phones

Open the Tailscale HTTPS URL on the phone, then install the app. Installing requires HTTPS, which `tailscale serve` provides.
- **Android (Chrome):** menu → **Install app** (or **Add to Home screen**).
- **iPhone (Safari):** Share → **Add to Home Screen**.

The installed app opens full screen. Changes made on one phone show up on the others within a couple of seconds. The app needs a connection and doesn't work offline.

### Export

**Settings → Your data → Export all data** downloads everything as JSON: settings, members (without passwords or PINs), recipes, dinners, recurring meals and grocery lists. Use it as a readable record. Restore from the backups below.

### Backups

The `backup` service writes a `pg_dump` every night at 03:00 (in the `TZ` timezone) to `BACKUP_DIR` (default `./backups`) and keeps the latest 14. Point `BACKUP_DIR` at a NAS mount to keep them off the server. The dump files are owned by root.

To take a backup right now, for example before an upgrade:

```sh
docker compose run --rm backup now
```

To restore:

```sh
docker compose exec -T db pg_restore -U mealplan -d mealplan --clean --if-exists < backups/mealplan-YYYYMMDD-HHMMSS.dump
```

## Develop

Requires Node 24 and pnpm (`corepack enable`).

```sh
pnpm install
cp .env.example .env    # then fill in secrets as above
pnpm db:up              # dev Postgres on localhost:54329
pnpm dev
```

Checks, which must all pass before a change is done (see [CLAUDE.md](CLAUDE.md)):

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e
```
