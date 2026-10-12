import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, ServiceError } from "@/lib/errors";
import {
  getCookSchedule,
  getHousehold,
  needsSetup,
  setCookSchedule,
  setupHousehold,
  updateHouseholdSettings,
} from "@/lib/services/household";
import { cookOf, db, resetDb, seedDinner, seedHousehold, seedUser } from "./helpers/db";

// Monday 2026-10-12, noon in New York.
const NOW = new Date("2026-10-12T16:00:00Z");

beforeEach(resetDb);

const setupInput = {
  householdName: "Home",
  timezone: "America/Chicago",
  displayName: "Alex",
  username: "alex",
  password: "password123",
};

describe("setupHousehold", () => {
  it("creates the household and first adult exactly once", async () => {
    expect(await needsSetup(db())).toBe(true);
    await setupHousehold(db(), setupInput);
    expect(await needsSetup(db())).toBe(false);
    expect(await getHousehold(db())).toMatchObject({ name: "Home", timezone: "America/Chicago" });
    await expect(setupHousehold(db(), { ...setupInput, username: "bob" })).rejects.toThrow(ServiceError);
  });

  it("lets only one of two concurrent setups win", async () => {
    const results = await Promise.allSettled([
      setupHousehold(db(), setupInput),
      setupHousehold(db(), { ...setupInput, username: "bob" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("updateHouseholdSettings", () => {
  beforeEach(() => seedHousehold());

  it("lets adults change settings", async () => {
    const adult = await seedUser({ username: "alex" });
    await updateHouseholdSettings(db(), adult, {
      name: "New",
      timezone: "Europe/London",
      weekStartDay: 1,
      defaultServings: 6,
    });
    expect(await getHousehold(db())).toMatchObject({ name: "New", weekStartDay: 1, defaultServings: 6 });
  });

  it("forbids kids", async () => {
    const kid = await seedUser({ username: "sam", role: "kid" });
    await expect(
      updateHouseholdSettings(db(), kid, { name: "x", timezone: "UTC", weekStartDay: 0, defaultServings: 4 }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("setCookSchedule", () => {
  beforeEach(() => seedHousehold("America/New_York"));

  it("saves the schedule and clears days set to null", async () => {
    const alex = await seedUser({ username: "alex" });
    await setCookSchedule(db(), alex, { 1: alex.id, 3: alex.id }, NOW);
    expect(await getCookSchedule(db())).toEqual({ 1: alex.id, 3: alex.id });
    await setCookSchedule(db(), alex, { 3: null }, NOW);
    expect(await getCookSchedule(db())).toEqual({ 1: alex.id });
  });

  it("updates today/future planned nights on that weekday unless the cook was set by hand", async () => {
    const alex = await seedUser({ username: "alex" });
    const bo = await seedUser({ username: "bo" });
    const pastMonday = await seedDinner("2026-10-05", alex.id);
    const todayMonday = await seedDinner("2026-10-12", alex.id);
    const futureMonday = await seedDinner("2026-10-19", alex.id);
    const futureMondayManual = await seedDinner("2026-10-26", alex.id, { cookManuallySet: true });
    const futureWednesday = await seedDinner("2026-10-14", alex.id);

    await setCookSchedule(db(), alex, { 1: bo.id }, NOW);

    expect(await cookOf(pastMonday)).toBe(alex.id);
    expect(await cookOf(todayMonday)).toBe(bo.id);
    expect(await cookOf(futureMonday)).toBe(bo.id);
    expect(await cookOf(futureMondayManual)).toBe(alex.id);
    expect(await cookOf(futureWednesday)).toBe(alex.id);
  });

  it("only accepts active adults as cooks, and only adults may edit", async () => {
    const alex = await seedUser({ username: "alex" });
    const kid = await seedUser({ username: "sam", role: "kid" });
    await expect(setCookSchedule(db(), alex, { 2: kid.id }, NOW)).rejects.toThrow(ServiceError);
    await expect(setCookSchedule(db(), kid, { 2: alex.id }, NOW)).rejects.toThrow(ForbiddenError);
    await expect(setCookSchedule(db(), alex, { 9: alex.id }, NOW)).rejects.toThrow(ServiceError);
  });
});
