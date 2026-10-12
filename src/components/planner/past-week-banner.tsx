import { unlockWeekAction } from "@/app/(app)/day/actions";
import { ConfirmAction } from "@/components/confirm-action";

/** Read-only notice for past weeks, with Unlock for adults (SPEC §4.9). */
export function PastWeekBanner({ date, unlocked, isAdult }: { date: string; unlocked: boolean; isAdult: boolean }) {
  if (unlocked) {
    return (
      <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm">
        This past week is unlocked for editing until you sign out.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p>This week is in the past, so it&apos;s read-only.</p>
      {isAdult && (
        <ConfirmAction
          action={unlockWeekAction}
          fields={{ date }}
          triggerLabel="Unlock week"
          title="Unlock this past week?"
          description="You'll be able to edit it until you sign out. The unlock is logged."
          confirmLabel="Unlock"
        />
      )}
    </div>
  );
}
