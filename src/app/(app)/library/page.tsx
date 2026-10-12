import type { Metadata } from "next";
import Link from "next/link";
import { FavoriteButton } from "@/components/library/favorite-button";
import { parseLibraryParams, RecipeSearch } from "@/components/library/recipe-search";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { lastMadeLabel, listLibrary, type LibraryItem } from "@/lib/services/library";
import { plannerCalendar } from "@/lib/services/planner";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage({ searchParams }: PageProps<"/library">) {
  const user = await requireUser();
  const db = getDb();
  const cal = await plannerCalendar(db);
  const { q, role, show } = parseLibraryParams(await searchParams);
  const items = await listLibrary(
    db,
    { q, role, favorites: show === "favorites", archived: show === "archived" },
    cal.today,
  );
  const filtered = Boolean(q || role || show);

  return (
    <>
      <h1 className="text-2xl font-semibold">{show === "archived" ? "Archived recipes" : "Library"}</h1>
      <RecipeSearch action="/library" q={q} role={role} show={show} showFilter />
      {items.length === 0 ? (
        <p className="text-muted-foreground">
          {filtered
            ? "No recipes match."
            : "No recipes yet. Dishes you save while planning show up here."}
        </p>
      ) : (
        <RecipeList items={items} today={cal.today} canEdit={user.role === "adult"} />
      )}
    </>
  );
}

function RecipeList({ items, today, canEdit }: { items: LibraryItem[]; today: string; canEdit: boolean }) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Recipes">
      {items.map((r) => (
        <li key={r.id}>
          <Card size="sm">
            <CardContent className="flex items-center gap-3">
              {r.imageUrl && (
                // Hotlinked recipe images (SPEC §6).
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.imageUrl} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Link href={`/library/${r.id}`} className="font-medium underline-offset-4 hover:underline">
                  {r.title}
                </Link>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <Badge variant="outline">{r.dishType === "main" ? "Main" : "Side"}</Badge>
                  <span>{lastMadeLabel(r, today)}</span>
                  {r.timesMade > 0 && <span>· made {r.timesMade === 1 ? "once" : `${r.timesMade} times`}</span>}
                </span>
              </div>
              {!r.archived && <FavoriteButton recipe={r} canEdit={canEdit} />}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
