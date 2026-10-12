import { describe, expect, it } from "vitest";
import {
  addDays,
  formatDate,
  isIsoDate,
  isPastWeek,
  isValidTimezone,
  localDate,
  weekDates,
  weekdayOf,
  weekStartOf,
} from "./time";

describe("localDate", () => {
  it("uses the household timezone, not UTC", () => {
    // 02:30 UTC on the 13th is still the evening of the 12th in New York.
    const instant = new Date("2026-10-13T02:30:00Z");
    expect(localDate("America/New_York", instant)).toBe("2026-10-12");
    expect(localDate("UTC", instant)).toBe("2026-10-13");
    expect(localDate("Asia/Tokyo", new Date("2026-10-12T16:00:00Z"))).toBe("2026-10-13");
  });

  it("handles DST transitions", () => {
    // US DST ends 2026-11-01 at 02:00 local.
    expect(localDate("America/New_York", new Date("2026-11-01T05:30:00Z"))).toBe("2026-11-01");
    expect(localDate("America/New_York", new Date("2026-11-02T04:59:00Z"))).toBe("2026-11-01");
  });
});

describe("isValidTimezone", () => {
  it("accepts IANA zones and rejects junk", () => {
    expect(isValidTimezone("Europe/London")).toBe(true);
    expect(isValidTimezone("Mars/Olympus_Mons")).toBe(false);
  });
});

describe("calendar dates", () => {
  it("validates real YYYY-MM-DD dates only", () => {
    expect(isIsoDate("2026-10-12")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-1-5")).toBe(false);
    expect(isIsoDate("../etc")).toBe(false);
  });

  it("adds days across month, year and DST boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02"); // US DST ends
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("finds the week start for any start day", () => {
    expect(weekdayOf("2026-10-12")).toBe(1); // Monday
    expect(weekStartOf("2026-10-12", 0)).toBe("2026-10-11");
    expect(weekStartOf("2026-10-12", 1)).toBe("2026-10-12");
    expect(weekStartOf("2026-10-12", 2)).toBe("2026-10-06");
    expect(weekStartOf("2026-10-17", 6)).toBe("2026-10-17");
    expect(weekDates("2026-10-11")).toEqual([
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
    ]);
  });

  it("treats a week as past only once its last day is before today", () => {
    expect(isPastWeek("2026-10-04", "2026-10-11")).toBe(true);
    expect(isPastWeek("2026-10-04", "2026-10-10")).toBe(false); // last day is today
    expect(isPastWeek("2026-10-11", "2026-10-12")).toBe(false);
  });

  it("formats without shifting the day", () => {
    expect(formatDate("2026-10-12", { weekday: "long", month: "short", day: "numeric" })).toBe(
      "Monday, Oct 12",
    );
  });
});
