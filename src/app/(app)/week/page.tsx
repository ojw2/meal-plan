import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Copy, ListChecks } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { LiveScope } from "@/components/live-sync";
import { DayCard } from "@/components/planner/day-card";
import { PastWeekBanner } from "@/components/planner/past-week-banner";
import { buttonVariants } from "@/components/ui/button";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { getWeek, plannerCalendar, weekAccess } from "@/lib/services/planner";
import { materializeRecurring } from "@/lib/services/recurring";
import { addDays, isIsoDate, weekLabel, weekStartOf } from "@/lib/time";
import { cn } from "@/lib/utils";
import { copyLastWeekAction } from "../day/actions";

export const metadata: Metadata = { title: "Week" };

export default async function WeekPage({ searchParams }: PageProps<"/week">) {
  const user = await requireUser();
  const db = getDb();
  const cal = await plannerCalendar(db);
  const { d } = await searchParams;
  // Any date in the week works; it's normalized to the week's first day.
  const weekStart =
    typeof d === "string" && isIsoDate(d) ? weekStartOf(d, cal.weekStartDay) : cal.currentWeekStart;
  // Opening a week fills its recurring meals (SPEC §4.6).
  await materializeRecurring(db, weekStart, addDays(weekStart, 6));
  const [week, access] = await Promise.all([getWeek(db, weekStart), weekAccess(db, user, weekStart, cal.today)]);
  const isCurrent = weekStart === cal.currentWeekStart;
  // Copy last week only fills nights from today on.
  const canCopy = user.role === "adult" && addDays(weekStart, 6) >= cal.today;

  const settled = week.filter((d) => d.status !== "unplanned").length;

  return (
    // data-wide lets the layout widen for the 7-column desktop grid.
    <div data-wide className="flex flex-col gap-4">
      <LiveScope weeks={[weekStart]} />
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight">
          <span className="sr-only">Week of </span>
          {weekLabel(weekStart)}
        </h1>
        {!isCurrent && (
          <Link href="/week" className={buttonVariants({ variant: "secondary", className: "bg-accent text-accent-foreground" })}>
            Today
          </Link>
        )}
      </div>

      <div className="flex items-center gap-2 rounded-full bg-card p-1 ring-1 ring-foreground/5 lg:max-w-md">
        <Link
          href={`/week?d=${addDays(weekStart, -7)}`}
          aria-label="Previous week"
          className={buttonVariants({ variant: "ghost", className: "size-11 md:size-9" })}
        >
          <ChevronLeft />
        </Link>
        <div className="flex flex-1 flex-col items-center gap-1.5">
          <span className="text-[0.8rem] text-muted-foreground">
            {settled} of 7 nights planned
          </span>
          <span className="flex h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span className="bg-primary" style={{ width: `${(settled / 7) * 100}%` }} />
          </span>
        </div>
        <Link
          href={`/week?d=${addDays(weekStart, 7)}`}
          aria-label="Next week"
          className={buttonVariants({ variant: "ghost", className: "size-11 md:size-9" })}
        >
          <ChevronRight />
        </Link>
      </div>

      {access.past && <PastWeekBanner date={weekStart} unlocked={access.unlocked} isAdult={user.role === "adult"} />}

      <div className="grid grid-cols-2 gap-2 sm:flex">
        {canCopy && (
          <ActionButton action={copyLastWeekAction} fields={{ date: weekStart }} toastSuccess className="w-full">
            <Copy /> Copy last week
          </ActionButton>
        )}
        {/* Kids can view the list too (SPEC §4.8). */}
        <Link
          href={`/grocery?d=${weekStart}`}
          className={buttonVariants({ className: cn(!canCopy && "col-span-2 sm:col-auto") })}
        >
          <ListChecks /> Grocery list
        </Link>
      </div>

      <ol className="grid gap-2 lg:grid-cols-7" aria-label="Days">
        {week.map((dinner) => (
          <li key={dinner.date} className="flex flex-col *:flex-1">
            <DayCard dinner={dinner} today={cal.today} canPlan={access.editable} />
          </li>
        ))}
      </ol>
    </div>
  );
}
