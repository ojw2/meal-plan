import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/field";
import { TimezoneSelect } from "@/components/timezone-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db";
import { needsSetup } from "@/lib/services/household";
import { setupAction } from "../actions";

export const metadata: Metadata = { title: "Set up" };

export default async function SetupPage() {
  await connection(); // reads the DB per request, never at build time
  if (!(await needsSetup(getDb()))) redirect("/login");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Set up your household</CardTitle>
        <CardDescription>
          You&apos;ll be the first adult. You can add everyone else afterwards.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={setupAction} submitLabel="Create household">
          <TextField label="Household name" name="householdName" required placeholder="The Smiths" />
          <TimezoneSelect />
          <TextField label="Your name" name="displayName" required autoComplete="name" />
          <TextField label="Username" name="username" required autoComplete="username" autoCapitalize="none" />
          <TextField
            label="Password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            hint="At least 8 characters."
          />
        </ActionForm>
      </CardContent>
    </Card>
  );
}
