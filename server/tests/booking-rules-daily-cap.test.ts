import { describe, it, expect } from "vitest";
import {
  validateClassBooking,
  MAX_MINUTES_PER_DAY,
  type TargetClassInfo,
  type CompletedClassRecord,
} from "@shared/bookingRules";

/**
 * Regression tests for the auto-course "no more than 3 hours of classes per
 * day when an in-car session is involved" rule (checkMaxHoursPerDay), which
 * runs inside validateClassBooking for every entry point (student booking,
 * reschedule, available-classes flags, admin enrollment).
 */

const NONE: CompletedClassRecord[] = [];

function theoryTarget(extra: Partial<TargetClassInfo> = {}): TargetClassInfo {
  return {
    classType: "theory",
    classNumber: 1,
    date: "2026-08-12",
    duration: 120,
    ...extra,
  };
}

describe("auto 3-hour daily cap (checkMaxHoursPerDay via validateClassBooking)", () => {
  it("exports the documented 180-minute cap", () => {
    expect(MAX_MINUTES_PER_DAY).toBe(180);
  });

  it("rejects a theory class on a day that already has a 2-hour in-car session", () => {
    const result = validateClassBooking(
      theoryTarget({
        sameDayAlreadyBookedCount: 1,
        sameDayAlreadyBookedMinutes: 120,
        sameDayAlreadyBookedHasDriving: true,
      }),
      NONE,
      "auto",
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingRule).toBe("max_hours_per_day");
  });

  it("rejects a 2-hour in-car session on a day that already has a theory class", () => {
    const result = validateClassBooking(
      {
        classType: "driving",
        classNumber: 5,
        date: "2026-08-12",
        duration: 120,
        sameDayAlreadyBookedCount: 1,
        sameDayAlreadyBookedMinutes: 120,
        sameDayAlreadyBookedHasDriving: false,
      },
      // Theory 8 completed so Phase 3 in-car rules pass; cap fires first anyway.
      [{ classType: "theory", classNumber: 8, date: "2026-06-01" }],
      "auto",
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingRule).toBe("max_hours_per_day");
  });

  it("allows a 1-hour in-car session plus a theory class (exactly 180 minutes)", () => {
    const result = validateClassBooking(
      theoryTarget({
        sameDayAlreadyBookedCount: 1,
        sameDayAlreadyBookedMinutes: 60,
        sameDayAlreadyBookedHasDriving: true,
      }),
      NONE,
      "auto",
    );
    expect(result.allowed).toBe(true);
  });

  it("assumes 120 minutes for a theory class with unknown duration", () => {
    const result = validateClassBooking(
      theoryTarget({
        duration: undefined,
        sameDayAlreadyBookedCount: 1,
        sameDayAlreadyBookedMinutes: 120,
        sameDayAlreadyBookedHasDriving: true,
      }),
      NONE,
      "auto",
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingRule).toBe("max_hours_per_day");
  });

  it("does not apply to theory + theory days (class-count limit governs those)", () => {
    const result = validateClassBooking(
      theoryTarget({
        sameDayAlreadyBookedCount: 1,
        sameDayAlreadyBookedMinutes: 120,
        sameDayAlreadyBookedHasDriving: false,
      }),
      NONE,
      "auto",
    );
    expect(result.allowed).toBe(true);
  });

  it("does not fire when nothing else is booked that day", () => {
    const result = validateClassBooking(
      theoryTarget({
        sameDayAlreadyBookedCount: 0,
        sameDayAlreadyBookedMinutes: 0,
        sameDayAlreadyBookedHasDriving: false,
      }),
      NONE,
      "auto",
    );
    expect(result.allowed).toBe(true);
  });

  it("exempts moto students from the cap", () => {
    const result = validateClassBooking(
      theoryTarget({
        sameDayAlreadyBookedCount: 1,
        sameDayAlreadyBookedMinutes: 120,
        sameDayAlreadyBookedHasDriving: true,
      }),
      NONE,
      "moto",
    );
    expect(result.allowed).toBe(true);
  });

  it("exempts scooter students from the cap", () => {
    const result = validateClassBooking(
      theoryTarget({
        sameDayAlreadyBookedCount: 1,
        sameDayAlreadyBookedMinutes: 120,
        sameDayAlreadyBookedHasDriving: true,
      }),
      NONE,
      "scooter",
    );
    expect(result.allowed).toBe(true);
  });

  it("the class-count daily limit still applies before the hours cap", () => {
    const result = validateClassBooking(
      theoryTarget({
        sameDayAlreadyBookedCount: 2,
        sameDayAlreadyBookedMinutes: 180,
        sameDayAlreadyBookedHasDriving: true,
      }),
      NONE,
      "auto",
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingRule).toBe("max_classes_per_day");
  });
});

