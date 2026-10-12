"use client";

import { Check, Clock, ExternalLink, ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { LibraryMatch, SuggestCursor, Suggestion } from "@/lib/services/suggest";

export type Choice =
  | { kind: "library"; match: LibraryMatch }
  | { kind: "spoonacular"; suggestion: Suggestion }
  | { kind: "skip" };

/** One row of the flow: the main or the side. */
export type Row = {
  key: string;
  role: "main" | "side";
  ingredient: string;
  /** Ingredients to cook it with; results lacking some are badged. */
  extras: string[];
  library: LibraryMatch[];
  results: Suggestion[];
  cursor: SuggestCursor | null;
  hasMore: boolean;
  loading: boolean;
  /** Spoonacular trouble, from the last response. */
  status: "ok" | "quota_exhausted" | "unavailable";
  message?: string;
  /** A request that failed outright (e.g. signed out). */
  error?: string;
  /** Set once a "Show 3 more" found nothing new. */
  noMore: boolean;
  choice: Choice | null;
};

export function choiceKey(c: Choice | null): string | null {
  if (!c || c.kind === "skip") return null;
  return c.kind === "library" ? `l:${c.match.recipeId}` : `s:${c.suggestion.spoonacularId}`;
}

export function SuggestionRow({
  row,
  maxTime,
  onChoose,
  onMore,
  onRetry,
}: {
  row: Row;
  maxTime: number;
  onChoose: (choice: Choice | null) => void;
  onMore: () => void;
  onRetry: () => void;
}) {
  const chosen = choiceKey(row.choice);
  const nothing =
    !row.loading && !row.error && row.status === "ok" && row.library.length === 0 && row.results.length === 0;
  const toggle = (c: Choice) => onChoose(choiceKey(c) === chosen ? null : c);

  return (
    <div className="flex flex-col gap-3">
      {row.library.length > 0 && (
        <section className="flex flex-col gap-2" aria-label={`From your recipes: ${row.ingredient}`}>
          <h3 className="text-sm font-medium">From your recipes</h3>
          {row.library.map((m) => (
            <OptionCard
              key={m.recipeId}
              title={m.title}
              imageUrl={m.imageUrl}
              sourceUrl={m.sourceUrl}
              chosen={chosen === `l:${m.recipeId}`}
              onToggle={() => toggle({ kind: "library", match: m })}
              meta={
                <>
                  {m.readyInMinutes && <Minutes value={m.readyInMinutes} />}
                  {m.isFavorite && <Badge variant="secondary">Favorite</Badge>}
                  <Without extras={m.missingExtras} />
                </>
              }
            />
          ))}
        </section>
      )}

      {row.status === "quota_exhausted" && (
        <p role="status" className="rounded-2xl bg-muted px-4 py-3 text-sm">
          Spoonacular&apos;s daily limit is used up, so only your own recipes are shown. You can still add a
          dish by hand.
        </p>
      )}
      {(row.status === "unavailable" || row.error) && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted px-4 py-3 text-sm">
          <span className="flex-1">{row.error ?? row.message ?? "Spoonacular isn't responding."}</span>
          <Button variant="outline" onClick={onRetry} disabled={row.loading}>
            Retry
          </Button>
        </div>
      )}

      {row.results.length > 0 && (
        <section className="flex flex-col gap-2" aria-label={`Suggestions: ${row.ingredient}`}>
          {row.library.length > 0 && <h3 className="text-sm font-medium">From Spoonacular</h3>}
          {row.results.map((s) => (
            <OptionCard
              key={s.spoonacularId}
              title={s.title}
              imageUrl={s.imageUrl}
              sourceUrl={s.sourceUrl}
              sourceName={s.sourceName}
              chosen={chosen === `s:${s.spoonacularId}`}
              onToggle={() => toggle({ kind: "spoonacular", suggestion: s })}
              meta={
                <>
                  {s.readyInMinutes != null && !s.overBudget && <Minutes value={s.readyInMinutes} />}
                  {s.readyInMinutes != null &&
                    (s.overBudget ? (
                      <Badge variant="destructive">
                        {s.readyInMinutes} min (over your {maxTime} min)
                      </Badge>
                    ) : (
                      <Badge variant="outline">Within {maxTime} min</Badge>
                    ))}
                  {s.similarTo && <Badge variant="secondary">Similar to ‘{s.similarTo}’</Badge>}
                  <Without extras={s.missingExtras} />
                  {s.libraryRecipeId && <Badge variant="secondary">In your library</Badge>}
                </>
              }
            />
          ))}
        </section>
      )}

      {row.loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Finding recipes…
        </p>
      )}
      {nothing && (
        <p className="text-sm">
          No matches for {row.ingredient}. Try a different {row.role === "main" ? "protein" : "ingredient"} or
          add it manually.
        </p>
      )}
      {row.noMore && !row.loading && <p className="text-sm text-muted-foreground">No more matches.</p>}

      <div className="flex flex-wrap gap-2">
        {row.hasMore && !row.noMore && (
          <Button variant="outline" onClick={onMore} disabled={row.loading}>
            Show 3 more
          </Button>
        )}
        <Button
          variant={row.choice?.kind === "skip" ? "secondary" : "ghost"}
          aria-pressed={row.choice?.kind === "skip"}
          onClick={() => onChoose(row.choice?.kind === "skip" ? null : { kind: "skip" })}
        >
          Skip the {row.role}
        </Button>
      </div>
    </div>
  );
}

/** "Without lemon, garlic": extras the recipe doesn't use. */
function Without({ extras }: { extras: string[] }) {
  if (!extras.length) return null;
  return <Badge variant="outline">Without {extras.join(", ")}</Badge>;
}

function Minutes({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Clock className="size-3" /> {value} min
    </span>
  );
}

function OptionCard({
  title,
  imageUrl,
  sourceUrl,
  sourceName,
  meta,
  chosen,
  onToggle,
}: {
  title: string;
  imageUrl: string | null;
  sourceUrl: string | null;
  sourceName?: string | null;
  meta: React.ReactNode;
  chosen: boolean;
  onToggle: () => void;
}) {
  return (
    <Card size="sm" className={chosen ? "ring-2 ring-primary" : undefined}>
      <CardContent className="flex items-center gap-3">
        {imageUrl ? (
          // Hotlinked recipe images (SPEC §6); next/image would need every host allow-listed.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <ImageOff className="size-5" />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-medium">{title}</span>
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {meta}
            {sourceUrl && (
              // Spoonacular's terms require crediting the original source.
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
              >
                {sourceName || "Recipe"} <ExternalLink className="size-3" />
              </a>
            )}
          </span>
        </div>
        <Button
          variant={chosen ? "default" : "outline"}
          aria-pressed={chosen}
          aria-label={`Choose ${title}`}
          onClick={onToggle}
        >
          {chosen ? <Check /> : "Choose"}
        </Button>
      </CardContent>
    </Card>
  );
}
