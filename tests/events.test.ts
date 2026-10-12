import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { subscribe, type AppEvent } from "@/lib/events";
import { setCookSchedule, updateHouseholdSettings } from "@/lib/services/household";
import {
  archiveMember,
  changeRole,
  createMember,
  restoreMember,
  updateMemberProfile,
} from "@/lib/services/members";
import { db, resetDb, seedHousehold, seedUser } from "./helpers/db";

// Household-wide mutations publish `household.updated` (SPEC §5), so every
// open screen refetches: a renamed member shows up as the cook everywhere.
const NOW = new Date("2026-10-12T16:00:00Z");

let events: AppEvent[] = [];
let unsubscribe = () => {};

beforeEach(async () => {
  await resetDb();
  await seedHousehold();
  events = [];
  unsubscribe = subscribe((e) => events.push(e));
});
afterEach(() => unsubscribe());

const householdEvents = () => events.filter((e) => e.type === "household.updated");

describe("household.updated", () => {
  it("is published for settings and cook schedule changes", async () => {
    const alex = await seedUser({ username: "alex" });
    await updateHouseholdSettings(
      db(),
      alex,
      { name: "Home", timezone: "America/New_York", weekStartDay: 0, defaultServings: 4 },
      NOW,
    );
    expect(householdEvents()).toHaveLength(1);
    await setCookSchedule(db(), alex, { 2: alex.id }, NOW);
    expect(householdEvents()).toHaveLength(2);
  });

  it("is published for every member change", async () => {
    const alex = await seedUser({ username: "alex" });
    const id = await createMember(db(), alex, { displayName: "Sam", username: "sam", role: "kid", secret: "1234" });
    await updateMemberProfile(db(), alex, id, { displayName: "Sammy", username: "sam" });
    await changeRole(db(), alex, id, "adult", "password123", NOW);
    await archiveMember(db(), alex, id, NOW);
    await restoreMember(db(), alex, id);
    expect(householdEvents()).toHaveLength(5);
  });

  it("isn't published when a kid's attempt is refused", async () => {
    const kid = await seedUser({ username: "sam", role: "kid" });
    await expect(setCookSchedule(db(), kid, {}, NOW)).rejects.toThrow();
    expect(events).toEqual([]);
  });
});
