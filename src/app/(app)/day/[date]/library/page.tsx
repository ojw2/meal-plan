import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Star } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { ActionButton } from "@/components/action-button";
import { parseLibraryParams, RecipeSearch } from "@/components/library/recipe-search";
import { LiveScope } from "@/components/live-sync";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { lastMadeLabel, listLibrary } from "@/lib/services/library";
import { plannerCalendar, weekAccess } from "@/lib/services/planner";
import { formatDate, isIsoDate, weekStartOf } from "@/lib/time";
import { addLibraryDishAction } from "../../actions";

export const metadata: Metadata = { title: "Add from library" };

export default async function LibraryPickerPage({ params, searchParams }: PageProps<"/day/[date]/library">) {
  const { date } = await params;
  if (!isIsoDate(date)) notFound();
  const user = await requireUser();
  const db = getDb();
  const cal = await plannerCalendar(db);
  const access = await weekAccess(db, user, weekStartOf(date, cal.weekStartDay), cal.today);
  // Kids and locked past weeks get the read-only day view instead.
  if (!access.editable) redirect(`/day/${date}`);
  const { q, role } = parseLibraryParams(await searchParams);
  // Favorites first, then whatever hasn't been made in a while (SPEC §4.5).
  const items = await listLibrary(db, { q, role }, cal.today, "picker");

  return (
    <>
      <LiveScope library weeks={[weekStartOf(date, cal.weekStartDay)]} />
      <div className="flex flex-col gap-1">
        <BackLink href={`/day/${date}`}>{formatDate(date, { weekday: "long", month: "short", day: "numeric" })}</BackLink>
        <h1 className="text-3xl font-extrabold tracking-tight">Add from library</h1>
      </div>
      <RecipeSearch action={`/day/${date}/library`} q={q} role={role} />
      {items.length === 0 ? (
        <p className="text-muted-foreground">
          {q || role ? "No recipes match." : "The library is empty. Suggested and saved dishes end up here."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Recipes">
          {items.map((r) => (
            <li key={r.id}>
              <Card size="sm">
                <CardContent className="flex items-center gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-1 font-medium">
                      {r.isFavorite && <Star aria-label="Favorite" className="size-4 shrink-0 fill-amber-400 text-amber-500" />}
                      {r.title}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">{r.dishType === "main" ? "Main" : "Side"}</Badge>
                      {r.readyInMinutes && <span>{r.readyInMinutes} min</span>}
                      <span>{lastMadeLabel(r, cal.today)}</span>
                    </span>
                  </div>
                  <ActionButton
                    action={addLibraryDishAction}
                    fields={{ date, recipeId: r.id }}
                    label={`Add ${r.title}`}
                  >
                    Add
                  </ActionButton>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
