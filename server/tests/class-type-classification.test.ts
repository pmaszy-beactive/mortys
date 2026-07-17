import { describe, it, expect } from "vitest";
import { isTheoryClass } from "@shared/bookingRules";

describe("isTheoryClass", () => {
  it("uses classType when present", () => {
    expect(isTheoryClass("theory", 7)).toBe(true);
    expect(isTheoryClass("driving", 2)).toBe(false);
    expect(isTheoryClass("driving", 5)).toBe(false);
  });

  it("classifies In-Car #1-#4 (driving, low class numbers) as driving", () => {
    for (const n of [1, 2, 3, 4]) {
      expect(isTheoryClass("driving", n)).toBe(false);
    }
  });

  it("falls back to class number when classType is missing", () => {
    expect(isTheoryClass(null, 3)).toBe(true);
    expect(isTheoryClass(undefined, 5)).toBe(true);
    expect(isTheoryClass(null, 6)).toBe(false);
  });

  it("ignores unknown classType values and uses the fallback", () => {
    expect(isTheoryClass("something-else", 2)).toBe(true);
    expect(isTheoryClass("something-else", 8)).toBe(false);
  });

  it("returns false when both classType and classNumber are missing", () => {
    expect(isTheoryClass(null, null)).toBe(false);
    expect(isTheoryClass(undefined, undefined)).toBe(false);
  });
});
