import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { DinnerView } from "@/lib/services/planner";
import { formatDate } from "@/lib/time";
import { cn } from "@/lib/utils";

export const NIGHT_OFF_LABEL = { eat_out: "Eating out", leftovers: "Leftovers" } as const;

/** "Alex", or an "Unassigned" flag on a planned night with no cook. */
export function CookLabel({ dinner }: { dinner: DinnerView }) {
  if (dinner.status !== "planned") return null;
  if (!dinner.cook) return <Badge variant="destructive">Unassigned</Badge>;
  return (
    <span className="text-muted-foreground">
      {dinner.cook.displayName}
      {dinner.cook.archived && " (removed)"}
    </span>
  );
}

/** Compact summary of one night, linking to its day editor. */
export function DayCard({ dinner, today }: { dinner: DinnerView; today: string }) {
  const isToday = dinner.date === today;
  return (
    <Link
      href={`/day/${dinner.date}`}
      aria-label={`${formatDate(dinner.date, { weekday: "long", month: "long", day: "numeric" })}`}
      className={cn(
        "flex min-h-11 flex-col gap-1.5 rounded-xl p-3 text-sm ring-1 ring-foreground/10 transition-colors hover:bg-muted/50",
        isToday && "ring-2 ring-primary",
        dinner.date < today && "opacity-70",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          {formatDate(dinner.date, { weekday: "short" })}{" "}
          <span className="text-muted-foreground">{formatDate(dinner.date, { month: "short", day: "numeric" })}</span>
        </span>
        {isToday && <Badge>Today</Badge>}
      </div>
      {dinner.status === "planned" ? (
        <>
          <ul className="flex flex-col">
            {dinner.dishes.map((d) => (
              <li key={d.id} className={cn("truncate", d.role === "side" && "text-muted-foreground")}>
                {d.name}
              </li>
            ))}
          </ul>
          <div className="text-xs">
            <CookLabel dinner={dinner} />
          </div>
        </>
      ) : dinner.status === "unplanned" ? (
        <span className="text-muted-foreground">Nothing planned</span>
      ) : (
        <span>{NIGHT_OFF_LABEL[dinner.status]}</span>
      )}
    </Link>
  );
}
