"use client";

import { startTransition, useActionState, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/form-state";
import { cn } from "@/lib/utils";

type Props = {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  submitVariant?: "default" | "outline" | "destructive" | "secondary";
  /** Clear the fields after a successful submit (e.g. "add" forms). */
  resetOnSuccess?: boolean;
  className?: string;
  children?: ReactNode;
};

/** A form bound to a server action, with pending state and inline feedback. */
export function ActionForm({
  action,
  submitLabel,
  submitVariant,
  resetOnSuccess,
  className,
  children,
}: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await action(prev, formData);
      if (resetOnSuccess && result?.success) formRef.current?.reset();
      return result;
    },
    undefined,
  );

  return (
    <form
      ref={formRef}
      action={formAction}
      // Submitting via a transition (instead of the form action) skips React's
      // automatic reset, so a validation error doesn't wipe what was typed.
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        startTransition(() => formAction(formData));
      }}
      className={cn("flex flex-col gap-4", className)}
    >
      {children}
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p role="status" className="text-sm text-muted-foreground">
          {state.success}
        </p>
      )}
      <Button type="submit" variant={submitVariant} disabled={pending} className="self-start">
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
