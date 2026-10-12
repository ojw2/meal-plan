import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/dal";
import { ForbiddenError } from "@/lib/errors";
import { exportHousehold } from "@/lib/services/export";
import { householdToday } from "@/lib/services/household";

/** "Export all data as JSON" (SPEC §4.10): downloads the household's data. Adults only. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in again.", { status: 401 });
  const db = getDb();
  try {
    const data = await exportHousehold(db, user);
    const today = await householdToday(db);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="meal-plan-${today}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response(e.message, { status: 403 });
    throw e;
  }
}
