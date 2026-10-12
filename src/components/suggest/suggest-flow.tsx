"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { addSuggestedDishesAction } from "@/app/(app)/day/actions";
import { ActionForm } from "@/components/action-form";
import { TextareaField, TextField } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SuggestResponse } from "@/lib/services/suggest";
import { SuggestionRow, type Choice, type Row } from "./suggestion-row";

const PROTEINS = [
  "chicken",
  "chicken breast",
  "chicken thighs",
  "ground beef",
  "steak",
  "beef",
  "pork",
  "pork chops",
  "sausage",
  "bacon",
  "ham",
  "turkey",
  "ground turkey",
  "salmon",
  "cod",
  "tilapia",
  "tuna",
  "shrimp",
  "tofu",
  "tempeh",
  "eggs",
  "lentils",
  "chickpeas",
  "black beans",
  "lamb",
];
const TIME_PRESETS = [15, 30, 45, 60];
const MAX_SIDES = 3;

type Stage = "inputs" | "main" | "sides" | "confirm";
type Quota = SuggestResponse["quota"];

const newRow = (key: string, role: Row["role"], ingredient: string): Row => ({
  key,
  role,
  ingredient,
  library: [],
  results: [],
  cursor: null,
  hasMore: false,
  loading: false,
  status: "ok",
  noMore: false,
  choice: null,
});

