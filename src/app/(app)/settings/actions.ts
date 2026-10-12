"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { formString, toFormState, type FormState } from "@/lib/form-state";
import {
  householdSettingsSchema,
  setCookSchedule,
  updateHouseholdSettings,
} from "@/lib/services/household";
import {
  archiveMember,
  changeRole,
  createMember,
  resetCredential,
  restoreMember,
  updateMemberProfile,
  type Role,
} from "@/lib/services/members";

// Every action re-reads the session and lets the service enforce the adult role.

function parseRole(v: string): Role {
  return v === "kid" ? "kid" : "adult";
}

export async function saveHouseholdAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    const input = householdSettingsSchema.parse({
      name: formString(formData, "name"),
      timezone: formString(formData, "timezone"),
      weekStartDay: formString(formData, "weekStartDay"),
      defaultServings: formString(formData, "defaultServings"),
    });
    await updateHouseholdSettings(getDb(), actor, input);
    revalidatePath("/", "layout");
    return "Saved.";
  });
}

export async function saveCookScheduleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    const schedule: Record<number, string | null> = {};
    for (let d = 0; d < 7; d++) schedule[d] = formString(formData, `day-${d}`) || null;
    await setCookSchedule(getDb(), actor, schedule);
    revalidatePath("/", "layout");
    return "Saved.";
  });
}

export async function addMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    await createMember(getDb(), actor, {
      displayName: formString(formData, "displayName"),
      username: formString(formData, "username"),
      role: parseRole(formString(formData, "role")),
      secret: formString(formData, "secret"),
    });
    revalidatePath("/settings/members");
    return "Member added.";
  });
}

export async function updateMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    await updateMemberProfile(getDb(), actor, formString(formData, "id"), {
      displayName: formString(formData, "displayName"),
      username: formString(formData, "username"),
    });
    revalidatePath("/", "layout");
    return "Saved.";
  });
}

export async function resetCredentialAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    await resetCredential(getDb(), actor, formString(formData, "id"), formString(formData, "secret"));
    return "Updated.";
  });
}

export async function changeRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    await changeRole(
      getDb(),
      actor,
      formString(formData, "id"),
      parseRole(formString(formData, "role")),
      formString(formData, "secret"),
    );
    revalidatePath("/", "layout");
    return "Role changed.";
  });
}

export async function archiveMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    await archiveMember(getDb(), actor, formString(formData, "id"));
    revalidatePath("/", "layout");
    return "Member removed.";
  });
}

export async function restoreMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser();
  return toFormState(async () => {
    await restoreMember(getDb(), actor, formString(formData, "id"));
    revalidatePath("/", "layout");
    return "Member restored.";
  });
}
