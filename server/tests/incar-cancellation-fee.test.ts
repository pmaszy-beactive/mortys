import { describe, expect, it } from "vitest";
import { computeInvoiceTotals, DEFAULT_GST_RATE, DEFAULT_QST_RATE } from "../services/billing";
import {
  getIncarCancellationPolicy,
  isWithinIncarCancellationFeeWindow,
} from "../services/incar-cancellation-fee";

describe("canonical In-Car 12/13 cancellation policy", () => {
  it("charges at 23:59:59.999 but is free at exactly 24h and beyond", () => {
    const now = new Date("2026-01-15T12:00:00.000Z");
    expect(isWithinIncarCancellationFeeWindow(
      new Date(now.getTime() + 24 * 60 * 60 * 1000 - 1),
      now,
    )).toBe(true);
    expect(isWithinIncarCancellationFeeWindow(
      new Date(now.getTime() + 24 * 60 * 60 * 1000),
      now,
    )).toBe(false);
    expect(isWithinIncarCancellationFeeWindow(
      new Date(now.getTime() + 24 * 60 * 60 * 1000 + 1),
      now,
    )).toBe(false);
  });

  it("uses the school-local class instant across the DST transition", () => {
    const canonical = {
      classType: "driving",
      classNumber: 12,
      duration: 120,
      maxStudents: 2,
      courseType: "auto",
      date: "2026-03-08",
      time: "09:00",
    };
    // 09:00 America/Toronto is 13:00Z after the spring-forward transition.
    expect(getIncarCancellationPolicy(canonical, new Date("2026-03-07T13:00:00.000Z")).feeRequired).toBe(false);
    expect(getIncarCancellationPolicy(canonical, new Date("2026-03-07T13:00:00.001Z")).feeRequired).toBe(true);
  });

  it("taxes the $100 base using Quebec defaults", () => {
    const totals = computeInvoiceTotals([{
      description: "Late cancellation fee — In-Car 12/13",
      quantity: 1,
      unitAmount: "100.00",
      amount: "100.00",
      gstApplicable: true,
      qstApplicable: true,
    }], { gstRate: DEFAULT_GST_RATE, qstRate: DEFAULT_QST_RATE });
    expect(totals).toEqual({
      subtotal: "100.00",
      gst: "5.00",
      qst: "9.98",
      total: "114.98",
    });
  });
});