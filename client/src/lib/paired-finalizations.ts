export type PairedFinalizationStatus =
  | "converted"
  | "converted_solo"
  | "completed"
  | "pending"
  | "reconciled"
  | "unchanged";

export interface PairedFinalization {
  status: PairedFinalizationStatus;
  message?: string;
  pairedSessionId: number;
}

const statuses = new Set<PairedFinalizationStatus>([
  "converted",
  "converted_solo",
  "completed",
  "pending",
  "reconciled",
  "unchanged",
]);

export function getPairedFinalizations(response: unknown): PairedFinalization[] {
  if (!response || typeof response !== "object") return [];

  const value = (response as { pairedFinalizations?: unknown }).pairedFinalizations;
  if (!Array.isArray(value)) return [];

  return value.flatMap((outcome): PairedFinalization[] => {
    if (!outcome || typeof outcome !== "object") return [];

    const candidate = outcome as Record<string, unknown>;
    if (
      typeof candidate.status !== "string" ||
      !statuses.has(candidate.status as PairedFinalizationStatus) ||
      typeof candidate.pairedSessionId !== "number" ||
      !Number.isFinite(candidate.pairedSessionId)
    ) {
      return [];
    }

    return [{
      status: candidate.status as PairedFinalizationStatus,
      pairedSessionId: candidate.pairedSessionId,
      message: typeof candidate.message === "string" && candidate.message.trim()
        ? candidate.message.trim()
        : undefined,
    }];
  });
}

export function describePairedFinalizations(response: unknown): string | null {
  const outcomes = getPairedFinalizations(response);
  if (outcomes.length === 0) return null;

  return outcomes.map((outcome) => {
    if (outcome.message) return outcome.message;

    const session = `Paired session ${outcome.pairedSessionId}`;
    switch (outcome.status) {
      case "converted":
      case "converted_solo":
        return `${session} was converted to solo Lessons 11 and 14.`;
      case "completed":
        return `${session} was completed.`;
      case "pending":
        return `${session} is still pending; its paired attendance has not been finalized.`;
      case "reconciled":
        return `${session} attendance was reconciled.`;
      case "unchanged":
        return `${session} was unchanged.`;
    }
  }).join(" ");
}

export function responseMessage(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const message = (response as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}