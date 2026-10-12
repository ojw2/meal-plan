import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";
import { ActionForm } from "@/components/action-form";
import { ConfirmAction } from "@/components/confirm-action";
import { SelectField, TextField } from "@/components/field";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db";
import { requireAdultPage } from "@/lib/auth/dal";
import { listMembers, type Member } from "@/lib/services/members";
import {
  addMemberAction,
  archiveMemberAction,
  changeRoleAction,
  resetCredentialAction,
  restoreMemberAction,
  updateMemberAction,
} from "../actions";

export const metadata: Metadata = { title: "Members" };

const SECRET_HINT = "Adults use a password (8+ characters). Kids use a 4–6 digit PIN.";

export default async function MembersPage() {
  const me = await requireAdultPage();
  const members = await listMembers(getDb());
  const active = members.filter((m) => !m.archivedAt);
  const archived = members.filter((m) => m.archivedAt);

  return (
    <>
      <div className="flex flex-col">
        <BackLink href="/settings">Settings</BackLink>
        <h1 className="text-3xl font-extrabold tracking-tight">Members</h1>
      </div>

      <ul className="flex flex-col gap-3" aria-label="Active members">
        {active.map((m) => (
          <li key={m.id}>
            <MemberCard member={m} isMe={m.id === me.id} />
          </li>
        ))}
      </ul>

      <Card>
        <CardHeader>
          <CardTitle>Add a member</CardTitle>
          <CardDescription>{SECRET_HINT}</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={addMemberAction} submitLabel="Add member" resetOnSuccess>
            <TextField label="Name" name="displayName" required />
            <TextField label="Username" name="username" required autoCapitalize="none" autoComplete="off" />
            <SelectField
              label="Role"
              name="role"
              defaultValue="kid"
              options={[
                { value: "kid", label: "Kid (view only)" },
                { value: "adult", label: "Adult (can plan and edit)" },
              ]}
            />
            <TextField label="Password or PIN" name="secret" type="password" required autoComplete="new-password" />
          </ActionForm>
        </CardContent>
      </Card>

      {archived.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">Removed members</h2>
          <ul className="flex flex-col gap-3" aria-label="Removed members">
            {archived.map((m) => (
              <li key={m.id}>
                <Card size="sm">
                  <CardContent className="flex items-center justify-between gap-2">
                    <span>
                      {m.displayName} <span className="text-muted-foreground">@{m.username}</span>
                    </span>
                    <ActionForm action={restoreMemberAction} submitLabel="Restore" submitVariant="outline">
                      <input type="hidden" name="id" value={m.id} />
                    </ActionForm>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function MemberCard({ member: m, isMe }: { member: Member; isMe: boolean }) {
  const otherRole = m.role === "adult" ? "kid" : "adult";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {m.displayName}
          <Badge variant={m.role === "adult" ? "default" : "secondary"}>
            {m.role === "adult" ? "Adult" : "Kid"}
          </Badge>
          {isMe && <Badge variant="outline">You</Badge>}
        </CardTitle>
        <CardDescription>@{m.username}</CardDescription>
      </CardHeader>
      <CardContent>
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium md:min-h-9">
            Edit
          </summary>
          <div className="mt-2 flex flex-col gap-6">
            <ActionForm action={updateMemberAction} submitLabel="Save profile" submitVariant="outline">
              <input type="hidden" name="id" value={m.id} />
              <TextField label="Name" name="displayName" id={`name-${m.id}`} required defaultValue={m.displayName} />
              <TextField
                label="Username"
                name="username"
                id={`username-${m.id}`}
                required
                autoCapitalize="none"
                defaultValue={m.username}
              />
            </ActionForm>

            <ActionForm
              action={resetCredentialAction}
              submitLabel={m.role === "adult" ? "Set new password" : "Set new PIN"}
              submitVariant="outline"
            >
              <input type="hidden" name="id" value={m.id} />
              <TextField
                label={m.role === "adult" ? "New password" : "New PIN"}
                name="secret"
                id={`secret-${m.id}`}
                type="password"
                inputMode={m.role === "kid" ? "numeric" : undefined}
                required
                autoComplete="new-password"
              />
            </ActionForm>

            <ActionForm
              action={changeRoleAction}
              submitLabel={`Make ${otherRole}`}
              submitVariant="outline"
            >
              <input type="hidden" name="id" value={m.id} />
              <input type="hidden" name="role" value={otherRole} />
              <TextField
                label={otherRole === "adult" ? "New password (adults sign in with a password)" : "New PIN (kids sign in with a PIN)"}
                name="secret"
                id={`role-secret-${m.id}`}
                type="password"
                required
                autoComplete="new-password"
              />
            </ActionForm>

            <ConfirmAction
              action={archiveMemberAction}
              fields={{ id: m.id }}
              triggerLabel="Remove member"
              title={`Remove ${m.displayName}?`}
              description="They'll be signed out and can't sign in. Past dinners keep their name; upcoming dishes they were cooking become unassigned. You can restore them later."
              confirmLabel="Remove"
              destructive
            />
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
