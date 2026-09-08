export const NO_SHOW_CONVERSION_LESSONS = [11, 14] as const;

export function buildNoShowConversionRequest(pairedSessionId: number, presentEnrollmentId: number) {
  return {
    url: `/api/lesson-pairing/sessions/${pairedSessionId}/convert`,
    body: { presentEnrollmentId },
  };
}