/** The suggest flow (SPEC §4.3): inputs, pick a main, pick sides, confirm. */
export function SuggestFlow({ date, initialQuota }: { date: string; initialQuota: Quota }) {
  const [stage, setStage] = useState<Stage>("inputs");
  const [protein, setProtein] = useState("");
  const [preset, setPreset] = useState<number | "custom">(30);
  const [customTime, setCustomTime] = useState("");
  const [sideDraft, setSideDraft] = useState("");
  const [sides, setSides] = useState<string[]>([]);
  const [inputError, setInputError] = useState<string>();
  const [rows, setRows] = useState<Row[]>([]);
  const [quota, setQuota] = useState(initialQuota);

  const maxTime = preset === "custom" ? Number(customTime) : preset;
  const patch = (key: string, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  async function load(row: Row, more: boolean) {
    patch(row.key, { loading: true, error: undefined });
    try {
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: row.role,
          ingredient: row.ingredient,
          maxTime,
          cursor: more ? row.cursor : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        patch(row.key, { loading: false, error: data.error ?? "Something went wrong." });
        return;
      }
      const page = data as SuggestResponse;
      setQuota(page.quota);
      setRows((rs) =>
        rs.map((r) =>
          r.key !== row.key
            ? r
            : {
                ...r,
                loading: false,
                library: more ? r.library : page.library,
                results: more ? [...r.results, ...page.results] : page.results,
                cursor: page.cursor,
                hasMore: page.hasMore,
                status: page.status,
                message: page.message,
                noMore: more && page.status === "ok" && page.results.length === 0,
              },
        ),
      );
    } catch {
      patch(row.key, { loading: false, error: "Couldn't reach the server. Check your connection." });
    }
  }

  /** Retry continues from the last good position, keeping what's shown. */
  const retry = (row: Row) => load(row, row.cursor !== null);

  function addSide() {
    const s = sideDraft.trim();
    if (!s || sides.length >= MAX_SIDES || sides.some((x) => x.toLowerCase() === s.toLowerCase())) return;
    setSides([...sides, s]);
    setSideDraft("");
  }

  function startSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!protein.trim()) return setInputError("Enter a protein.");
    if (!Number.isInteger(maxTime) || maxTime < 5 || maxTime > 600) {
      return setInputError("Pick a time budget between 5 and 600 minutes.");
    }
    setInputError(undefined);
    const pending = sideDraft.trim();
    const allSides = pending && sides.length < MAX_SIDES ? [...sides, pending] : sides;
    setSides(allSides);
    setSideDraft("");
    const main = newRow("main", "main", protein.trim());
    setRows([main, ...allSides.map((s, i) => newRow(`side-${i}`, "side", s))]);
    setStage("main");
    load(main, false);
  }

  function goToSides() {
    setStage("sides");
    // Side searches start only once they're needed, to save API points.
    for (const r of rows) if (r.role === "side" && !r.cursor && !r.loading) load(r, false);
  }

  const mainRow = rows.find((r) => r.role === "main");
  const sideRows = rows.filter((r) => r.role === "side");
  const picks = rows.flatMap((r) =>
    r.choice && r.choice.kind !== "skip" ? [{ role: r.role, choice: r.choice }] : [],
  );

  return (
    <div className="flex flex-col gap-4">
      {quota.low && quota.left !== null && quota.left > 0 && (
        <p role="status" className="rounded-2xl bg-muted px-4 py-3 text-sm">
          Only {Math.floor(quota.left)} Spoonacular points left today. Each search uses about one.
        </p>
      )}

      {stage === "inputs" && (
        <Card>
          <CardHeader>
            <CardTitle>What are you cooking with?</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={startSearch} className="flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="protein">Protein</Label>
                <Input
                  id="protein"
                  list="proteins"
                  value={protein}
                  onChange={(e) => setProtein(e.target.value)}
                  autoComplete="off"
                  maxLength={60}
                  required
                />
                <datalist id="proteins">
                  {PROTEINS.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>

              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-sm font-medium">Max cook time</legend>
                <div className="flex flex-wrap gap-2">
                  {[...TIME_PRESETS, "custom" as const].map((p) => (
                    <Button
                      key={p}
                      type="button"
                      variant={preset === p ? "default" : "outline"}
                      aria-pressed={preset === p}
                      onClick={() => setPreset(p)}
                    >
                      {p === "custom" ? "Custom" : `${p} min`}
                    </Button>
                  ))}
                </div>
                {preset === "custom" && (
                  <TextField
                    label="Minutes"
                    name="customTime"
                    type="number"
                    inputMode="numeric"
                    min={5}
                    max={600}
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                  />
                )}
              </fieldset>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="side">Side ingredients (up to {MAX_SIDES}, optional)</Label>
                {sides.length > 0 && (
                  <ul className="flex flex-wrap gap-2" aria-label="Side ingredients">
                    {sides.map((s) => (
                      <li key={s} className="flex items-center gap-1 rounded-full bg-secondary py-1 pl-3 text-sm">
                        {s}
                        <Button
                          type="button"
                          variant="ghost"
                          className="size-11 rounded-full md:size-8"
                          aria-label={`Remove ${s}`}
                          onClick={() => setSides(sides.filter((x) => x !== s))}
                        >
                          <X />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {sides.length < MAX_SIDES && (
                  <div className="flex gap-2">
                    <Input
                      id="side"
                      value={sideDraft}
                      placeholder="e.g. broccoli"
                      maxLength={60}
                      autoComplete="off"
                      onChange={(e) => setSideDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addSide();
                        }
                      }}
                    />
                    <Button type="button" variant="outline" onClick={addSide}>
                      Add
                    </Button>
                  </div>
                )}
              </div>

              {inputError && (
                <p role="alert" className="text-sm text-destructive">
                  {inputError}
                </p>
              )}
              <Button type="submit" className="self-start">
                Find mains
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {stage !== "inputs" && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            {protein.trim()} · {maxTime} min{sides.length > 0 && ` · ${sides.join(", ")}`}
          </span>
          <Button variant="ghost" onClick={() => setStage("inputs")}>
            Change search
          </Button>
        </div>
      )}

      {stage === "main" && mainRow && (
        <>
          <h2 className="text-lg font-semibold">Pick a main</h2>
          <SuggestionRow
            row={mainRow}
            maxTime={maxTime}
            onChoose={(choice) => patch(mainRow.key, { choice })}
            onMore={() => load(mainRow, true)}
            onRetry={() => retry(mainRow)}
          />
          <StageNav
            onBack={() => setStage("inputs")}
            next={sideRows.length ? "Next: sides" : "Review"}
            disabled={!mainRow.choice}
            onNext={() => (sideRows.length ? goToSides() : setStage("confirm"))}
          />
        </>
      )}

      {stage === "sides" && (
        <>
          <h2 className="text-lg font-semibold">Pick sides</h2>
          {sideRows.map((row) => (
            <section key={row.key} className="flex flex-col gap-2" aria-labelledby={`${row.key}-title`}>
              <h3 id={`${row.key}-title`} className="font-medium capitalize">
                {row.ingredient}
              </h3>
              <SuggestionRow
                row={row}
                maxTime={maxTime}
                onChoose={(choice) => patch(row.key, { choice })}
                onMore={() => load(row, true)}
                onRetry={() => retry(row)}
              />
            </section>
          ))}
          <StageNav
            onBack={() => setStage("main")}
            next="Review"
            disabled={sideRows.some((r) => !r.choice)}
            onNext={() => setStage("confirm")}
          />
        </>
      )}

      {stage === "confirm" && (
        <Confirm date={date} picks={picks} onBack={() => setStage(sideRows.length ? "sides" : "main")} />
      )}
    </div>
  );
}

function StageNav({
  onBack,
  next,
  disabled,
  onNext,
}: {
  onBack: () => void;
  next: string;
  disabled: boolean;
  onNext: () => void;
}) {
  return (
    <div className="flex gap-2">
      <Button variant="outline" onClick={onBack}>
        Back
      </Button>
      <Button onClick={onNext} disabled={disabled}>
        {next}
      </Button>
    </div>
  );
}

type PickedDish = { role: Row["role"]; choice: Exclude<Choice, { kind: "skip" }> };

/**
 * Review before saving. Spoonacular's terms don't allow keeping its recipe
 * details, so each new Spoonacular pick shows them prefilled for the adult to
 * confirm or edit. What's saved is the household's own copy (SPEC §9).
 */
function Confirm({ date, picks, onBack }: { date: string; picks: PickedDish[]; onBack: () => void }) {
  if (picks.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p>You skipped everything, so there&apos;s nothing to add.</p>
        <Button variant="outline" className="self-start" onClick={onBack}>
          Back
        </Button>
      </div>
    );
  }
  const payload = picks.map(({ role, choice }) => {
    if (choice.kind === "library") return { kind: "library", recipeId: choice.match.recipeId, role };
    const s = choice.suggestion;
    if (s.libraryRecipeId) return { kind: "library", recipeId: s.libraryRecipeId, role };
    return { kind: "spoonacular", role, spoonacularId: s.spoonacularId, title: s.title, imageUrl: s.imageUrl };
  });

  return (
    <>
      <h2 className="text-lg font-semibold">Review</h2>
      <ActionForm action={addSuggestedDishesAction} submitLabel="Add to dinner">
        <input type="hidden" name="date" value={date} />
        <input type="hidden" name="picks" value={JSON.stringify(payload)} />
        {picks.map(({ role, choice }, i) => {
          const s = choice.kind === "spoonacular" && !choice.suggestion.libraryRecipeId ? choice.suggestion : null;
          const title = choice.kind === "library" ? choice.match.title : choice.suggestion.title;
          return (
            <Card key={i} size="sm">
              <CardHeader>
                <CardTitle role="heading" aria-level={3}>
                  {title}
                </CardTitle>
                <CardDescription>
                  {role === "main" ? "Main" : "Side"} ·{" "}
                  {s ? "New to your library. Check the details you want to keep." : "From your library"}
                </CardDescription>
              </CardHeader>
              {s && (
                <CardContent className="flex flex-col gap-4">
                  <TextareaField
                    label="Ingredients"
                    id={`ingredients-${i}`}
                    name={`ingredients-${i}`}
                    rows={Math.min(10, Math.max(3, s.ingredients.length))}
                    defaultValue={s.ingredients.join("\n")}
                    hint="One per line. They feed the grocery list."
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <TextField
                      label="Servings"
                      id={`servings-${i}`}
                      name={`servings-${i}`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      defaultValue={s.servings ?? ""}
                    />
                    <TextField
                      label="Ready in (minutes)"
                      id={`readyInMinutes-${i}`}
                      name={`readyInMinutes-${i}`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      defaultValue={s.readyInMinutes ?? ""}
                    />
                  </div>
                  <TextField
                    label="Recipe link"
                    id={`sourceUrl-${i}`}
                    name={`sourceUrl-${i}`}
                    type="url"
                    inputMode="url"
                    defaultValue={s.sourceUrl ?? ""}
                  />
                </CardContent>
              )}
            </Card>
          );
        })}
      </ActionForm>
      <Button variant="outline" className="self-start" onClick={onBack}>
        Back
      </Button>
    </>
  );
}
