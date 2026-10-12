import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, BookOpen, ExternalLink, Repeat, Sparkles, X } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import { ConfirmAction } from "@/components/confirm-action";
import { CheckboxField, SelectField, TextareaField, TextField } from "@/components/field";
import { CookLabel, NIGHT_OFF_LABEL } from "@/components/planner/day-card";
import { PastWeekBanner } from "@/components/planner/past-week-banner";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { listActiveAdults } from "@/lib/services/members";
import { getDinner, plannerCalendar, weekAccess, type DinnerView } from "@/lib/services/planner";
import { materializeRecurring } from "@/lib/services/recurring";
import { formatDate, isIsoDate, weekStartOf } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  addManualDishAction,
  moveDishAction,
  removeDishAction,
  repeatWeeklyAction,
  resetDinnerCookAction,
  saveDinnerDetailsAction,
  setDinnerStatusAction,
} from "../actions";

export async function generateMetadata({ params }: PageProps<"/day/[date]">): Promise<Metadata> {
  const { date } = await params;
  return { title: isIsoDate(date) ? formatDate(date, { weekday: "long", month: "short", day: "numeric" }) : "Day" };
}

export default async function DayPage({ params }: PageProps<"/day/[date]">) {
  const { date } = await params;
  if (!isIsoDate(date)) notFound();
  const user = await requireUser();
  const db = getDb();
  const cal = await plannerCalendar(db);
  const weekStart = weekStartOf(date, cal.weekStartDay);
  await materializeRecurring(db, date, date);
  const [dinner, access, adults] = await Promise.all([
    getDinner(db, date),
    weekAccess(db, user, weekStart, cal.today),
    listActiveAdults(db),
  ]);
  const editable = access.editable;

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/week?d=${date}`} className="text-sm text-muted-foreground hover:underline">
          ← Week
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">{formatDate(date, { weekday: "long", month: "long", day: "numeric" })}</h1>
          {date === cal.today && <Badge>Today</Badge>}
        </div>
      </div>

      {access.past && <PastWeekBanner date={date} unlocked={access.unlocked} isAdult={user.role === "adult"} />}

      {dinner.status === "eat_out" || dinner.status === "leftovers" ? (
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              {NIGHT_OFF_LABEL[dinner.status]}
            </CardTitle>
            <CardDescription>No cooking tonight.</CardDescription>
          </CardHeader>
          {editable && (
            <CardContent>
              <ActionButton action={setDinnerStatusAction} fields={{ date, status: "unplanned" }}>
                Plan a dinner instead
              </ActionButton>
            </CardContent>
          )}
        </Card>
      ) : (
        <>
          <DishList dinner={dinner} editable={editable} />
          {dinner.status === "planned" && (
            <Recurring dinner={dinner} editable={editable} isAdult={user.role === "adult"} />
          )}
          {dinner.status === "planned" &&
            (editable ? (
              <DinnerDetails dinner={dinner} adults={adults} defaultServings={cal.defaultServings} />
            ) : (
              <p className="text-sm">
                Cook: <CookLabel dinner={dinner} />
                {dinner.servingsOverride && (
                  <span className="text-muted-foreground"> · {dinner.servingsOverride} servings</span>
                )}
              </p>
            ))}
          {editable && <AddDish date={date} hasDishes={dinner.dishes.length > 0} />}
          {editable && <NightOff dinner={dinner} />}
        </>
      )}
    </>
  );
}

function DishList({ dinner, editable }: { dinner: DinnerView; editable: boolean }) {
  if (dinner.dishes.length === 0) {
    return <p className="text-muted-foreground">Nothing planned yet.</p>;
  }
  const last = dinner.dishes.length - 1;
  return (
    <ul className="flex flex-col gap-2" aria-label="Dishes">
      {dinner.dishes.map((dish, i) => (
        <li key={dish.id}>
          <Card size="sm">
            <CardContent className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-medium" data-testid="dish-name">
                  {dish.recipe ? (
                    <Link href={`/library/${dish.recipe.id}`} className="underline-offset-4 hover:underline">
                      {dish.name}
                    </Link>
                  ) : (
                    dish.name
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{dish.role === "main" ? "Main" : "Side"}</Badge>
                  {dish.recipe?.readyInMinutes && <span>{dish.recipe.readyInMinutes} min</span>}
                  {dish.recipe?.sourceUrl && (
                    <a
                      href={dish.recipe.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                    >
                      Recipe <ExternalLink className="size-3" />
                    </a>
                  )}
                </span>
              </div>
              {editable && (
                <div className="flex items-center">
                  {i > 0 && (
                    <ActionButton
                      action={moveDishAction}
                      fields={{ dishId: dish.id, direction: "up" }}
                      label={`Move ${dish.name} up`}
                      variant="ghost"
                      className="size-11 md:size-9"
                    >
                      <ArrowUp />
                    </ActionButton>
                  )}
                  {i < last && (
                    <ActionButton
                      action={moveDishAction}
                      fields={{ dishId: dish.id, direction: "down" }}
                      label={`Move ${dish.name} down`}
                      variant="ghost"
                      className="size-11 md:size-9"
                    >
                      <ArrowDown />
                    </ActionButton>
                  )}
                  <ActionButton
                    action={removeDishAction}
                    fields={{ dishId: dish.id }}
                    label={`Remove ${dish.name}`}
                    variant="ghost"
                    className="size-11 md:size-9"
                  >
                    <X />
                  </ActionButton>
                </div>
              )}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

/** "Repeats every Tuesday", or a button to make it so (SPEC §4.6). */
function Recurring({ dinner, editable, isAdult }: { dinner: DinnerView; editable: boolean; isAdult: boolean }) {
  const weekday = formatDate(dinner.date, { weekday: "long" });
  if (dinner.recurring && !dinner.recurring.overridden) {
    return (
      <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <Repeat className="size-4" /> Repeats every {weekday}.
        {isAdult && (
          <Link href="/settings/recurring" className="underline underline-offset-4">
            Manage recurring meals
          </Link>
        )}
      </p>
    );
  }
  if (!editable) return null;
  return (
    <ActionButton action={repeatWeeklyAction} fields={{ date: dinner.date }} variant="ghost" className="self-start">
      <Repeat /> Repeat every {weekday}
    </ActionButton>
  );
}

function DinnerDetails({
  dinner,
  adults,
  defaultServings,
}: {
  dinner: DinnerView;
  adults: { id: string; displayName: string }[];
  defaultServings: number;
}) {
  const cookOptions = [
    { value: "", label: "Unassigned" },
    ...adults.map((a) => ({ value: a.id, label: a.displayName })),
  ];
  // Keep a removed member visible if they still hold this (past) night.
  if (dinner.cook && !adults.some((a) => a.id === dinner.cook!.id)) {
    cookOptions.push({ value: dinner.cook.id, label: `${dinner.cook.displayName} (removed)` });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cook and servings</CardTitle>
        <CardDescription>
          {dinner.cookManuallySet ? "Cook picked by hand." : "Cook comes from the default schedule."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Keyed so a refresh after another change shows the saved values. */}
        <ActionForm
          key={`${dinner.cook?.id}-${dinner.servingsOverride}`}
          action={saveDinnerDetailsAction}
          submitLabel="Save"
        >
          <input type="hidden" name="date" value={dinner.date} />
          <SelectField label="Cook" name="cookUserId" defaultValue={dinner.cook?.id ?? ""} options={cookOptions} />
          <TextField
            label="Servings"
            name="servingsOverride"
            type="number"
            inputMode="numeric"
            min={1}
            max={50}
            placeholder={`${defaultServings} (household default)`}
            defaultValue={dinner.servingsOverride ?? ""}
          />
        </ActionForm>
        {dinner.cookManuallySet && (
          <ActionButton action={resetDinnerCookAction} fields={{ date: dinner.date }} variant="ghost" className="self-start">
            Use default cook
          </ActionButton>
        )}
      </CardContent>
    </Card>
  );
}

function AddDish({ date, hasDishes }: { date: string; hasDishes: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a dish</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Link href={`/day/${date}/suggest`} className={cn(buttonVariants())}>
            <Sparkles /> Suggest recipes
          </Link>
          <Link href={`/day/${date}/library`} className={cn(buttonVariants({ variant: "outline" }))}>
            <BookOpen /> From library
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">Or type in what you&apos;re making:</p>
        {/* Keyed so the role default switches to "side" once the night has a dish. */}
        <ActionForm key={String(hasDishes)} action={addManualDishAction} submitLabel="Add dish" resetOnSuccess>
          <input type="hidden" name="date" value={date} />
          <TextField label="Dish name" name="name" required maxLength={120} autoComplete="off" />
          <SelectField
            label="Role"
            name="role"
            // The first dish is usually the main; later ones are usually sides.
            defaultValue={hasDishes ? "side" : "main"}
            options={[
              { value: "main", label: "Main" },
              { value: "side", label: "Side" },
            ]}
          />
          <details className="group flex flex-col gap-4">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium md:min-h-9">
              Ingredients and details (optional)
            </summary>
            <div className="flex flex-col gap-4 pt-2">
              <TextareaField
                label="Ingredients"
                name="ingredients"
                rows={4}
                hint="One per line, e.g. “1 lb ground beef”. They feed the grocery list."
              />
              <TextField label="Recipe link" name="sourceUrl" type="url" inputMode="url" placeholder="https://" />
              <TextField label="Ready in (minutes)" name="readyInMinutes" type="number" inputMode="numeric" min={1} />
              <TextareaField label="Notes" name="notes" rows={2} />
            </div>
          </details>
          <CheckboxField label="Save to library" name="saveToLibrary" defaultChecked />
        </ActionForm>
      </CardContent>
    </Card>
  );
}

function NightOff({ dinner }: { dinner: DinnerView }) {
  const options = [
    { status: "eat_out", label: "Eat out" },
    { status: "leftovers", label: "Leftovers" },
  ] as const;
  const count = dinner.dishes.length;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Not cooking?</h2>
      <div className="flex flex-wrap gap-2">
        {options.map((o) =>
          count > 0 ? (
            <ConfirmAction
              key={o.status}
              action={setDinnerStatusAction}
              fields={{ date: dinner.date, status: o.status }}
              triggerLabel={o.label}
              title={`Mark as ${o.label.toLowerCase()}?`}
              description={`This removes the ${count === 1 ? "dish" : `${count} dishes`} planned for this night.`}
              confirmLabel={o.label}
            />
          ) : (
            <ActionButton key={o.status} action={setDinnerStatusAction} fields={{ date: dinner.date, status: o.status }}>
              {o.label}
            </ActionButton>
          ),
        )}
      </div>
    </section>
  );
}
