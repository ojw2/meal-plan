"use client";

import { useState } from "react";
import { SelectField } from "@/components/field";
import { WEEKDAYS } from "@/lib/time";

/** Week start picker that warns, before saving, that grocery check-offs may reset (SPEC §4.8). */
export function WeekStartSelect({ saved }: { saved: number }) {
  const [value, setValue] = useState(String(saved));
  return (
    <div className="flex flex-col gap-1.5">
      <SelectField
        label="Week starts on"
        name="weekStartDay"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))}
        aria-describedby={value !== String(saved) ? "week-start-warning" : undefined}
      />
      {value !== String(saved) && (
        <p id="week-start-warning" role="alert" className="text-sm text-amber-700 dark:text-amber-400">
          Grocery check-offs for this week may reset. Extra items and check-offs move to the new weeks where possible.
        </p>
      )}
    </div>
  );
}
