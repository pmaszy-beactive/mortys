import { describe, expect, it } from "vitest";
import {
  describePairedFinalizations,
  getPairedFinalizations,
} from "./paired-finalizations";

describe("paired finalization response parsing", () => {
  it("accepts the singular structured result returned by an admin correction", () => {
    const response = {
      duplicate: false,
      pairedFinalization: {
        pairedSessionId: 42,
        status: "converted",
        message: "Paired attendance was corrected.",
      },
    };

    expect(getPairedFinalizations(response)).toEqual([response.pairedFinalization]);
    expect(describePairedFinalizations(response)).toBe("Paired attendance was corrected.");
  });

  it("describes an idempotent duplicate without inventing another conversion", () => {
    expect(describePairedFinalizations({
      duplicate: true,
      pairedFinalization: {
        pairedSessionId: 42,
        status: "unchanged",
        message: "Paired attendance was already corrected; no duplicate 11/14 credits were created.",
      },
    })).toContain("no duplicate 11/14 credits");
  });
});