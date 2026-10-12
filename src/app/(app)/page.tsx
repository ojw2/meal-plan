import Link from "next/link";
import { ChevronRight, Clock, ExternalLink } from "lucide-react";
import { LiveScope } from "@/components/live-sync";
import { CookLabel, DayCard, dishSummary, NIGHT_OFF_LABEL } from "@/components/planner/day-card";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { getDinners, plannerCalendar, weekGaps, type DinnerView } from "@/lib/services/planner";
import { materializeRecurring } from "@/lib/services/recurring";
import { addDays, formatDate } from "@/lib/time";
import { cn } from "@/lib/utils";

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
  // Recurring meals fill in first, so the banner doesn't count them as open.
  await materializeRecurring(db, cal.currentWeekStart, addDays(nextWeekStart, 6));
  const days = await getDinners(db, cal.currentWeekStart, addDays(nextWeekStart, 6));
  const thisWeek = days.slice(0, 7);
  const tonight = thisWeek.find((d) => d.date === cal.today)!;
  const rest = thisWeek.filter((d) => d.date > cal.today);
  const banners = [
    { label: "This week", start: cal.currentWeekStart, summary: gapSummary(weekGaps(thisWeek, cal.today)) },
    { label: "Next week", start: nextWeekStart, summary: gapSummary(weekGaps(days.slice(7), cal.today)) },
  ].filter((b) => b.summary);

  const canPlan = user.role === "adult";

  return (
    <>
      <LiveScope weeks={[cal.currentWeekStart, nextWeekStart]} />
      <div>
        <p className="text-sm text-muted-foreground">
          {formatDate(cal.today, { weekday: "long", month: "long", day: "numeric" })}
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">Hi, {user.displayName}</h1>
      </div>

      <DayStrip days={thisWeek} today={cal.today} />

      {canPlan && banners.length > 0 && (
        <div className="flex flex-col gap-2">
          {banners.map((b) => (
            <Link
              key={b.label}
              href={`/week?d=${b.start}`}
              className="flex min-h-11 items-center gap-2.5 rounded-2xl bg-attention-soft px-4 py-2.5 text-sm text-attention-foreground transition-opacity hover:opacity-85"
            >
              <span className="size-2 shrink-0 rounded-full bg-attention" aria-hidden />
              <span className="flex-1">
                <span className="font-bold">{b.label}:</span> {b.summary}
              </span>
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          ))}
        </div>
      )}

      <Tonight dinner={tonight} canPlan={canPlan} />

      {rest.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="coming-up">
          <div className="flex items-center justify-between">
            <h2 id="coming-up" className="text-xl font-bold">
              Coming up
            </h2>
            <Link href="/week" className={buttonVariants({ variant: "ghost" })}>
              Week view
            </Link>
          </div>
          <ol className="grid gap-2 sm:grid-cols-2">
            {rest.map((d) => (
              <li key={d.date} className="flex flex-col *:flex-1">
                <DayCard dinner={d} today={cal.today} canPlan={canPlan} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

/** This week at a glance: one tile per night, with a dot for its state. */
function DayStrip({ days, today }: { days: DinnerView[]; today: string }) {
  return (
    <nav aria-label="This week" className="-mt-2">
      <ol className="grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const isToday = d.date === today;
          const open = d.date >= today && (d.status === "unplanned" || (d.status === "planned" && !d.cook));
          return (
            <li key={d.date}>
              <Link
                href={`/day/${d.date}`}
                aria-label={formatDate(d.date, { weekday: "long", month: "long", day: "numeric" })}
                aria-current={isToday ? "date" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-0.5 rounded-2xl text-xs transition-colors",
                  isToday
                    ? "bg-primary text-primary-foreground/80"
                    : d.status === "unplanned" && open
                      ? "border-[1.5px] border-dashed border-attention text-muted-foreground"
                      : "bg-card text-muted-foreground ring-1 ring-foreground/5 hover:bg-card/70",
                  d.date < today && "opacity-60",
                )}
              >
                {formatDate(d.date, { weekday: "narrow" })}
                <strong className={cn("text-[1.05rem] leading-none font-bold", isToday ? "text-primary-foreground" : "text-foreground")}>
                  {formatDate(d.date, { day: "numeric" })}
                </strong>
                <StatusDot dinner={d} onPrimary={isToday} attention={open} />
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StatusDot({ dinner, onPrimary, attention }: { dinner: DinnerView; onPrimary: boolean; attention: boolean }) {
  const base = "mt-0.5 size-1.5 rounded-full";
  if (dinner.status === "unplanned") return <span className={base} aria-hidden />;
  if (dinner.status !== "planned")
    return <span className={cn(base, "border", onPrimary ? "border-primary-foreground" : "border-primary")} aria-hidden />;
  return (
    <span
      className={cn(base, onPrimary ? "bg-primary-foreground" : attention ? "bg-attention" : "bg-primary")}
      aria-hidden
    />
  );
}

function Tonight({ dinner, canPlan }: { dinner: DinnerView; canPlan: boolean }) {
  const { lead, rest } = dishSummary(dinner);
  const image = dinner.dishes.find((d) => d.recipe?.imageUrl)?.recipe?.imageUrl;
  const minutes = lead?.recipe?.readyInMinutes;
  return (
    <Card role="region" aria-labelledby="tonight-title" className="gap-0 p-2 py-2">
      {image && (
        // Hotlinked recipe images (SPEC §6); next/image would need every host allow-listed.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="h-52 w-full rounded-[1.4rem] object-cover sm:h-64" />
      )}
      <div className="flex flex-col gap-4 px-3 pt-4 pb-3">
        <div className="flex items-center justify-between gap-3">
          <h2
            id="tonight-title"
            className="rounded-full bg-accent px-3 py-1 text-[0.8rem] font-bold text-accent-foreground"
          >
            Tonight
          </h2>
          {minutes && (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="size-4" aria-hidden /> {minutes} min
            </span>
          )}
        </div>

        {dinner.status === "planned" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <p className="text-[1.65rem] leading-tight font-extrabold tracking-tight">{lead.name}</p>
              {rest.length > 0 && (
                <ul className="flex flex-col text-base text-muted-foreground">
                  {rest.map((d) => (
                    <li key={d.id}>
                      +{" "}
                      {d.recipe?.sourceUrl ? (
                        <a
                          href={d.recipe.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                        >
                          {d.name} <ExternalLink className="size-3.5" aria-hidden />
                        </a>
                      ) : (
                        d.name
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              {/* "No cook" when nobody's assigned. */}
              <CookLabel dinner={dinner}> is cooking</CookLabel>
            </div>
          </>
        ) : dinner.status === "unplanned" ? (
          <p className="text-lg text-muted-foreground">Nothing planned yet.</p>
        ) : (
          <p className="text-[1.65rem] leading-tight font-extrabold tracking-tight">
            {NIGHT_OFF_LABEL[dinner.status]} tonight
          </p>
        )}

        {(lead?.recipe?.sourceUrl || canPlan) && (
          <div className="grid grid-cols-2 gap-2">
            {lead?.recipe?.sourceUrl && (
              <a
                href={lead.recipe.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ className: "h-12 md:h-11" })}
              >
                Open recipe <ExternalLink aria-hidden />
              </a>
            )}
            {canPlan && (
              <Link
                href={`/day/${dinner.date}`}
                className={buttonVariants({
                  variant: dinner.status === "unplanned" ? "default" : "secondary",
                  className: cn("h-12 md:h-11", !lead?.recipe?.sourceUrl && "col-span-2 sm:col-span-1"),
                })}
              >
                {dinner.status === "unplanned" ? "Plan tonight" : "Edit tonight"}
              </Link>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
