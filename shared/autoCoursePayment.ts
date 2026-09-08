export const AUTO_COURSE_PRICING = {
  courseBaseCents: 113000,
  courseInclusiveCents: 129922,
  booksBaseCents: 8000,
  booksInclusiveCents: 9200,
  totalCents: 139122,
} as const;

export const AUTO_PAYMENT_PLANS = ["full", "three", "six"] as const;
export type AutoPaymentPlan = (typeof AUTO_PAYMENT_PLANS)[number];

export type AutoInstallment = {
  dueDate: string;
  amountCents: number;
};

export function isAutoPaymentPlan(value: unknown): value is AutoPaymentPlan {
  return typeof value === "string" && AUTO_PAYMENT_PLANS.includes(value as AutoPaymentPlan);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Adds calendar months to a YYYY-MM-DD date, clamping to that month's end. */
export function addClampedMonths(date: string, months: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("Registration date must use YYYY-MM-DD");
  const sourceYear = Number(match[1]);
  const sourceMonth = Number(match[2]);
  const sourceDay = Number(match[3]);
  if (
    sourceMonth < 1 ||
    sourceMonth > 12 ||
    sourceDay < 1 ||
    sourceDay > daysInMonth(sourceYear, sourceMonth)
  ) {
    throw new Error("Registration date is not a valid calendar date");
  }

  const monthIndex = sourceYear * 12 + sourceMonth - 1 + months;
  const year = Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12 + 1;
  const day = Math.min(sourceDay, daysInMonth(year, month));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function buildAutoInstallments(
  plan: AutoPaymentPlan,
  registrationDate: string,
): AutoInstallment[] {
  const count = plan === "full" ? 1 : plan === "three" ? 3 : 6;
  const amountCents = AUTO_COURSE_PRICING.totalCents / count;
  if (!Number.isInteger(amountCents)) {
    throw new Error("Course total cannot be divided equally for this payment plan");
  }
  return Array.from({ length: count }, (_, index) => ({
    dueDate: addClampedMonths(registrationDate, index),
    amountCents,
  }));
}