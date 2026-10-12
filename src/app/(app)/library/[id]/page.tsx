import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, ExternalLink, Users } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { ConfirmAction } from "@/components/confirm-action";
import { FavoriteButton } from "@/components/library/favorite-button";
import { LiveScope } from "@/components/live-sync";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { getRecipeDetails, lastMadeLabel } from "@/lib/services/library";
import { plannerCalendar } from "@/lib/services/planner";
import { archiveRecipeAction, restoreRecipeAction } from "../actions";

export async function generateMetadata({ params }: PageProps<"/library/[id]">): Promise<Metadata> {
  const { id } = await params;
  const db = getDb();
  const cal = await plannerCalendar(db);
  return { title: (await getRecipeDetails(db, id, cal.today))?.title ?? "Recipe" };
}

export default async function RecipePage({ params }: PageProps<"/library/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const db = getDb();
  const cal = await plannerCalendar(db);
  const recipe = await getRecipeDetails(db, id, cal.today);
  if (!recipe) notFound();
  const isAdult = user.role === "adult";

  return (
    <>
      <LiveScope library />
      <div className="flex flex-col gap-1">
        <Link href="/library" className="text-sm text-muted-foreground hover:underline">
          ← Library
        </Link>
        <div className="flex items-start gap-2">
          <h1 className="flex-1 text-2xl font-semibold">{recipe.title}</h1>
          {!recipe.archived && <FavoriteButton recipe={recipe} canEdit={isAdult} />}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <Badge variant="outline">{recipe.dishType === "main" ? "Main" : "Side"}</Badge>
          {recipe.archived && <Badge variant="secondary">Archived</Badge>}
          {recipe.readyInMinutes && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" /> {recipe.readyInMinutes} min
            </span>
          )}
          {recipe.servings && (
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" /> Serves {recipe.servings}
            </span>
          )}
        </div>
        <p className="text-sm" data-testid="history">
          {lastMadeLabel(recipe, cal.today)}
          {recipe.timesMade > 0 && <> · made {recipe.timesMade === 1 ? "once" : `${recipe.timesMade} times`}</>}
        </p>
      </div>

      {recipe.imageUrl && (
        // Hotlinked recipe images (SPEC §6).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={recipe.imageUrl} alt="" className="max-h-64 w-full rounded-xl object-cover" />
      )}

      {recipe.sourceUrl && (
        <a
          href={recipe.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 self-start text-sm font-medium underline-offset-4 hover:underline"
        >
          {/* Instructions aren't stored; the source gets the credit and the traffic (SPEC §6). */}
          Full recipe at {sourceHost(recipe.sourceUrl)} <ExternalLink className="size-3.5" />
        </a>
      )}

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Ingredients
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recipe.ingredients.length ? (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm" aria-label="Ingredients">
              {recipe.ingredients.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No ingredients saved, so this won&apos;t add to the grocery list.</p>
          )}
        </CardContent>
      </Card>

      {recipe.notes && (
        <section className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Notes</h2>
          <p className="whitespace-pre-line text-sm">{recipe.notes}</p>
        </section>
      )}

      {isAdult &&
        (recipe.archived ? (
          <ActionButton action={restoreRecipeAction} fields={{ id: recipe.id }} className="self-start">
            Restore to library
          </ActionButton>
        ) : (
          <ConfirmAction
            action={archiveRecipeAction}
            fields={{ id: recipe.id }}
            triggerLabel="Archive"
            title={`Archive ${recipe.title}?`}
            description="It disappears from the library and pickers. Dinners that already use it keep it, and you can restore it later."
            confirmLabel="Archive"
            destructive
          />
        ))}
    </>
  );
}

function sourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the source";
  }
}
