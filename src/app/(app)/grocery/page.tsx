import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/field";
import { CheckRow } from "@/components/grocery/check-row";
import { LiveScope } from "@/components/live-sync";
import { PastWeekBanner } from "@/components/planner/past-week-banner";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import type { GroceryItem } from "@/lib/grocery/aggregate";
import { getGroceryList } from "@/lib/services/grocery";
import { plannerCalendar, weekAccess } from "@/lib/services/planner";
import { materializeRecurring } from "@/lib/services/recurring";
import { addDays, formatDate, isIsoDate, weekLabel, weekStartOf } from "@/lib/time";
import {
  addManualItemAction,
  deleteManualItemAction,
  setItemCheckedAction,
  setManualItemCheckedAction,
} from "./actions";

export const metadata: Metadata = { title: "Grocery list" };

export default async function GroceryPage({ searchParams }: PageProps<"/grocery">) {
  const user = await requireUser();
  const db = getDb();
  const cal = await plannerCalendar(db);
  const { d } = await searchParams;
  // Any date in the week works; it's normalized to the week's first day.
  const weekStart =
    typeof d === "string" && isIsoDate(d) ? weekStartOf(d, cal.weekStartDay) : cal.currentWeekStart;
  // The list follows the plan, so recurring meals must be filled in first (SPEC §4.6).
  await materializeRecurring(db, weekStart, addDays(weekStart, 6));
  const [list, access] = await Promise.all([getGroceryList(db, weekStart), weekAccess(db, user, weekStart, cal.today)]);
  const editable = access.editable;
  const isEmpty = list.aisles.length === 0 && list.manual.length === 0;

  return (
    <>
      <LiveScope grocery={[weekStart]} />
      <div className="flex flex-col gap-1">
        <BackLink href={`/week?d=${weekStart}`}>Week</BackLink>
        <h1 className="text-3xl font-extrabold tracking-tight">Grocery list</h1>
        <div className="mt-3 flex items-center gap-1 rounded-full bg-card p-1 ring-1 ring-foreground/5 lg:max-w-md">
          <Link
            href={`/grocery?d=${addDays(weekStart, -7)}`}
            aria-label="Previous week"
            className={buttonVariants({ variant: "ghost", className: "size-11 md:size-9" })}
          >
            <ChevronLeft />
          </Link>
          <p className="flex-1 text-center font-semibold">
            <span className="sr-only">Week of </span>
            {weekLabel(weekStart)}
          </p>
          <Link
            href={`/grocery?d=${addDays(weekStart, 7)}`}
            aria-label="Next week"
            className={buttonVariants({ variant: "ghost", className: "size-11 md:size-9" })}
          >
            <ChevronRight />
          </Link>
          {weekStart !== cal.currentWeekStart && (
            <Link href="/grocery" className={buttonVariants({ variant: "secondary", className: "h-9 bg-accent text-accent-foreground" })}>
              This week
            </Link>
          )}
        </div>
      </div>

      {access.past && <PastWeekBanner date={weekStart} unlocked={access.unlocked} isAdult={user.role === "adult"} />}

      {isEmpty && (
        <p className="text-muted-foreground">
          Nothing to buy yet. Dishes with ingredients on this week&apos;s plan show up here.
        </p>
      )}

      {list.aisles.map(({ aisle, items }) => (
        <section
          key={aisle}
          aria-label={aisle}
          className="flex flex-col rounded-3xl bg-card px-4 pt-3.5 pb-1 ring-1 ring-foreground/5"
        >
          <h2 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">{aisle}</h2>
          <ul className="flex flex-col divide-y">
            {items.map((item) => (
              <li key={item.key}>
                <Item item={item} weekStart={weekStart} editable={editable} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {(list.manual.length > 0 || editable) && (
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Extra items
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {list.manual.length > 0 && (
              <ul className="flex flex-col divide-y" aria-label="Extra items">
                {list.manual.map((m) => (
                  <li key={m.id} className="flex items-center gap-2">
                    <CheckRow
                      action={setManualItemCheckedAction}
                      fields={{ id: m.id }}
                      checked={m.checked}
                      label={m.text}
                      disabled={!editable}
                    >
                      <span>{m.text}</span>
                    </CheckRow>
                    {editable && (
                      <ActionButton
                        action={deleteManualItemAction}
                        fields={{ id: m.id }}
                        label={`Delete ${m.text}`}
                        variant="ghost"
                        className="size-11 md:size-9"
                      >
                        <X />
                      </ActionButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <ActionForm action={addManualItemAction} submitLabel="Add item" resetOnSuccess>
                <input type="hidden" name="weekStart" value={weekStart} />
                <TextField label="Add an item" name="text" required maxLength={200} autoComplete="off" placeholder="Paper towels" />
              </ActionForm>
            )}
          </CardContent>
        </Card>
      )}

      {list.noLongerNeeded.length > 0 && (
        <details className="rounded-3xl bg-card px-4 py-2 ring-1 ring-foreground/5" data-testid="no-longer-needed">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium md:min-h-9">
            No longer needed (already bought) · {list.noLongerNeeded.length}
          </summary>
          <ul className="flex flex-col divide-y pb-2">
            {list.noLongerNeeded.map((n) => (
              <li key={n.key} className="flex items-center gap-2">
                <span className="flex-1 py-2 text-sm">{n.label}</span>
                {editable && (
                  <ActionButton
                    action={setItemCheckedAction}
                    fields={{ weekStart, key: n.key, checked: "false" }}
                    label={`Dismiss ${n.label}`}
                    variant="ghost"
                    className="size-11 md:size-9"
                  >
                    <X />
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function Item({ item, weekStart, editable }: { item: GroceryItem; weekStart: string; editable: boolean }) {
  // A dish can list an ingredient twice ("2 onions", "1 cup chopped onion").
  const dishCount = new Set(item.sources.map((s) => `${s.date} ${s.dishName}`)).size;
  return (
    <div className="flex flex-col">
      <CheckRow
        action={setItemCheckedAction}
        fields={{ weekStart, key: item.key }}
        checked={item.checked}
        label={item.name}
        disabled={!editable}
      >
        <span>
          <span className="font-medium">{item.name}</span>
          {item.text && <span className="text-muted-foreground"> · {item.text}</span>}
        </span>
        {item.increase && (
          <span className="text-xs font-semibold text-attention-foreground no-underline" role="note">
            {item.increase} needed since you checked this
          </span>
        )}
      </CheckRow>
      <details className="pl-8 text-xs text-muted-foreground">
        <summary className="flex min-h-11 cursor-pointer items-center md:min-h-7">
          {dishCount === 1 ? "1 dish" : `${dishCount} dishes`}
        </summary>
        <ul className="flex flex-col gap-0.5 pb-2" aria-label={`${item.name} by dish`}>
          {item.sources.map((s, i) => (
            <li key={i}>
              {s.dishName} ({formatDate(s.date, { weekday: "short" })}): {s.text}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
