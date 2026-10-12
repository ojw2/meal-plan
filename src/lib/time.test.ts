import { describe, expect, it } from "vitest";
import { isValidTimezone, localDate } from "./time";

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
