// Runs once per server start, before requests are served (SPEC §7:
// "migrations run on container start").
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.RUN_MIGRATIONS !== "false") {
    const { runMigrations } = await import("./db/migrate");
    await runMigrations();
  }
  const { startBackgroundJobs } = await import("./lib/jobs");
  startBackgroundJobs();
}
