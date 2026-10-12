"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { formString, toFormState, type FormState } from "@/lib/form-state";
import {
  addManualDish,
  moveDish,
  removeDish,
  resetDinnerCook,
  setDinnerStatus,
  unlockWeek,
  updateDinnerDetails,
} from "@/lib/services/planner";

// Every action re-reads the session and lets the service enforce the adult
// role and the past-week lock. Home, week and day views all show dinners, so
// each change refreshes the whole app layout.

function refresh() {
  revalidatePath("/", "layout");
}

export async function addManualDishAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    await addManualDish(getDb(), actor, formString(formData, "date"), {
      name: formString(formData, "name"),
      role: formString(formData, "role") as "main" | "side",
      ingredients: formString(formData, "ingredients"),
      sourceUrl: formString(formData, "sourceUrl"),
      readyInMinutes: formString(formData, "readyInMinutes"),
      notes: formString(formData, "notes"),
      saveToLibrary: formData.get("saveToLibrary") === "on",
    });
    refresh();
    return "Dish added.";
  });
}

export async function removeDishAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    await removeDish(getDb(), actor, formString(formData, "dishId"));
    refresh();
  });
}

export async function moveDishAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    const direction = formString(formData, "direction") === "up" ? "up" : "down";
    await moveDish(getDb(), actor, formString(formData, "dishId"), direction);
    refresh();
  });
}

export async function setDinnerStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    const status = formString(formData, "status") as "eat_out" | "leftovers" | "unplanned";
    await setDinnerStatus(getDb(), actor, formString(formData, "date"), status);
    refresh();
  });
}

export async function saveDinnerDetailsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    const servings = formString(formData, "servingsOverride").trim();
    await updateDinnerDetails(getDb(), actor, formString(formData, "date"), {
      cookUserId: formString(formData, "cookUserId") || null,
      servingsOverride: servings === "" ? null : Number(servings),
    });
    refresh();
    return "Saved.";
  });
}

export async function resetDinnerCookAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    await resetDinnerCook(getDb(), actor, formString(formData, "date"));
    refresh();
  });
}

export async function unlockWeekAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    await unlockWeek(getDb(), actor, formString(formData, "date"));
    refresh();
  });
}
