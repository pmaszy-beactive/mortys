import { storage } from "../storage";
import type { InstructorAvailability } from "@shared/schema";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parseTime(t: unknown): number | null {
  if (typeof t !== "string") return null;
  const [h, m] = t.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

function formatWindows(windows: InstructorAvailability[]): string {
  return windows.map(w => `${w.startTime}–${w.endTime}`).join(", ");
}

export interface AvailabilityViolation {
  instructorId: number;
  instructorName: string;
  date: string;
  dayName: string;
  message: string;
}

/**
 * Checks whether a class (date + start time + duration) fits inside one of the
 * instructor's `isAvailable` windows for that day of week.
 *
 * Returns null when the class is allowed:
 * - no instructor assigned
 * - instructor has NO availability records at all (availability not yet
 *   configured is not treated as "never available")
 * - the class fits entirely within an available window
 *
 * Otherwise returns a violation describing the problem.
 */
export async function checkInstructorAvailability(
  instructorId: number | null | undefined,
  date: string,
  time: string | null | undefined,
  duration: number | null | undefined,
): Promise<AvailabilityViolation | null> {
  if (!instructorId) return null;

  const startMin = parseTime(time);
  if (startMin === null) return null;
  const endMin = startMin + (duration || 120);

  const allRecords = await storage.getInstructorAvailability(instructorId);
  if (allRecords.length === 0) return null; // availability not configured

  const instructor = await storage.getInstructor(instructorId);
  const instructorName = instructor
    ? `${instructor.firstName} ${instructor.lastName}`
    : `Instructor #${instructorId}`;

  const dayOfWeek = new Date(date + "T00:00:00").getDay();
  const dayName = DAY_NAMES[dayOfWeek];
  const dayWindows = allRecords.filter(r => r.dayOfWeek === dayOfWeek && r.isAvailable);

  if (dayWindows.length === 0) {
    return {
      instructorId,
      instructorName,
      date,
      dayName,
      message: `${instructorName} is not available on ${dayName}s (no available hours set for that day)`,
    };
  }

  const fits = dayWindows.some(w => {
    const wStart = parseTime(w.startTime);
    const wEnd = parseTime(w.endTime);
    return wStart !== null && wEnd !== null && startMin >= wStart && endMin <= wEnd;
  });
  if (fits) return null;

  return {
    instructorId,
    instructorName,
    date,
    dayName,
    message: `${instructorName} is only available ${formatWindows(dayWindows)} on ${dayName}s — this class (${time}, ${duration || 120} min) falls outside those hours`,
  };
}
