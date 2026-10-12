import Form from "next/form";
import { SelectField, TextField } from "@/components/field";
import { Button } from "@/components/ui/button";
import type { LibraryFilter } from "@/lib/services/library";

/** Reads the library search params shared by the library page and the day editor's picker. */
export function parseLibraryParams(sp: Record<string, string | string[] | undefined>) {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const role = one("role");
  const show = one("show");
  return {
    q: one("q"),
    role: role === "main" || role === "side" ? role : undefined,
    show: show === "favorites" || show === "archived" ? show : "",
  } satisfies { q: string; role: LibraryFilter["role"]; show: string };
}

/** A GET search form: title, main/side, and (on the library page) favorites/archived. */
export function RecipeSearch({
  action,
  q,
  role,
  show,
  showFilter,
}: {
  action: string;
  q: string;
  role?: "main" | "side";
  show?: string;
  /** Offer the favorites/archived filter. */
  showFilter?: boolean;
}) {
  return (
    <Form action={action} role="search" className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <TextField label="Search recipes" name="q" type="search" defaultValue={q} autoComplete="off" />
      </div>
      <SelectField
        label="Type"
        name="role"
        defaultValue={role ?? ""}
        options={[
          { value: "", label: "Mains and sides" },
          { value: "main", label: "Mains" },
          { value: "side", label: "Sides" },
        ]}
      />
      {showFilter && (
        <SelectField
          label="Show"
          name="show"
          defaultValue={show ?? ""}
          options={[
            { value: "", label: "All recipes" },
            { value: "favorites", label: "Favorites" },
            { value: "archived", label: "Archived" },
          ]}
        />
      )}
      <Button type="submit" variant="outline" className="self-start sm:self-auto">
        Search
      </Button>
    </Form>
  );
}
