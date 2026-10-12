import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import { ConfirmAction } from "@/components/confirm-action";
import { SelectField, TextField } from "@/components/field";
import { LiveScope } from "@/components/live-sync";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db";
import { requireAdultPage } from "@/lib/auth/dal";
import { listLibrary } from "@/lib/services/library";
import { plannerCalendar } from "@/lib/services/planner";
import { listRules, MAX_RULE_DISHES, type RuleView } from "@/lib/services/recurring";
import { formatDate, WEEKDAYS } from "@/lib/time";
import { createRuleAction, setRuleActiveAction, updateRuleAction } from "../actions";

export const metadata: Metadata = { title: "Recurring meals" };

const TITLES_LIST = "library-titles";

export default async function RecurringPage() {
  await requireAdultPage();
  const db = getDb();
  const cal = await plannerCalendar(db);
  const [rules, library] = await Promise.all([listRules(db), listLibrary(db, {}, cal.today)]);
  const weekdays = Array.from({ length: 7 }, (_, i) => (cal.weekStartDay + i) % 7);

  return (
    <>
      <LiveScope rules library />
      <div className="flex flex-col gap-1">
        <BackLink href="/settings">Settings</BackLink>
        <h1 className="text-3xl font-extrabold tracking-tight">Recurring meals</h1>
        <p className="text-sm text-muted-foreground">
          Fill a weekday with the same dinner every week. Changes apply to upcoming nights you haven&apos;t edited by
          hand.
        </p>
      </div>

      {/* Typing a library recipe's exact title links that recipe. */}
      <datalist id={TITLES_LIST}>
        {[...new Set(library.map((r) => r.title))].map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      {rules.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label="Recurring meals">
          {rules.map((rule) => (
            <li key={rule.id}>
              <RuleCard rule={rule} weekdays={weekdays} />
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            New recurring meal
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RuleForm prefix="new" weekdays={weekdays} defaults={{ startDate: cal.today }} />
        </CardContent>
      </Card>
    </>
  );
}

function RuleCard({ rule, weekdays }: { rule: RuleView; weekdays: number[] }) {
  const title = `Every ${WEEKDAYS[rule.weekday]}`;
  const short = (d: string) => formatDate(d, { month: "short", day: "numeric", year: "numeric" });
  return (
    <Card size="sm" role="region" aria-label={title} className={rule.active ? undefined : "opacity-70"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {title}
          {!rule.active && <Badge variant="secondary">Stopped</Badge>}
        </CardTitle>
        <CardDescription>
          {rule.dishes.map((d) => d.name).join(" + ")}
          <br />
          From {short(rule.startDate)}
          {rule.endDate ? ` until ${short(rule.endDate)}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium md:min-h-9">Edit</summary>
          <div className="pt-2">
            <RuleForm prefix={rule.id} weekdays={weekdays} rule={rule} />
          </div>
        </details>
        {rule.active ? (
          <ConfirmAction
            action={setRuleActiveAction}
            fields={{ id: rule.id, active: "false" }}
            triggerLabel="Stop repeating"
            title={`Stop repeating ${title.toLowerCase()}?`}
            description="Upcoming nights it filled are cleared, unless you've edited them. Past dinners stay."
            confirmLabel="Stop repeating"
            destructive
          />
        ) : (
          <ActionButton action={setRuleActiveAction} fields={{ id: rule.id, active: "true" }} className="self-start">
            Start again
          </ActionButton>
        )}
      </CardContent>
    </Card>
  );
}

function RuleForm({
  prefix,
  weekdays,
  rule,
  defaults,
}: {
  /** Keeps field ids unique across the page's forms. */
  prefix: string;
  weekdays: number[];
  rule?: RuleView;
  defaults?: { startDate: string };
}) {
  const dishes = rule?.dishes ?? [];
  // The existing dishes plus a couple of blank rows; blank rows are ignored.
  const rows = Array.from({ length: Math.min(MAX_RULE_DISHES, Math.max(3, dishes.length + 2)) }, (_, i) => dishes[i]);
  return (
    <ActionForm
      // Keyed so a saved change shows up in the form.
      key={rule ? JSON.stringify(rule) : "new"}
      action={rule ? updateRuleAction : createRuleAction}
      submitLabel={rule ? "Save" : "Add recurring meal"}
      resetOnSuccess={!rule}
    >
      {rule && <input type="hidden" name="id" value={rule.id} />}
      <SelectField
        id={`${prefix}-weekday`}
        label="Weekday"
        name="weekday"
        defaultValue={String(rule?.weekday ?? weekdays[0])}
        options={weekdays.map((d) => ({ value: String(d), label: WEEKDAYS[d] }))}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField
          id={`${prefix}-start`}
          label="Starts"
          name="startDate"
          type="date"
          required
          defaultValue={rule?.startDate ?? defaults?.startDate}
        />
        <TextField id={`${prefix}-end`} label="Ends (optional)" name="endDate" type="date" defaultValue={rule?.endDate ?? ""} />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Dishes</legend>
        {rows.map((d, i) => (
          <div key={i} className="grid grid-cols-[6.5rem_1fr] items-end gap-2">
            <SelectField
              id={`${prefix}-role-${i}`}
              label={`Dish ${i + 1} role`}
              name={`role-${i}`}
              defaultValue={d?.role ?? (i === 0 ? "main" : "side")}
              options={[
                { value: "main", label: "Main" },
                { value: "side", label: "Side" },
              ]}
            />
            <TextField
              id={`${prefix}-name-${i}`}
              label={`Dish ${i + 1}`}
              name={`name-${i}`}
              list={TITLES_LIST}
              autoComplete="off"
              maxLength={120}
              defaultValue={d?.name ?? ""}
              required={i === 0}
            />
          </div>
        ))}
      </fieldset>
    </ActionForm>
  );
}
