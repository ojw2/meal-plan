import Link from "next/link";
import { Plus, Repeat } from "lucide-react";
import type { DinnerView } from "@/lib/services/planner";
import { formatDate } from "@/lib/time";
import { cn } from "@/lib/utils";

export const NIGHT_OFF_LABEL = { eat_out: "Eating out", leftovers: "Leftovers" } as const;

// Static so Tailwind sees every class; one per --cook-N in globals.css (COOK_TONES).
const COOK_TONE_CLASS = [
  "bg-(--cook-0) text-(--cook-0-foreground)",
  "bg-(--cook-1) text-(--cook-1-foreground)",
  "bg-(--cook-2) text-(--cook-2-foreground)",
  "bg-(--cook-3) text-(--cook-3-foreground)",
  "bg-(--cook-4) text-(--cook-4-foreground)",
  "bg-(--cook-5) text-(--cook-5-foreground)",
];

const chip = "inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-[0.8rem] font-semibold whitespace-nowrap";

/** The night's cook in their color, or a "No cook" flag on a planned night with no cook. */
export function CookLabel({ dinner, children }: { dinner: DinnerView; children?: React.ReactNode }) {
  if (dinner.status !== "planned") return null;
  if (!dinner.cook) return <span className={cn(chip, "bg-attention-soft text-attention-foreground")}>No cook</span>;
  return (
    <span className={cn(chip, COOK_TONE_CLASS[dinner.cook.tone])}>
      {/* One inline run, so a trailing " is cooking" keeps its space. */}
      <span>
        {dinner.cook.displayName}
        {dinner.cook.archived && " (removed)"}
        {children}
      </span>
    </span>
  );
}

/** "Lemon chicken" and "+ Broccoli, Rice": the first main, then everything else. */
export function dishSummary(dinner: DinnerView) {
  const lead = dinner.dishes.find((d) => d.role === "main") ?? dinner.dishes[0];
  const rest = dinner.dishes.filter((d) => d !== lead);
  return { lead, rest };
}

/** Compact summary of one night, linking to its day editor. */
export function DayCard({ dinner, today, canPlan }: { dinner: DinnerView; today: string; canPlan: boolean }) {
  const isToday = dinner.date === today;
  const isPast = dinner.date < today;
  const open = dinner.status === "unplanned" && !isPast;
  const { lead, rest } = dishSummary(dinner);
  return (
    <Link
      href={`/day/${dinner.date}`}
      aria-label={`${formatDate(dinner.date, { weekday: "long", month: "long", day: "numeric" })}`}
      className={cn(
        "@container rounded-3xl p-2.5 text-sm transition-colors",
        open
          ? "border-[1.5px] border-dashed border-attention hover:bg-card/60"
          : "bg-card ring-1 ring-foreground/5 hover:bg-card/70",
        isToday && "ring-2 ring-primary",
        isPast && "opacity-60",
      )}
    >
      <div className="flex h-full items-center gap-3 @max-2xs:flex-col @max-2xs:items-start">
        <span
          className={cn(
            "flex size-12 shrink-0 flex-col items-center justify-center rounded-2xl text-[0.7rem] leading-tight font-medium uppercase",
            isToday
              ? "bg-primary text-primary-foreground"
              : open
                ? "bg-attention-soft text-attention-foreground"
                : "bg-muted text-muted-foreground",
          )}
        >
          {formatDate(dinner.date, { weekday: "short" })}
          <strong className={cn("text-lg leading-none font-bold", !isToday && "text-foreground")}>
            {formatDate(dinner.date, { day: "numeric" })}
          </strong>
          {isToday && <span className="sr-only">Today</span>}
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {dinner.status === "planned" ? (
            <>
              <span className="flex items-center gap-1.5 text-[0.95rem] font-semibold">
                <span className="truncate @max-2xs:whitespace-normal">{lead.name}</span>
                {dinner.recurring && !dinner.recurring.overridden && (
                  <Repeat className="size-3.5 shrink-0 text-muted-foreground" role="img" aria-label="Repeats weekly" />
                )}
              </span>
              {rest.length > 0 && (
                <span className="truncate text-muted-foreground @max-2xs:whitespace-normal">
                  + {rest.map((d) => d.name).join(", ")}
                </span>
              )}
            </>
          ) : dinner.status === "unplanned" ? (
            <span className="text-muted-foreground">{open ? "Nothing yet" : "Nothing planned"}</span>
          ) : (
            <span className="text-muted-foreground">{NIGHT_OFF_LABEL[dinner.status]}</span>
          )}
        </div>

        {dinner.status === "planned" ? (
          <CookLabel dinner={dinner} />
        ) : (
          open &&
          canPlan && (
            <span className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-primary px-3.5 text-sm font-bold text-primary-foreground">
              <Plus className="size-4" aria-hidden /> Plan
            </span>
          )
        )}
      </div>
    </Link>
  );
}
