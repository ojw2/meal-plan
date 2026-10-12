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

The app listens only on `127.0.0.1:3000` (`APP_BIND` / `APP_PORT`), so it's reachable only through Tailscale. Migrations run automatically when the app starts.

### Backups

The `backup` service writes a `pg_dump` every night at 03:00 (in the `TZ` timezone) to `BACKUP_DIR` (default `./backups`) and keeps the latest 14. The dump files are owned by root.

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
