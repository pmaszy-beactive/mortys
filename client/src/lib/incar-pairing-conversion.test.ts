import { describe, expect, it } from "vitest";
import {
  NO_SHOW_CONVERSION_LESSONS,
  buildNoShowConversionRequest,
} from "./incar-pairing-conversion";

describe("no-show pairing conversion UI contract", () => {
  it("always represents the full Lesson 11 then Lesson 14 conversion", () => {
    expect(NO_SHOW_CONVERSION_LESSONS).toEqual([11, 14]);
  });

  it("submits only the attending enrollment, with no single-lesson target", () => {
    expect(buildNoShowConversionRequest(42, 91)).toEqual({
      url: "/api/lesson-pairing/sessions/42/convert",
      body: { presentEnrollmentId: 91 },
    });
  });
});