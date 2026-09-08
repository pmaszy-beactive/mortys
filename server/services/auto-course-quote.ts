import { storage } from "../storage";
import { getSchoolLocalDate, SCHOOL_TIMEZONE } from "./class-time";
import { findAvailableTheory1Class } from "./auto-enroll";
import {
  AUTO_COURSE_PRICING,
  AUTO_PAYMENT_PLANS,
  buildAutoInstallments,
  type AutoPaymentPlan,
} from "@shared/autoCoursePayment";

function addMinutes(time: string, duration: number): string {
  const [hours, minutes] = time.slice(0, 5).split(":").map(Number);
  const total = hours * 60 + minutes + duration;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export async function buildAutoCourseQuote(startDateId: number, dueDateAt = new Date()) {
  const startDate = await storage.getCourseStartDate(startDateId);
  if (!startDate || startDate.courseType !== "auto" || startDate.status !== "active") {
    return undefined;
  }
  const selectedClass = await findAvailableTheory1Class(startDate);
  if (!selectedClass) return undefined;

  // A resumed registration may have been created well before the student
  // reaches this step. "Due now" means the day the quote is produced (and,
  // at completion, the actual completion day), never the initial OTP date.
  const registrationDate = getSchoolLocalDate(dueDateAt);
  return {
    startDateId: startDate.id,
    courseName: "Automobile (Licence Class 5) — Theory 1",
    classId: selectedClass.id,
    classGroup: selectedClass.sessionGroupId || selectedClass.seriesId || null,
    location: selectedClass.zoomLink?.trim()
      ? "Online via Zoom"
      : selectedClass.room?.trim() || "Location unassigned — contact the school",
    startDate: selectedClass.date,
    schedule: {
      weekday: new Intl.DateTimeFormat("en-CA", {
        weekday: "long",
        timeZone: "UTC",
      }).format(new Date(`${selectedClass.date}T12:00:00Z`)),
      startTime: selectedClass.time.slice(0, 5),
      endTime: addMinutes(selectedClass.time, selectedClass.duration),
      durationMinutes: selectedClass.duration,
      timeZone: SCHOOL_TIMEZONE,
    },
    scheduleNote: "This is your selected Theory 1 class. Later sessions are booked separately.",
    currency: "CAD",
    pricing: AUTO_COURSE_PRICING,
    registrationDate,
    plans: AUTO_PAYMENT_PLANS.map((id) => ({
      id,
      installments: buildAutoInstallments(id, registrationDate),
    })),
  };
}

export function paymentSummaryFromQuote(
  quote: Awaited<ReturnType<typeof buildAutoCourseQuote>>,
  plan: AutoPaymentPlan,
) {
  if (!quote) throw new Error("Course quote is unavailable");
  const selected = quote.plans.find((candidate) => candidate.id === plan)!;
  return {
    plan,
    currency: quote.currency,
    totalCents: quote.pricing.totalCents,
    selectedStartDateId: quote.startDateId,
    classId: quote.classId,
    installments: selected.installments,
  };
}