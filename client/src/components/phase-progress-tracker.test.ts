import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PhaseClassProgress, PhaseProgressData } from "@shared/phaseConfig";
import PhaseProgressTracker from "./phase-progress-tracker";

const sharedAppointment = {
  isBooked: true,
  date: "2026-09-15",
  time: "13:30",
  instructorName: "Alex Rider",
};

function pairedRow(
  classNumber: 12 | 13,
  overrides: Partial<PhaseClassProgress> = {},
): PhaseClassProgress {
  return {
    id: `driving_${classNumber}`,
    label: `In-Car #${classNumber}`,
    classType: "driving",
    classNumber,
    pairedBookingRole: classNumber === 12 ? "primary" : "included",
    isCompleted: false,
    ...sharedAppointment,
    ...overrides,
  };
}

function phaseData(classes: PhaseClassProgress[]): PhaseProgressData {
  return {
    currentPhase: 4,
    phases: [
      {
        phase: 4,
        label: "Phase 4",
        minimumDays: 56,
        dayCount: 0,
        isComplete: false,
        isCurrent: true,
        isLocked: false,
        completedCount: classes.filter((item) => item.isCompleted).length,
        totalCount: classes.length,
        notes: "Phase notes",
        classes,
      },
    ],
  };
}

function renderTracker(classes: PhaseClassProgress[], compact = false): string {
  return renderToStaticMarkup(
    React.createElement(PhaseProgressTracker, {
      phaseData: phaseData(classes),
      courseType: "auto",
      compact,
    }),
  );
}

function rowMarkup(markup: string, id: string): string {
  const start = markup.indexOf(`data-testid="row-phase-class-${id}"`);
  if (start === -1) throw new Error(`Missing rendered row ${id}`);
  const nextRow = markup.indexOf('data-testid="row-phase-class-', start + 1);
  return markup.slice(start, nextRow === -1 ? undefined : nextRow);
}

describe("paired In-Car #12/#13 schedule details", () => {
  it("shows the shared appointment on #12 and identifies #13 as included", () => {
    const markup = renderTracker([pairedRow(12), pairedRow(13)]);
    const primaryRow = rowMarkup(markup, "driving_12");
    const includedRow = rowMarkup(markup, "driving_13");

    expect(primaryRow).toContain('data-testid="text-paired-booking-schedule-driving_12"');
    expect(primaryRow).toContain("15/09/2026 at 1:30 PM with Alex Rider");
    expect(primaryRow).not.toContain("Included in the same #12/#13 booking");

    expect(includedRow).toContain('data-testid="text-paired-booking-schedule-driving_13"');
    expect(includedRow).toContain("Included in the same #12/#13 booking · ");
    expect(includedRow).toContain("15/09/2026 at 1:30 PM with Alex Rider");
  });

  it("omits the shared appointment details in compact mode", () => {
    const markup = renderTracker([pairedRow(12), pairedRow(13)], true);

    expect(markup).not.toContain("text-paired-booking-schedule");
    expect(markup).not.toContain("15/09/2026");
    expect(markup).not.toContain("Alex Rider");
    expect(markup).not.toContain("Included in the same #12/#13 booking");
  });

  it("keeps completed-row output unchanged", () => {
    const markup = renderTracker([
      pairedRow(12, { isCompleted: true }),
      pairedRow(13, { isCompleted: true }),
    ]);

    expect(markup).not.toContain("text-paired-booking-schedule");
    expect(markup).not.toContain("Included in the same #12/#13 booking");
    expect(markup).not.toContain("at 1:30 PM");
    expect(markup.match(/Date: 15\/09\/2026 with Alex Rider/g)).toHaveLength(2);
  });
});