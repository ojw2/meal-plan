import Link from "next/link";
import { Clock, ExternalLink } from "lucide-react";
import { CookLabel, DayCard, NIGHT_OFF_LABEL } from "@/components/planner/day-card";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { getDinners, plannerCalendar, weekGaps, type DinnerView } from "@/lib/services/planner";
import { addDays, formatDate } from "@/lib/time";

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "3 nights unplanned, 1 night without a cook", or null when nothing is open. */
function gapSummary(gaps: { unplanned: number; withoutCook: number }) {
  const parts = [];
  if (gaps.unplanned) parts.push(`${plural(gaps.unplanned, "night")} unplanned`);
  if (gaps.withoutCook) parts.push(`${plural(gaps.withoutCook, "night")} without a cook`);
  return parts.length ? parts.join(", ") : null;
}

export default async function HomePage() {
  const user = await requireUser();
  const db = getDb();
  const cal = await plannerCalendar(db);
  const nextWeekStart = addDays(cal.currentWeekStart, 7);
  // Current and next week in one read: the hero, the rest of this week, and the banner.
  const days = await getDinners(db, cal.currentWeekStart, addDays(nextWeekStart, 6));
  const thisWeek = days.slice(0, 7);
  const tonight = thisWeek.find((d) => d.date === cal.today)!;
  const rest = thisWeek.filter((d) => d.date > cal.today);
  const banners = [
    { label: "This week", start: cal.currentWeekStart, summary: gapSummary(weekGaps(thisWeek, cal.today)) },
    { label: "Next week", start: nextWeekStart, summary: gapSummary(weekGaps(days.slice(7), cal.today)) },
  ].filter((b) => b.summary);

  return (
    <>
      <div>
        <p className="text-sm text-muted-foreground">
          {formatDate(cal.today, { weekday: "long", month: "long", day: "numeric" })}
        </p>
        <h1 className="text-2xl font-semibold">Hi, {user.displayName}</h1>
      </div>

      {user.role === "adult" &&
        banners.map((b) => (
          <Link
            key={b.label}
            href={`/week?d=${b.start}`}
            className="rounded-lg bg-muted px-3 py-2 text-sm hover:bg-muted/70"
          >
            <span className="font-medium">{b.label}:</span> {b.summary}
          </Link>
        ))}

      <Tonight dinner={tonight} canPlan={user.role === "adult"} />

      {rest.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Rest of the week</h2>
            <Link href="/week" className={buttonVariants({ variant: "ghost" })}>
              Week view
            </Link>
          </div>
          <ol className="grid gap-3 sm:grid-cols-2">
            {rest.map((d) => (
              <li key={d.date} className="flex flex-col *:flex-1">
                <DayCard dinner={d} today={cal.today} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

function Tonight({ dinner, canPlan }: { dinner: DinnerView; canPlan: boolean }) {
  return (
    <Card role="region" aria-labelledby="tonight-title">
      <CardHeader>
        <CardTitle id="tonight-title" className="text-lg">
          Tonight
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {dinner.status === "planned" ? (
          <>
            <ul className="flex flex-col gap-3">
              {dinner.dishes.map((d) => (
                <li key={d.id} className="flex items-center gap-3">
                  {d.recipe?.imageUrl && (
                    // Hotlinked recipe images (SPEC §6); next/image would need every host allow-listed.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.recipe.imageUrl} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
                  )}
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className={d.role === "main" ? "text-base font-medium" : ""}>{d.name}</span>
                    <span className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {d.recipe?.readyInMinutes && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" /> {d.recipe.readyInMinutes} min
                        </span>
                      )}
                      {d.recipe?.sourceUrl && (
                        <a
                          href={d.recipe.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                        >
                          Recipe <ExternalLink className="size-3" />
                        </a>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-sm">
              {dinner.cook ? (
                <>
                  <span className="font-medium">{dinner.cook.displayName}</span> is cooking
                </>
              ) : (
                <>
                  Cook: <CookLabel dinner={dinner} />
                </>
              )}
            </p>
          </>
        ) : dinner.status === "unplanned" ? (
          <p className="text-muted-foreground">Nothing planned yet.</p>
        ) : (
          <p className="text-base font-medium">{NIGHT_OFF_LABEL[dinner.status]} tonight</p>
        )}
        {canPlan && (
          <Link
            href={`/day/${dinner.date}`}
            className={buttonVariants({ variant: dinner.status === "unplanned" ? "default" : "outline", className: "self-start" })}
          >
            {dinner.status === "unplanned" ? "Plan tonight" : "Edit tonight"}
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
