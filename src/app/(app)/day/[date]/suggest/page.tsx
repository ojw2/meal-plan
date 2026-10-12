import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { SuggestFlow } from "@/components/suggest/suggest-flow";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { plannerCalendar, weekAccess } from "@/lib/services/planner";
import { getQuota, isQuotaLow } from "@/lib/spoonacular/client";
import { formatDate, isIsoDate, weekStartOf } from "@/lib/time";

export const metadata: Metadata = { title: "Suggest a dinner" };

export default async function SuggestPage({ params }: PageProps<"/day/[date]/suggest">) {
  const { date } = await params;
  if (!isIsoDate(date)) notFound();
  const user = await requireUser();
  const db = getDb();
  const cal = await plannerCalendar(db);
  const access = await weekAccess(db, user, weekStartOf(date, cal.weekStartDay), cal.today);
  // Kids and locked past weeks get the read-only day view instead.
  if (!access.editable) redirect(`/day/${date}`);
  const quota = await getQuota(db);

  return (
    <>
      <div className="flex flex-col gap-1">
        <BackLink href={`/day/${date}`}>{formatDate(date, { weekday: "long", month: "short", day: "numeric" })}</BackLink>
        <h1 className="text-3xl font-extrabold tracking-tight">Suggest a dinner</h1>
      </div>
      <SuggestFlow date={date} initialQuota={{ left: quota?.left ?? null, low: isQuotaLow(quota) }} />
    </>
  );
}
