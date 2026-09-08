// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
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

function renderTracker(classes: PhaseClassProgress[], compact = false) {
  return render(
    <PhaseProgressTracker
      phaseData={phaseData(classes)}
      courseType="auto"
      compact={compact}
    />,
  );
}

describe("paired In-Car #12/#13 schedule details", () => {
  it("shows the shared appointment on #12 and identifies #13 as included", () => {
    renderTracker([pairedRow(12), pairedRow(13)]);
    const primaryRow = within(screen.getByTestId("row-phase-class-driving_12"));
    const includedRow = within(screen.getByTestId("row-phase-class-driving_13"));

    expect(primaryRow.getByTestId("text-paired-booking-schedule-driving_12"))
      .toHaveTextContent("15/09/2026 at 1:30 PM with Alex Rider");
    expect(primaryRow.queryByText(/Included in the same #12\/#13 booking/))
      .not.toBeInTheDocument();

    expect(includedRow.getByTestId("text-paired-booking-schedule-driving_13"))
      .toHaveTextContent(
        "Included in the same #12/#13 booking · 15/09/2026 at 1:30 PM with Alex Rider",
      );
  });

  it("omits the shared appointment details in compact mode", () => {
    renderTracker([pairedRow(12), pairedRow(13)], true);

    expect(screen.queryByTestId(/text-paired-booking-schedule/))
      .not.toBeInTheDocument();
    expect(screen.queryByText(/15\/09\/2026/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Alex Rider/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Included in the same #12\/#13 booking/))
      .not.toBeInTheDocument();
  });

  it("keeps completed-row output unchanged", () => {
    renderTracker([
      pairedRow(12, { isCompleted: true }),
      pairedRow(13, { isCompleted: true }),
    ]);

    expect(screen.queryByTestId(/text-paired-booking-schedule/))
      .not.toBeInTheDocument();
    expect(screen.queryByText(/Included in the same #12\/#13 booking/))
      .not.toBeInTheDocument();
    expect(screen.queryByText(/at 1:30 PM/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Date: 15/09/2026 with Alex Rider")).toHaveLength(2);
  });
});