import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { getHousehold } from "@/lib/services/household";

// Placeholder home; the tonight-first planner arrives in Milestone 2.
export default async function HomePage() {
  const user = await requireUser();
  const household = await getHousehold(getDb());
  const today = new Intl.DateTimeFormat("en-US", {
    timeZone: household?.timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  return (
    <>
      <div>
        <p className="text-sm text-muted-foreground">{today}</p>
        <h1 className="text-2xl font-semibold">Hi, {user.displayName}</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Tonight</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">
          Nothing planned yet. Meal planning is coming soon.
        </CardContent>
      </Card>
    </>
  );
}
