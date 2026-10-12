"use client";

import { useActionState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/form-state";
import { cn } from "@/lib/utils";

type Props = {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  fields: Record<string, string>;
  children: ReactNode;
  /** Accessible name, for icon-only buttons. */
  label?: string;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  className?: string;
  /** Show the action's success message as a toast. */
  toastSuccess?: boolean;
};

/** A one-tap button that submits hidden fields to a server action. */
export function ActionButton({ action, fields, children, label, variant = "outline", className, toastSuccess }: Props) {
  const [state, formAction, pending] = useActionState(async (prev: FormState, formData: FormData) => {
    const result = await action(prev, formData);
    if (toastSuccess && result?.success) toast.success(result.success);
    return result;
  }, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-1">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button type="submit" variant={variant} disabled={pending} aria-label={label} className={cn(className)}>
        {children}
      </Button>
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}
