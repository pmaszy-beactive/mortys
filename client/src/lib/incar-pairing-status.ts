export const PAIRING_STATUS_REFRESH_INTERVAL_MS = 10_000;
export const AVAILABLE_CLASSES_REFRESH_INTERVAL_MS = 10_000;

export interface PairingOfferStatus {
  status: string;
  expiresAt: string | Date;
}

export function isActionablePairingOffer(
  offer: PairingOfferStatus,
  now = Date.now(),
): boolean {
  return offer.status === "pending" && new Date(offer.expiresAt).getTime() > now;
}