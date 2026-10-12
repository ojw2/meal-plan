import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayCard } from "@/components/planner/day-card";
import { PastWeekBanner } from "@/components/planner/past-week-banner";
import { buttonVariants } from "@/components/ui/button";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { getWeek, plannerCalendar, weekAccess } from "@/lib/services/planner";
import { addDays, formatDate, isIsoDate, weekStartOf } from "@/lib/time";

export const metadata: Metadata = { title: "Week" };

/** "Oct 11 – 17", or "Oct 25 – Nov 1" across months. */
function weekLabel(start: string) {
  const end = addDays(start, 6);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${formatDate(start, { month: "short", day: "numeric" })} – ${formatDate(
    end,
    sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" },
  )}`;
}

export default async function WeekPage({ searchParams }: PageProps<"/week">) {
  const user = await requireUser();
  const db = getDb();
  const cal = await plannerCalendar(db);
  const { d } = await searchParams;
  // Any date in the week works; it's normalized to the week's first day.
  const weekStart =
    typeof d === "string" && isIsoDate(d) ? weekStartOf(d, cal.weekStartDay) : cal.currentWeekStart;
  const [week, access] = await Promise.all([getWeek(db, weekStart), weekAccess(db, user, weekStart, cal.today)]);
  const isCurrent = weekStart === cal.currentWeekStart;

  return (
    // data-wide lets the layout widen for the 7-column desktop grid.
    <div data-wide className="flex flex-col gap-4">
      <div className="flex items-center gap-1">
        <Link
          href={`/week?d=${addDays(weekStart, -7)}`}
          aria-label="Previous week"
          className={buttonVariants({ variant: "ghost", className: "size-11 md:size-9" })}
        >
          <ChevronLeft />
        </Link>
        <h1 className="text-xl font-semibold">
          <span className="sr-only">Week of </span>
          {weekLabel(weekStart)}
        </h1>
        <Link
          href={`/week?d=${addDays(weekStart, 7)}`}
          aria-label="Next week"
          className={buttonVariants({ variant: "ghost", className: "size-11 md:size-9" })}
        >
          <ChevronRight />
        </Link>
        {!isCurrent && (
          <Link href="/week" className={buttonVariants({ variant: "outline", className: "ml-auto" })}>
            Today
          </Link>
        )}
      </div>

      {access.past && <PastWeekBanner date={weekStart} unlocked={access.unlocked} isAdult={user.role === "adult"} />}

      <ol className="grid gap-3 lg:grid-cols-7" aria-label="Days">
        {week.map((dinner) => (
          <li key={dinner.date} className="flex flex-col *:flex-1">
            <DayCard dinner={dinner} today={cal.today} />
          </li>
        ))}
      </ol>
    </div>
  );
}
