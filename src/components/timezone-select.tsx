"use client";

import { useEffect, useRef } from "react";
import { SelectField } from "@/components/field";

const ZONES = Intl.supportedValuesOf("timeZone");

/** Timezone picker; with no `defaultValue`, preselects the browser's zone. */
export function TimezoneSelect({ defaultValue }: { defaultValue?: string }) {
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (!defaultValue && ref.current) {
      ref.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  }, [defaultValue]);
  return (
    <SelectField
      ref={ref}
      label="Timezone"
      name="timezone"
      defaultValue={defaultValue ?? "UTC"}
      options={ZONES.map((z) => ({ value: z, label: z.replaceAll("_", " ") }))}
    />
  );
}
