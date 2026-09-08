import { describe, expect, it } from "vitest";
import {
  AUTO_COURSE_PRICING,
  addClampedMonths,
  buildAutoInstallments,
} from "@shared/autoCoursePayment";

describe("automobile course payment plans", () => {
  it("uses the quoted exact course, books, and total cents", () => {
    expect(AUTO_COURSE_PRICING).toEqual({
      courseBaseCents: 113000,
      courseInclusiveCents: 129922,
      booksBaseCents: 8000,
      booksInclusiveCents: 9200,
      totalCents: 139122,
    });
  });

  it.each([
    ["full", 1, 139122],
    ["three", 3, 46374],
    ["six", 6, 23187],
  ] as const)("builds the %s plan", (plan, count, amountCents) => {
    const installments = buildAutoInstallments(plan, "2026-01-15");
    expect(installments).toHaveLength(count);
    expect(installments.every((item) => item.amountCents === amountCents)).toBe(true);
    expect(installments.reduce((sum, item) => sum + item.amountCents, 0)).toBe(139122);
    expect(installments[0].dueDate).toBe("2026-01-15");
  });

  it("clamps month ends and crosses years without date rollover", () => {
    expect(addClampedMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addClampedMonths("2025-01-31", 1)).toBe("2025-02-28");
    expect(addClampedMonths("2025-12-31", 1)).toBe("2026-01-31");
    expect(buildAutoInstallments("six", "2025-10-31").map((item) => item.dueDate)).toEqual([
      "2025-10-31",
      "2025-11-30",
      "2025-12-31",
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
  });
});