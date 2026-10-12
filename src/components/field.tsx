import type { ComponentProps, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FieldProps = { label: string; hint?: ReactNode } & ComponentProps<"input"> & { name: string };

export function TextField({ label, hint, id, name, ...props }: FieldProps) {
  const inputId = id ?? `f-${name}`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      <Input id={inputId} name={name} {...props} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

type SelectFieldProps = {
  label: string;
  name: string;
  options: { value: string; label: string }[];
} & Omit<ComponentProps<"select">, "children">;

/** Native select: best picker UX on phones. Styled to match Input. */
export function SelectField({ label, name, options, id, className, ...props }: SelectFieldProps) {
  const selectId = id ?? `f-${name}`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={selectId}>{label}</Label>
      <select
        id={selectId}
        name={name}
        className={cn(
          "h-11 md:h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-base md:text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
          className,
        )}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

type TextareaFieldProps = { label: string; hint?: ReactNode; name: string } & ComponentProps<"textarea">;

export function TextareaField({ label, hint, id, name, className, ...props }: TextareaFieldProps) {
  const inputId = id ?? `f-${name}`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      <textarea
        id={inputId}
        name={name}
        rows={3}
        className={cn(
          "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30",
          className,
        )}
        {...props}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

type CheckboxFieldProps = { label: string; name: string } & Omit<ComponentProps<"input">, "type">;

/** Native checkbox; the whole row is the tap target. */
export function CheckboxField({ label, id, name, ...props }: CheckboxFieldProps) {
  const inputId = id ?? `f-${name}`;
  return (
    <label htmlFor={inputId} className="flex min-h-11 items-center gap-3 text-sm md:min-h-9">
      <input id={inputId} name={name} type="checkbox" className="size-5 accent-primary" {...props} />
      {label}
    </label>
  );
}
