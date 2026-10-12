import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/dal";
import { needsSetup } from "@/lib/services/household";
import { loginAction } from "../actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  await connection(); // reads the DB per request, never at build time
  if (await needsSetup(getDb())) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
      </CardHeader>
      <CardContent>
        <ActionForm action={loginAction} submitLabel="Sign in">
          <TextField label="Username" name="username" required autoComplete="username" autoCapitalize="none" />
          <TextField
            label="Password or PIN"
            name="secret"
            type="password"
            required
            autoComplete="current-password"
          />
        </ActionForm>
      </CardContent>
    </Card>
  );
}