describe("relaxed auto sequential layer (validateSequentialProgression via validateClassBooking)", () => {
  const t1Done: CompletedClassRecord[] = [
    { classType: "theory", classNumber: 1, date: "2026-06-01" },
  ];

  it("still blocks booking a class number that is already booked", () => {
    const result = validateClassBooking(
      theoryTarget({ classNumber: 2, upcomingBookings: [{ classType: "theory", classNumber: 2 }] }),
      t1Done,
      "auto",
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingRule).toBe("class_number_already_booked");
  });

  it("still blocks re-booking an already-completed class", () => {
    const result = validateClassBooking(
      theoryTarget({ classNumber: 1, upcomingBookings: [] }),
      t1Done,
      "auto",
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingRule).toBe("class_number_already_completed");
  });

  it("allows auto Theory #3 without Theory #2 (T2-4 in any order after T1)", () => {
    const result = validateClassBooking(
      theoryTarget({ classNumber: 3, upcomingBookings: [] }),
      t1Done,
      "auto",
    );
    expect(result.allowed).toBe(true);
  });

  it("still enforces the phase gate: Theory #5 needs T1-T4 completed", () => {
    const result = validateClassBooking(
      theoryTarget({ classNumber: 5, upcomingBookings: [] }),
      t1Done,
      "auto",
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingRule).toBe("phase1_theory5_prerequisites");
    expect(result.detail?.prerequisitesNeeded).toEqual([
      "Theory #2",
      "Theory #3",
      "Theory #4",
    ]);
  });

  it("enforces the 28-day Phase 1 minimum for Theory #5", () => {
    const completed: CompletedClassRecord[] = [1, 2, 3, 4].map((n) => ({
      classType: "theory" as const,
      classNumber: n,
      date: "2026-08-01",
    }));
    const result = validateClassBooking(
      theoryTarget({ classNumber: 5, date: "2026-08-15", upcomingBookings: [] }),
      completed,
      "auto",
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingRule).toBe("phase1_min_28_days");
  });

  it("still caps concurrent upcoming in-car bookings at 2", () => {
    const completed: CompletedClassRecord[] = [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
        classType: "theory" as const,
        classNumber: n,
        date: "2026-01-01",
      })),
      ...[1, 2, 3, 4].map((n) => ({
        classType: "driving" as const,
        classNumber: n,
        date: "2026-03-01",
      })),
    ];
    const result = validateClassBooking(
      {
        classType: "driving",
        classNumber: 7,
        date: "2026-08-12",
        duration: 60,
        upcomingBookings: [
          { classType: "driving", classNumber: 5 },
          { classType: "driving", classNumber: 6 },
        ],
      },
      completed,
      "auto",
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingRule).toBe("max_concurrent_incar_bookings");
  });

  it("keeps strict one-at-a-time theory ordering for simplified courses (moto)", () => {
    const result = validateClassBooking(
      theoryTarget({ classNumber: 3, upcomingBookings: [] }),
      t1Done,
      "moto",
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingRule).toBe("previous_class_incomplete");
  });
});
