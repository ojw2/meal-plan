import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { SelectField, TextField } from "@/components/field";
import { TimezoneSelect } from "@/components/timezone-select";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db";
import { requireAdultPage } from "@/lib/auth/dal";
import { getCookSchedule, getHousehold } from "@/lib/services/household";
import { listActiveAdults } from "@/lib/services/members";
import { getQuota } from "@/lib/spoonacular/client";
import { isLive } from "@/lib/spoonacular/transport";
import { WEEKDAYS } from "@/lib/time";
import { saveCookScheduleAction, saveHouseholdAction } from "./actions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireAdultPage();
  const db = getDb();
  const [household, schedule, adults, quota] = await Promise.all([
    getHousehold(db),
    getCookSchedule(db),
    listActiveAdults(db),
    getQuota(db),
  ]);
  if (!household) throw new Error("Household not set up");

  // Display the week in the household's configured order.
  const weekdays = Array.from({ length: 7 }, (_, i) => (household.weekStartDay + i) % 7);
  const cookOptions = [
    { value: "", label: "No default" },
    ...adults.map((a) => ({ value: a.id, label: a.displayName })),
  ];

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <div className="flex flex-wrap justify-end gap-2">
          <Link href="/settings/members" className={buttonVariants({ variant: "outline" })}>
            Members
          </Link>
          <Link href="/settings/recurring" className={buttonVariants({ variant: "outline" })}>
            Recurring meals
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Household</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveHouseholdAction} submitLabel="Save household">
            <TextField label="Household name" name="name" required defaultValue={household.name} />
            <TimezoneSelect defaultValue={household.timezone} />
            <SelectField
              label="Week starts on"
              name="weekStartDay"
              defaultValue={String(household.weekStartDay)}
              options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))}
            />
            <TextField
              label="Default servings"
              name="defaultServings"
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              required
              defaultValue={household.defaultServings}
            />
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Default cook schedule</CardTitle>
          <CardDescription>
            New dinners are pre-assigned to these cooks. Changes apply to upcoming dinners unless a
            cook was picked by hand.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveCookScheduleAction} submitLabel="Save schedule">
            <div className="grid gap-4 sm:grid-cols-2">
              {weekdays.map((d) => (
                <SelectField
                  key={d}
                  label={WEEKDAYS[d]}
                  name={`day-${d}`}
                  defaultValue={schedule[d] ?? ""}
                  options={cookOptions}
                />
              ))}
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Spoonacular</CardTitle>
          <CardDescription>
            Recipe suggestions use a daily allowance of API points that resets at midnight UTC.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm" data-testid="quota">
          {quota ? (
            <p>
              Today: {formatPoints(quota.used)} points used
              {quota.left !== null && <>, {formatPoints(quota.left)} left</>}.
            </p>
          ) : (
            <p>No suggestions searched today.</p>
          )}
          {!isLive() && (
            <p className="text-muted-foreground">Using built-in sample recipes (SPOONACULAR_LIVE is not set).</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

const formatPoints = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
