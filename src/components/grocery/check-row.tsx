"use client";

import { useOptimistic, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import type { FormState } from "@/lib/form-state";
import { cn } from "@/lib/utils";

type Props = {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** Sent with the new `checked` value. */
  fields: Record<string, string>;
  checked: boolean;
  /** Accessible name for the checkbox. */
  label: string;
  /** Read-only (kids, locked weeks): shows the state without a control. */
  disabled?: boolean;
  children: ReactNode;
};

/**
 * A checkable list row. The tick shows immediately (SPEC §5: optimistic);
 * if the server refuses, it reverts and the error shows as a toast.
 */
export function CheckRow({ action, fields, checked, label, disabled, children }: Props) {
  const [optimistic, setOptimistic] = useOptimistic(checked);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    startTransition(async () => {
      setOptimistic(next);
      const formData = new FormData();
      for (const [k, v] of Object.entries(fields)) formData.set(k, v);
      formData.set("checked", String(next));
      const result = await action(undefined, formData);
      if (result?.error) toast.error(result.error);
    });
  }

  return (
    <label
      // Saving in the background; lets tests (and assistive tech) know.
      aria-busy={pending}
      className={cn("flex min-h-11 flex-1 items-start gap-3 py-2 md:min-h-9", !disabled && "cursor-pointer")}
    >
      <input
        type="checkbox"
        className="mt-0.5 size-5 shrink-0 accent-primary"
        checked={optimistic}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => toggle(e.currentTarget.checked)}
      />
      <span className={cn("flex min-w-0 flex-1 flex-col gap-0.5", optimistic && "text-muted-foreground line-through")}>
        {children}
      </span>
    </label>
  );
}
