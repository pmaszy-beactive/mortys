import { AlertCircle, BookOpen, CalendarDays, CheckCircle2, MapPin } from "lucide-react";
import type { AutoPaymentPlan } from "@shared/autoCoursePayment";

export type AutoCourseQuote = {
  startDateId: number;
  courseName: string;
  classId: number;
  classGroup: string | null;
  location: string;
  startDate: string;
  schedule: {
    weekday: string;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    timeZone: string;
  };
  scheduleNote: string;
  currency: "CAD";
  pricing: {
    courseBaseCents: number;
    courseInclusiveCents: number;
    booksBaseCents: number;
    booksInclusiveCents: number;
    totalCents: number;
  };
  registrationDate: string;
  plans: {
    id: AutoPaymentPlan;
    installments: { dueDate: string; amountCents: number }[];
  }[];
};

type Props = {
  quote?: AutoCourseQuote;
  loading: boolean;
  error?: string;
  selectedPlan?: string;
  onPlanChange: (plan: AutoPaymentPlan) => void;
};

const money = (cents: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);

const dateLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const PLAN_LABELS: Record<AutoPaymentPlan, string> = {
  full: "Pay in full",
  three: "3 equal installments",
  six: "6 equal installments",
};

export function AutoCourseSummary({ quote, loading, error, selectedPlan, onPlanChange }: Props) {
  if (loading) {
    return <div className="h-72 animate-pulse rounded-xl bg-amber-100" aria-label="Loading course details" />;
  }
  if (error) {
    return (
      <div role="alert" className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <span>{error}</span>
      </div>
    );
  }
  if (!quote) return null;

  return (
    <section className="space-y-5 rounded-xl border border-amber-300 bg-white p-4 sm:p-5" aria-labelledby="auto-course-summary-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Your course summary</p>
        <h3 id="auto-course-summary-title" className="mt-1 text-lg font-bold text-[#111111]">{quote.courseName}</h3>
        {quote.classGroup && <p className="text-xs text-gray-500">Class group: {quote.classGroup}</p>}
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <div><dt className="font-semibold">Location</dt><dd>{quote.location}</dd></div>
        </div>
        <div className="flex gap-2">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <dt className="font-semibold">Theory 1 schedule</dt>
            <dd>{dateLabel(quote.startDate)}</dd>
            <dd>{quote.schedule.weekday}, {quote.schedule.startTime}–{quote.schedule.endTime} ({quote.schedule.durationMinutes} minutes)</dd>
            <dd className="text-xs text-gray-500">School timezone: {quote.schedule.timeZone}</dd>
          </div>
        </div>
      </dl>
      <p className="text-xs text-gray-600">{quote.scheduleNote}</p>

      <div className="rounded-lg bg-amber-50 p-4">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4"><dt>Course fee</dt><dd>{money(quote.pricing.courseInclusiveCents)} <span className="text-xs text-gray-500">({money(quote.pricing.courseBaseCents)} before tax)</span></dd></div>
          <div className="flex justify-between gap-4"><dt className="flex items-center gap-1"><BookOpen className="h-4 w-4" /> Required books</dt><dd>{money(quote.pricing.booksInclusiveCents)} <span className="text-xs text-gray-500">({money(quote.pricing.booksBaseCents)} before tax)</span></dd></div>
          <p className="text-xs text-amber-900">Required books are extra and are not included in the course fee.</p>
          <div className="flex justify-between border-t border-amber-200 pt-2 text-base font-bold"><dt>Total</dt><dd>{money(quote.pricing.totalCents)} CAD</dd></div>
        </dl>
      </div>

      <fieldset>
        <legend className="font-semibold text-[#111111]">Choose an interest-free payment plan *</legend>
        <p className="mb-3 text-xs text-gray-600">The first payment is due on your registration date; remaining payments are due monthly.</p>
        <div className="space-y-3" role="radiogroup" aria-label="Interest-free payment plans">
          {quote.plans.map((plan) => {
            const selected = selectedPlan === plan.id;
            const first = plan.installments[0];
            return (
              <label key={plan.id} className="block cursor-pointer">
                <input
                  type="radio"
                  name="auto-payment-plan"
                  value={plan.id}
                  checked={selected}
                  onChange={() => onPlanChange(plan.id)}
                  className="peer sr-only"
                  data-testid={`auto-payment-plan-${plan.id}`}
                />
                <span className={`block w-full rounded-lg border-2 p-3 text-left transition-colors peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-[#111111] peer-focus-visible:ring-offset-2 ${selected ? "border-[#111111] bg-[#111111] text-white" : "border-gray-200 hover:border-amber-400"}`}>
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{PLAN_LABELS[plan.id]}</span>
                    {selected && <CheckCircle2 className="h-5 w-5 text-[#ECC462]" aria-hidden="true" />}
                  </span>
                  <span className={`mt-1 block text-sm ${selected ? "text-gray-200" : "text-gray-600"}`}>
                    {money(first.amountCents)} due now on {dateLabel(first.dueDate)}
                  </span>
                  {selected && plan.installments.length > 1 && (
                    <span className="mt-2 block border-t border-gray-600 pt-2 text-xs text-gray-200">
                      {plan.installments.slice(1).map((installment, index) => (
                        <span key={installment.dueDate} className="flex justify-between gap-3 py-0.5">
                          <span>Payment {index + 2}: {dateLabel(installment.dueDate)}</span>
                          <span>{money(installment.amountCents)}</span>
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <p className="rounded-lg bg-blue-50 p-3 text-xs text-blue-900">
        Your selection will be saved. Completing registration does not charge your card automatically.
      </p>
    </section>
  );
}