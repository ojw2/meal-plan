"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { formString, toFormState, type FormState } from "@/lib/form-state";
import {
  addManualItem,
  deleteManualItem,
  setItemChecked,
  setManualItemChecked,
} from "@/lib/services/grocery";

// Every action re-reads the session and lets the service enforce the adult
// role and the past-week lock.

function refresh() {
  revalidatePath("/grocery");
}

export async function setItemCheckedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    await setItemChecked(
      getDb(),
      actor,
      formString(formData, "weekStart"),
      formString(formData, "key"),
      formString(formData, "checked") === "true",
    );
    refresh();
  });
}

export async function addManualItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    await addManualItem(getDb(), actor, formString(formData, "weekStart"), formString(formData, "text"));
    refresh();
    return "Added.";
  });
}

export async function setManualItemCheckedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    await setManualItemChecked(getDb(), actor, formString(formData, "id"), formString(formData, "checked") === "true");
    refresh();
  });
}

export async function deleteManualItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    await deleteManualItem(getDb(), actor, formString(formData, "id"));
    refresh();
  });
}
