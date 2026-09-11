import { describe, expect, it } from "vitest";
import { getClassCountdownDisplay } from "./class-countdown";

const start = new Date("2026-09-11T10:00:00");

describe("class countdown display", () => {
  it("shows starting soon before the scheduled start", () => {
    expect(
      getClassCountdownDisplay(start, 60, new Date("2026-09-11T09:59:30")),
    ).toEqual({ caption: "Starts in", label: "Starting soon!" });
  });

  it("shows in progress after the start and before the end", () => {
    expect(
      getClassCountdownDisplay(start, 60, new Date("2026-09-11T10:30:00")),
    ).toEqual({ caption: "Status", label: "In progress" });
  });

  it("shows in progress after the start when duration is unavailable", () => {
    expect(
      getClassCountdownDisplay(start, null, new Date("2026-09-11T10:01:00")),
    ).toEqual({ caption: "Status", label: "In progress" });
  });

  it("shows ended once a known duration has elapsed", () => {
    expect(
      getClassCountdownDisplay(start, 60, new Date("2026-09-11T11:00:00")),
    ).toEqual({ caption: "Status", label: "Ended" });
  });
});