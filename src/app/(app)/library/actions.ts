"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { formString, toFormState, type FormState } from "@/lib/form-state";
import { archiveRecipe, restoreRecipe, setFavorite } from "@/lib/services/library";

// Every action re-reads the session and lets the service enforce the adult role.

export async function setFavoriteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    await setFavorite(getDb(), actor, formString(formData, "id"), formString(formData, "favorite") === "true");
    revalidatePath("/", "layout");
  });
}

export async function archiveRecipeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    await archiveRecipe(getDb(), actor, formString(formData, "id"));
    revalidatePath("/", "layout");
  });
}

export async function restoreRecipeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    await restoreRecipe(getDb(), actor, formString(formData, "id"));
    revalidatePath("/", "layout");
  });
}
