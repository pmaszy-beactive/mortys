import { describe, expect, it } from "vitest";
import {
  AVAILABLE_CLASSES_REFRESH_INTERVAL_MS,
  isActionablePairingOffer,
  PAIRING_STATUS_REFRESH_INTERVAL_MS,
} from "./incar-pairing-status";

describe("student pairing offer refresh and display", () => {
  it("refreshes often enough for a newly-created offer to appear without navigation", () => {
    expect(PAIRING_STATUS_REFRESH_INTERVAL_MS).toBeGreaterThan(0);
    expect(PAIRING_STATUS_REFRESH_INTERVAL_MS).toBeLessThanOrEqual(10_000);
  });

  it("refreshes available slots so a newly-scheduled canonical class becomes bookable", () => {
    expect(AVAILABLE_CLASSES_REFRESH_INTERVAL_MS).toBeGreaterThan(0);
    expect(AVAILABLE_CLASSES_REFRESH_INTERVAL_MS).toBeLessThanOrEqual(10_000);
  });

  it("displays only live pending offers", () => {
    const now = Date.parse("2030-01-01T12:00:00Z");
    expect(
      isActionablePairingOffer(
        { status: "pending", expiresAt: "2030-01-01T12:01:00Z" },
        now,
      ),
    ).toBe(true);
    expect(
      isActionablePairingOffer(
        { status: "accepted", expiresAt: "2030-01-01T12:01:00Z" },
        now,
      ),
    ).toBe(false);
    expect(
      isActionablePairingOffer(
        { status: "pending", expiresAt: "2030-01-01T11:59:00Z" },
        now,
      ),
    ).toBe(false);
  });
});