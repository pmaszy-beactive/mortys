import { db } from "../db";
import { 
  notifications, 
  notificationDeliveries, 
  notificationPreferences,
  students, 
  parents, 
  studentParents,
  users,
  classes,
  classEnrollments
} from "@shared/schema";
import { eq, and, inArray, not, desc, sql } from "drizzle-orm";
import { sendEmail } from "./sendgrid";

const SENDER_EMAIL = process.env.SENDGRID_FROM_EMAIL || "noreply@mortysdriving.com";

export type NotificationType = 
  | 'upcoming_class' 
  | 'schedule_change' 
  | 'payment_due' 
  | 'payment_received' 
  | 'policy_override'
  | 'class_cancelled'
  | 'class_reminder'
  | 'availability_reminder'
  | 'scrape_failure'
  | 'scrape_recovered'
  | 'auto_enroll_failed'
  | 'start_date_change'
  | 'series_days_change';

export type RecipientType = 'student' | 'parent' | 'staff';

export interface NotificationRecipient {
  type: RecipientType;
  id: string;
  email: string;
  name: string;
}

interface NotificationPayload {
  classId?: number;
  studentId?: number;
  paymentAmount?: number;
  oldDate?: string;
  newDate?: string;
  oldTime?: string;
  newTime?: string;
  oldInstructor?: string;
  newInstructor?: string;
  overrideReason?: string;
  [key: string]: any;
}

interface EnqueueNotificationParams {
  type: NotificationType;
  title: string;
  message: string;
  payload?: NotificationPayload;
  recipients: NotificationRecipient[];
  triggeredBy?: string;
  channels?: ('email' | 'in_app')[];
}

export async function enqueueNotification(params: EnqueueNotificationParams): Promise<number> {
  const { type, title, message, payload, recipients, triggeredBy, channels = ['email', 'in_app'] } = params;

  const [notification] = await db.insert(notifications).values({
    notificationType: type,
    title,
    message,
    payload: payload as any,
    triggeredBy,
  }).returning();

  const deliveries: {
    notificationId: number;
    recipientType: string;
    recipientId: string;
    recipientEmail: string | null;
    recipientName: string | null;
    channel: string;
    status: string;
  }[] = [];

  for (const recipient of recipients) {
    const prefs = await getNotificationPreferences(recipient.type, recipient.id, type);
    
    for (const channel of channels) {
      const isEnabled = channel === 'email' ? prefs.emailEnabled : prefs.inAppEnabled;
      
      if (isEnabled) {
        deliveries.push({
          notificationId: notification.id,
          recipientType: recipient.type,
          recipientId: recipient.id,
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          channel,
          status: 'pending',
        });
      }
    }
  }

  if (deliveries.length > 0) {
    await db.insert(notificationDeliveries).values(deliveries);
  }

  await processEmailDeliveries(notification.id, title, message);

  return notification.id;
}

async function processEmailDeliveries(notificationId: number, subject: string, body: string) {
  const pendingEmailDeliveries = await db.select()
    .from(notificationDeliveries)
    .where(and(
      eq(notificationDeliveries.notificationId, notificationId),
      eq(notificationDeliveries.channel, 'email'),
      eq(notificationDeliveries.status, 'pending')
    ));

  for (const delivery of pendingEmailDeliveries) {
    if (!delivery.recipientEmail) continue;

    try {
      const success = await sendEmail({
        to: [delivery.recipientEmail],
        from: SENDER_EMAIL,
        subject,
        html: generateEmailHtml(subject, body, delivery.recipientName),
      });

      await db.update(notificationDeliveries)
        .set({
          status: success ? 'sent' : 'failed',
          sentAt: success ? new Date() : null,
          errorMessage: success ? null : 'Failed to send email',
        })
        .where(eq(notificationDeliveries.id, delivery.id));
    } catch (error: any) {
      await db.update(notificationDeliveries)
        .set({
          status: 'failed',
          errorMessage: error?.message || 'Unknown error',
        })
        .where(eq(notificationDeliveries.id, delivery.id));
    }
  }
}

function generateEmailHtml(subject: string, body: string, recipientName: string | null): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <div style="background-color: #111111; padding: 20px; text-align: center;">
          <h1 style="color: #ECC462; margin: 0; font-size: 24px;">Morty's Driving School</h1>
        </div>
        <div style="padding: 30px;">
          ${recipientName ? `<p style="color: #333333; margin-bottom: 20px;">Hi ${recipientName},</p>` : ''}
          <div style="color: #333333; line-height: 1.6;">
            ${body.replace(/\n/g, '<br>')}
          </div>
        </div>
        <div style="background-color: #f9f9f9; padding: 20px; text-align: center; border-top: 1px solid #eeeeee;">
          <p style="color: #666666; font-size: 12px; margin: 0;">
            This is an automated message from Morty's Driving School.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

async function getNotificationPreferences(
  recipientType: RecipientType, 
  recipientId: string, 
  notificationType: NotificationType
): Promise<{ emailEnabled: boolean; inAppEnabled: boolean }> {
  const [pref] = await db.select()
    .from(notificationPreferences)
    .where(and(
      eq(notificationPreferences.recipientType, recipientType),
      eq(notificationPreferences.recipientId, recipientId),
      eq(notificationPreferences.notificationType, notificationType)
    ))
    .limit(1);

  if (pref) {
    return {
      emailEnabled: pref.emailEnabled ?? true,
      inAppEnabled: pref.inAppEnabled ?? true,
    };
  }

  return { emailEnabled: true, inAppEnabled: true };
}

export async function getStudentRecipients(studentId: number): Promise<NotificationRecipient[]> {
  const recipients: NotificationRecipient[] = [];

  const [student] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (student) {
    recipients.push({
      type: 'student',
      id: String(studentId),
      email: student.email,
      name: `${student.firstName} ${student.lastName}`,
    });
  }

  const linkedParents = await db.select({
    parent: parents,
    link: studentParents,
  })
    .from(studentParents)
    .innerJoin(parents, eq(studentParents.parentId, parents.id))
    .where(eq(studentParents.studentId, studentId));

  for (const { parent } of linkedParents) {
    recipients.push({
      type: 'parent',
      id: String(parent.id),
      email: parent.email,
      name: `${parent.firstName} ${parent.lastName}`,
    });
  }

  return recipients;
}

export async function getClassRecipients(classId: number): Promise<NotificationRecipient[]> {
  const recipients: NotificationRecipient[] = [];

  const enrollments = await db.select()
    .from(classEnrollments)
    .where(eq(classEnrollments.classId, classId));

  const studentIds = enrollments.map(e => e.studentId).filter((id): id is number => id !== null);

  for (const studentId of studentIds) {
    const studentRecipients = await getStudentRecipients(studentId);
    recipients.push(...studentRecipients);
  }

  return recipients;
}

export async function getAdminRecipients(): Promise<NotificationRecipient[]> {
  const adminUsers = await db.select()
    .from(users)
    .where(eq(users.role, 'admin'));

  return adminUsers
    .filter(u => u.email)
    .map(u => ({
      type: 'staff' as RecipientType,
      id: String(u.id),
      email: u.email!,
      name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Admin',
    }));
}

// Office staff who should hear about operational/system alerts (owners, admins, managers).
export async function getOfficeRecipients(): Promise<NotificationRecipient[]> {
  // OFFICE_NOTIFICATION_EMAILS (comma-delimited) overrides the recipient list
  // entirely — useful in dev/test so office alerts don't go to real staff.
  // When unset, all owner/admin/manager users receive office notifications.
  const override = process.env.OFFICE_NOTIFICATION_EMAILS;
  if (override && override.trim()) {
    return override
      .split(',')
      .map(e => e.trim())
      .filter(e => e.includes('@'))
      .map(email => ({
        type: 'staff' as RecipientType,
        id: `email:${email}`,
        email,
        name: 'Office',
      }));
  }

  const officeUsers = await db.select()
    .from(users)
    .where(inArray(users.role, ['owner', 'admin', 'manager']));

  return officeUsers
    .filter(u => u.email)
    .map(u => ({
      type: 'staff' as RecipientType,
      id: String(u.id),
      email: u.email!,
      name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Office',
    }));
}

// Build the office recipient list for scrape alerts, always including the
// configured fallback address so failures are never silently lost (e.g. before
// any office users exist).
async function getScrapeAlertRecipients(): Promise<NotificationRecipient[]> {
  const recipients = await getOfficeRecipients();

  const fallbackEmail = process.env.SCRAPE_ALERT_EMAIL;
  if (fallbackEmail && !recipients.some(r => r.email === fallbackEmail)) {
    recipients.push({
      type: 'staff',
      id: `email:${fallbackEmail}`,
      email: fallbackEmail,
      name: 'Office',
    });
  }

  return recipients;
}

// Alert the office when the nightly registration scrape fails. The cron job
// runs nightly, so a persistent failure produces one reminder per day. The
// `consecutiveFailures` count (tracked by the cron wrapper) lets the message
// escalate ("failing N days in a row") so a lingering problem stays visible.
export async function notifyScrapeFailure(failure: {
  runDate: string;
  reason: string;
  logTail?: string;
  consecutiveFailures?: number;
  // Pages the spider gave up on after exhausting retries/re-queues (missing
  // from the scraped data). When `skippedOnly` is true the run otherwise
  // succeeded (exit 0) — the alert is reframed as "skipped pages" rather than
  // a hard failure.
  skippedPages?: number;
  skippedOnly?: boolean;
}): Promise<number | null> {
  const recipients = await getScrapeAlertRecipients();

  if (recipients.length === 0) {
    console.error(
      `[scrape-alert] Nightly scrape failed (${failure.runDate}) but there are no office recipients to notify.`,
    );
    return null;
  }

  const streak =
    typeof failure.consecutiveFailures === 'number' &&
    failure.consecutiveFailures > 0
      ? failure.consecutiveFailures
      : 1;

  const streakLine =
    streak > 1
      ? `This scrape has now failed ${streak} nights in a row.\n`
      : '';

  const skipped =
    typeof failure.skippedPages === 'number' && failure.skippedPages > 0
      ? failure.skippedPages
      : undefined;
  const skippedOnly = failure.skippedOnly === true && !!skipped;

  const tail = failure.logTail?.trim();

  let title: string;
  let message: string;
  if (skippedOnly) {
    // The run itself exited cleanly, but some pages were dropped after the
    // spider exhausted its retries — frame it as a data gap, not a crash.
    title = `Nightly Scrape Skipped ${skipped} Page${skipped === 1 ? '' : 's'} — ${failure.runDate}`;
    message =
      `The nightly registration scrape completed, but ${skipped} page${skipped === 1 ? '' : 's'} could not be fetched and ${skipped === 1 ? 'is' : 'are'} missing from tonight's data.\n\n` +
      `Run date: ${failure.runDate}\n` +
      `Reason: ${failure.reason}\n\n` +
      `The affected records may be stale until a future run picks them up.` +
      (tail ? `\n\nSkipped pages:\n${tail}` : '');
  } else {
    title =
      streak > 1
        ? `Nightly Scrape Still Failing (${streak} days) — ${failure.runDate}`
        : `Nightly Scrape Failed — ${failure.runDate}`;
    message =
      `The nightly registration scrape failed.\n\n` +
      streakLine +
      `Run date: ${failure.runDate}\n` +
      `Reason: ${failure.reason}\n` +
      (skipped
        ? `Skipped pages this run: ${skipped} (missing from the scraped data)\n`
        : '') +
      `\nRegistration data may now be stale until this is resolved.` +
      (tail ? `\n\nRecent log output:\n${tail}` : '');
  }

  return enqueueNotification({
    type: 'scrape_failure',
    title,
    message,
    payload: {
      runDate: failure.runDate,
      reason: failure.reason,
      consecutiveFailures: skippedOnly ? undefined : streak,
      ...(skipped ? { skippedPages: skipped, skippedOnly } : {}),
    },
    recipients,
    channels: ['email', 'in_app'],
  });
}

// Let the office know the nightly scrape is healthy again after one or more
// failed nights. Only sent when a success follows a failure streak — healthy
// runs that follow healthy runs stay silent.
export async function notifyScrapeRecovered(recovery: {
  runDate: string;
  failedRuns?: number;
}): Promise<number | null> {
  const recipients = await getScrapeAlertRecipients();

  if (recipients.length === 0) {
    return null;
  }

  const failed =
    typeof recovery.failedRuns === 'number' && recovery.failedRuns > 0
      ? recovery.failedRuns
      : undefined;

  const streakLine = failed
    ? `It had been failing for ${failed} night${failed === 1 ? '' : 's'} in a row.\n`
    : '';

  const message =
    `The nightly registration scrape succeeded again.\n\n` +
    streakLine +
    `Run date: ${recovery.runDate}\n\n` +
    `Registration data is up to date again. No further action is needed.`;

  return enqueueNotification({
    type: 'scrape_recovered',
    title: `Nightly Scrape Recovered — ${recovery.runDate}`,
    message,
    payload: { runDate: recovery.runDate, failedRuns: failed },
    recipients,
    channels: ['email', 'in_app'],
  });
}

// Fetch the most recent nightly scrape-failure notification for the dashboard
// health widget. Returns null when no failure has ever been recorded.
export async function getLatestScrapeFailure(): Promise<{
  runDate: string | null;
  reason: string | null;
  createdAt: Date | null;
} | null> {
  const [latest] = await db
    .select({
      payload: notifications.payload,
      title: notifications.title,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.notificationType, 'scrape_failure'))
    .orderBy(desc(notifications.createdAt))
    .limit(1);

  if (!latest) return null;

  const payload = (latest.payload || {}) as { runDate?: string; reason?: string };
  return {
    runDate: payload.runDate ?? null,
    reason: payload.reason ?? null,
    createdAt: latest.createdAt ?? null,
  };
}

// Alert the office when a student finished registration with a selected course
// start date but could not be automatically enrolled in the matching Theory 1
// class (no matching class scheduled, class full, etc.). Registration still
// completes — this makes sure staff know to enroll the student manually.
export async function notifyAutoEnrollFailure(details: {
  studentId: number;
  studentName: string;
  studentEmail: string;
  courseType: string;
  startDate: string;
  startTime?: string | null;
  reason: string;
}): Promise<number | null> {
  const recipients = await getOfficeRecipients();

  if (recipients.length === 0) {
    console.error(
      `[auto-enroll] Could not auto-enroll student #${details.studentId} (${details.studentName}) and there are no office recipients to notify. Reason: ${details.reason}`,
    );
    return null;
  }

  const message =
    `A new student completed registration but could not be automatically enrolled in their first Theory 1 class.\n\n` +
    `Student: ${details.studentName} (${details.studentEmail})\n` +
    `Course: ${details.courseType}\n` +
    `Selected start date: ${details.startDate}${details.startTime ? ` at ${details.startTime}` : ''}\n` +
    `Reason: ${details.reason}\n\n` +
    `Please enroll this student in the correct class manually so their calendar shows their first class.`;

  return enqueueNotification({
    type: 'auto_enroll_failed',
    title: `Manual Enrollment Needed — ${details.studentName}`,
    message,
    payload: {
      studentId: details.studentId,
      courseType: details.courseType,
      startDate: details.startDate,
      startTime: details.startTime ?? null,
      reason: details.reason,
    },
    recipients,
    channels: ['email', 'in_app'],
  });
}

export async function notifyUpcomingClass(classData: {
  id: number;
  title: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  instructorName?: string;
  location?: string;
}): Promise<void> {
  const existingNotification = await db.select({ id: notifications.id })
    .from(notifications)
    .where(and(
      eq(notifications.notificationType, 'upcoming_class'),
      eq(notifications.title, `Upcoming Class: ${classData.title}`),
      sql`${notifications.payload}->>'classId' = ${String(classData.id)}`
    ))
    .limit(1);

  if (existingNotification.length > 0) {
    return;
  }

  const recipients = await getClassRecipients(classData.id);
  if (recipients.length === 0) return;

  const message = `You have an upcoming class scheduled:\n\n` +
    `Class: ${classData.title}\n` +
    `Date: ${classData.scheduledDate}\n` +
    `Time: ${classData.startTime} - ${classData.endTime}\n` +
    `${classData.instructorName ? `Instructor: ${classData.instructorName}\n` : ''}` +
    `${classData.location ? `Location: ${classData.location}` : ''}`;

  await enqueueNotification({
    type: 'upcoming_class',
    title: `Upcoming Class: ${classData.title}`,
    message,
    payload: { classId: classData.id },
    recipients,
  });
}

export async function notifyScheduleChange(classData: {
  id: number;
  title: string;
  changes: {
    oldDate?: string;
    newDate?: string;
    oldTime?: string;
    newTime?: string;
    oldInstructor?: string;
    newInstructor?: string;
    oldLocation?: string;
    newLocation?: string;
  };
}, triggeredBy?: string): Promise<void> {
  const recipients = await getClassRecipients(classData.id);
  if (recipients.length === 0) return;

  let changeDetails = '';
  const { changes } = classData;
  
  if (changes.oldDate && changes.newDate && changes.oldDate !== changes.newDate) {
    changeDetails += `Date: ${changes.oldDate} → ${changes.newDate}\n`;
  }
  if (changes.oldTime && changes.newTime && changes.oldTime !== changes.newTime) {
    changeDetails += `Time: ${changes.oldTime} → ${changes.newTime}\n`;
  }
  if (changes.oldInstructor && changes.newInstructor && changes.oldInstructor !== changes.newInstructor) {
    changeDetails += `Instructor: ${changes.oldInstructor} → ${changes.newInstructor}\n`;
  }
  if (changes.oldLocation && changes.newLocation && changes.oldLocation !== changes.newLocation) {
    changeDetails += `Location: ${changes.oldLocation} → ${changes.newLocation}\n`;
  }

  const message = `Your class "${classData.title}" has been updated:\n\n${changeDetails}`;

  await enqueueNotification({
    type: 'schedule_change',
    title: `Schedule Change: ${classData.title}`,
    message,
    payload: { classId: classData.id, ...changes },
    recipients,
    triggeredBy,
  });
}

// Notify enrolled students (and linked parents) that a class was cancelled.
export async function notifyClassCancelled(classData: {
  id: number;
  title: string;
  date: string;
  time: string;
  reason?: string;
}, triggeredBy?: string): Promise<void> {
  const recipients = await getClassRecipients(classData.id);
  if (recipients.length === 0) return;

  const message = `Your class "${classData.title}" scheduled for ${classData.date} at ${classData.time} has been cancelled.` +
    (classData.reason ? `\n\nReason: ${classData.reason}` : '') +
    `\n\nPlease check the schedule or contact the office to rebook.`;

  await enqueueNotification({
    type: 'class_cancelled',
    title: `Class Cancelled: ${classData.title}`,
    message,
    payload: { classId: classData.id, date: classData.date, time: classData.time },
    recipients,
    triggeredBy,
  });
}

// Notify a specific set of students (and their linked parents) that their
// Theory 1 class was moved because the office rescheduled the course start
// date. Uses the same schedule_change flow as notifyScheduleChange, but scoped
// to the moved students only (other students already in the destination class
// were not affected and should not be emailed).
export async function notifyStartDateReschedule(details: {
  studentIds: number[];
  classTitle: string;
  oldDate: string;
  newDate: string;
  oldTime?: string | null;
  newTime?: string | null;
  newClassId: number;
}, triggeredBy?: string): Promise<void> {
  const recipients: NotificationRecipient[] = [];
  for (const studentId of details.studentIds) {
    recipients.push(...(await getStudentRecipients(studentId)));
  }
  if (recipients.length === 0) return;

  let changeDetails = `Date: ${details.oldDate} → ${details.newDate}\n`;
  if (details.oldTime && details.newTime && details.oldTime !== details.newTime) {
    changeDetails += `Time: ${details.oldTime} → ${details.newTime}\n`;
  }

  const message =
    `The start date for your course has been changed, and your class "${details.classTitle}" has been moved:\n\n` +
    changeDetails +
    `\nYour calendar has been updated automatically — no action is needed.`;

  await enqueueNotification({
    type: 'schedule_change',
    title: `Schedule Change: ${details.classTitle}`,
    message,
    payload: {
      classId: details.newClassId,
      oldDate: details.oldDate,
      newDate: details.newDate,
      oldTime: details.oldTime ?? undefined,
      newTime: details.newTime ?? undefined,
    },
    recipients,
    triggeredBy,
  });
}

// Notify a specific set of students (and their linked parents) that the course
// start date behind their Theory 1 class was cancelled and the office will
// follow up with them.
export async function notifyStartDateCancelled(details: {
  studentIds: number[];
  classTitle: string;
  date: string;
  time?: string | null;
  classId: number;
}, triggeredBy?: string): Promise<void> {
  const recipients: NotificationRecipient[] = [];
  for (const studentId of details.studentIds) {
    recipients.push(...(await getStudentRecipients(studentId)));
  }
  if (recipients.length === 0) return;

  const message =
    `The course start date for your class "${details.classTitle}" on ${details.date}${details.time ? ` at ${details.time}` : ''} has been cancelled.\n\n` +
    `Our office will contact you shortly to reschedule you onto a new start date. ` +
    `If you have any questions in the meantime, please reach out to the office.`;

  await enqueueNotification({
    type: 'schedule_change',
    title: `Course Start Date Cancelled: ${details.classTitle}`,
    message,
    payload: {
      classId: details.classId,
      oldDate: details.date,
      oldTime: details.time ?? undefined,
    },
    recipients,
    triggeredBy,
  });
}

// Alert the office when a start-date change/cancellation leaves enrolled
// students needing manual attention (start date cancelled/deleted, no matching
// class on the new date, or individual moves failed).
export async function notifyStartDateActionNeeded(details: {
  courseType: string;
  oldDate: string;
  newDate?: string | null;
  reason: string;
  students: { studentId: number; studentName: string; note?: string }[];
}): Promise<number | null> {
  const recipients = await getOfficeRecipients();

  if (recipients.length === 0) {
    console.error(
      `[start-dates] Start date change for ${details.courseType} on ${details.oldDate} needs manual handling but there are no office recipients to notify. Reason: ${details.reason}`,
    );
    return null;
  }

  const studentLines = details.students
    .map((s) => `- ${s.studentName} (#${s.studentId})${s.note ? ` — ${s.note}` : ''}`)
    .join('\n');

  const message =
    `A course start date was ${details.newDate ? `changed (${details.oldDate} → ${details.newDate})` : `cancelled/removed (${details.oldDate})`} ` +
    `for the ${details.courseType} course, and the following enrolled student${details.students.length === 1 ? '' : 's'} need${details.students.length === 1 ? 's' : ''} manual attention:\n\n` +
    `${studentLines}\n\n` +
    `Reason: ${details.reason}\n\n` +
    `Please review these students' enrollments and move or contact them as needed.`;

  return enqueueNotification({
    type: 'start_date_change',
    title: `Start Date Change — ${details.students.length} student${details.students.length === 1 ? '' : 's'} need attention`,
    message,
    payload: {
      courseType: details.courseType,
      oldDate: details.oldDate,
      newDate: details.newDate ?? undefined,
      reason: details.reason,
      studentIds: details.students.map((s) => s.studentId),
    },
    recipients,
    channels: ['email', 'in_app'],
  });
}

// Notify a specific set of students (and their linked parents) that their
// class was moved to a different day because the office changed the days of
// week a recurring series runs on. Scoped to moved students only.
export async function notifySeriesDayMove(details: {
  studentIds: number[];
  classTitle: string;
  oldDate: string;
  newDate: string;
  time?: string | null;
  newClassId: number;
}, triggeredBy?: string): Promise<void> {
  const recipients: NotificationRecipient[] = [];
  for (const studentId of details.studentIds) {
    recipients.push(...(await getStudentRecipients(studentId)));
  }
  if (recipients.length === 0) return;

  const message =
    `The recurring schedule for your class "${details.classTitle}" has changed which days of the week it runs on, and your class has been moved:\n\n` +
    `Date: ${details.oldDate} → ${details.newDate}\n` +
    (details.time ? `Time: ${details.time}\n` : '') +
    `\nYour calendar has been updated automatically — no action is needed.`;

  await enqueueNotification({
    type: 'schedule_change',
    title: `Schedule Change: ${details.classTitle}`,
    message,
    payload: {
      classId: details.newClassId,
      oldDate: details.oldDate,
      newDate: details.newDate,
      newTime: details.time ?? undefined,
    },
    recipients,
    triggeredBy,
  });
}

// Notify a specific set of students (and their linked parents) that their
// class was removed because the series' days changed and they could not be
// moved automatically — the office will follow up.
export async function notifySeriesDayRemoved(details: {
  studentIds: number[];
  classTitle: string;
  date: string;
  time?: string | null;
  classId: number;
}, triggeredBy?: string): Promise<void> {
  const recipients: NotificationRecipient[] = [];
  for (const studentId of details.studentIds) {
    recipients.push(...(await getStudentRecipients(studentId)));
  }
  if (recipients.length === 0) return;

  const message =
    `Your class "${details.classTitle}" on ${details.date}${details.time ? ` at ${details.time}` : ''} has been removed because the recurring schedule changed which days of the week it runs on.\n\n` +
    `Our office will contact you shortly to rebook you onto the new schedule. ` +
    `If you have any questions in the meantime, please reach out to the office.`;

  await enqueueNotification({
    type: 'class_cancelled',
    title: `Class Removed: ${details.classTitle}`,
    message,
    payload: {
      classId: details.classId,
      oldDate: details.date,
      oldTime: details.time ?? undefined,
    },
    recipients,
    triggeredBy,
  });
}

// Alert the office when changing a series' days of week leaves enrolled
// students needing manual attention (could not be moved to a new-day class).
export async function notifySeriesDaysActionNeeded(details: {
  seriesTitle: string;
  oldDays: string;
  newDays: string;
  reason: string;
  students: { studentId: number; studentName: string; note?: string }[];
}): Promise<number | null> {
  const recipients = await getOfficeRecipients();

  if (recipients.length === 0) {
    console.error(
      `[series] Days-of-week change for "${details.seriesTitle}" needs manual handling but there are no office recipients to notify. Reason: ${details.reason}`,
    );
    return null;
  }

  const studentLines = details.students
    .map((s) => `- ${s.studentName} (#${s.studentId})${s.note ? ` — ${s.note}` : ''}`)
    .join('\n');

  const message =
    `The recurring series "${details.seriesTitle}" changed which days of the week it runs on (${details.oldDays} → ${details.newDays}), ` +
    `and the following enrolled student${details.students.length === 1 ? '' : 's'} need${details.students.length === 1 ? 's' : ''} manual attention:\n\n` +
    `${studentLines}\n\n` +
    `Reason: ${details.reason}\n\n` +
    `Please review these students' enrollments and rebook or contact them as needed.`;

  return enqueueNotification({
    type: 'series_days_change',
    title: `Series Days Changed — ${details.students.length} student${details.students.length === 1 ? '' : 's'} need attention`,
    message,
    payload: {
      seriesTitle: details.seriesTitle,
      oldDays: details.oldDays,
      newDays: details.newDays,
      reason: details.reason,
      studentIds: details.students.map((s) => s.studentId),
    },
    recipients,
    channels: ['email', 'in_app'],
  });
}

export async function notifyPaymentReceived(paymentData: {
  studentId: number;
  amount: number;
  paymentMethod: string;
  referenceNumber?: string;
}): Promise<void> {
  const recipients = await getStudentRecipients(paymentData.studentId);
  if (recipients.length === 0) return;

  const message = `We've received your payment of $${paymentData.amount.toFixed(2)}.\n\n` +
    `Payment Method: ${paymentData.paymentMethod}\n` +
    `${paymentData.referenceNumber ? `Reference: ${paymentData.referenceNumber}` : ''}` +
    `\n\nThank you for your payment!`;

  await enqueueNotification({
    type: 'payment_received',
    title: 'Payment Received',
    message,
    payload: { 
      studentId: paymentData.studentId,
      paymentAmount: paymentData.amount,
    },
    recipients,
  });
}

export async function notifyPaymentDue(dueData: {
  studentId: number;
  amount: number;
  dueDate: string;
  description?: string;
}): Promise<void> {
  const recipients = await getStudentRecipients(dueData.studentId);
  if (recipients.length === 0) return;

  const message = `You have a payment due:\n\n` +
    `Amount: $${dueData.amount.toFixed(2)}\n` +
    `Due Date: ${dueData.dueDate}\n` +
    `${dueData.description ? `Description: ${dueData.description}` : ''}`;

  await enqueueNotification({
    type: 'payment_due',
    title: 'Payment Due Reminder',
    message,
    payload: { 
      studentId: dueData.studentId,
      paymentAmount: dueData.amount,
    },
    recipients,
  });
}

export async function notifyPolicyOverride(overrideData: {
  studentId?: number;
  classId?: number;
  policyType: string;
  reason: string;
  staffName: string;
}, triggeredBy?: string): Promise<void> {
  const adminRecipients = await getAdminRecipients();
  const studentRecipients = overrideData.studentId 
    ? await getStudentRecipients(overrideData.studentId)
    : [];

  const allRecipients = [...adminRecipients, ...studentRecipients];
  if (allRecipients.length === 0) return;

  const message = `A booking policy has been overridden:\n\n` +
    `Policy: ${overrideData.policyType}\n` +
    `Reason: ${overrideData.reason}\n` +
    `Overridden by: ${overrideData.staffName}`;

  await enqueueNotification({
    type: 'policy_override',
    title: 'Policy Override Notice',
    message,
    payload: {
      studentId: overrideData.studentId,
      classId: overrideData.classId,
      overrideReason: overrideData.reason,
    },
    recipients: allRecipients,
    triggeredBy,
  });
}

export async function getUnreadNotifications(
  recipientType: RecipientType,
  recipientId: string
): Promise<any[]> {
  const deliveries = await db.select({
    delivery: notificationDeliveries,
    notification: notifications,
  })
    .from(notificationDeliveries)
    .innerJoin(notifications, eq(notificationDeliveries.notificationId, notifications.id))
    .where(and(
      eq(notificationDeliveries.recipientType, recipientType),
      eq(notificationDeliveries.recipientId, recipientId),
      eq(notificationDeliveries.channel, 'in_app')
    ))
    .orderBy(desc(notifications.createdAt));

  const seen = new Set<number>();
  const deduped: any[] = [];
  for (const d of deliveries) {
    if (seen.has(d.notification.id)) continue;
    seen.add(d.notification.id);
    deduped.push({
      id: d.delivery.id,
      notificationId: d.notification.id,
      type: d.notification.notificationType,
      title: d.notification.title,
      message: d.notification.message,
      payload: d.notification.payload,
      status: d.delivery.status,
      readAt: d.delivery.readAt,
      createdAt: d.notification.createdAt,
    });
  }
  return deduped;
}

export async function markNotificationRead(deliveryId: number): Promise<void> {
  await db.update(notificationDeliveries)
    .set({ 
      status: 'read', 
      readAt: new Date() 
    })
    .where(eq(notificationDeliveries.id, deliveryId));
}

export async function updateNotificationPreferences(
  recipientType: RecipientType,
  recipientId: string,
  preferences: { notificationType: string; emailEnabled: boolean; inAppEnabled: boolean }[]
): Promise<void> {
  for (const pref of preferences) {
    const [existing] = await db.select()
      .from(notificationPreferences)
      .where(and(
        eq(notificationPreferences.recipientType, recipientType),
        eq(notificationPreferences.recipientId, recipientId),
        eq(notificationPreferences.notificationType, pref.notificationType)
      ))
      .limit(1);

    if (existing) {
      await db.update(notificationPreferences)
        .set({
          emailEnabled: pref.emailEnabled,
          inAppEnabled: pref.inAppEnabled,
          updatedAt: new Date(),
        })
        .where(eq(notificationPreferences.id, existing.id));
    } else {
      await db.insert(notificationPreferences).values({
        recipientType,
        recipientId,
        notificationType: pref.notificationType,
        emailEnabled: pref.emailEnabled,
        inAppEnabled: pref.inAppEnabled,
      });
    }
  }
}

// Send availability reminders to instructors who need to update their availability
export async function sendAvailabilityReminders(): Promise<{ sent: number; errors: string[] }> {
  const { instructors, instructorReminderSettings } = await import("@shared/schema");
  
  const results = { sent: 0, errors: [] as string[] };
  
  try {
    // Get all instructors with their reminder settings
    const allInstructors = await db.select().from(instructors).where(eq(instructors.status, 'active'));
    const allSettings = await db.select().from(instructorReminderSettings);
    
    const settingsMap = new Map(allSettings.map(s => [s.instructorId, s]));
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    for (const instructor of allInstructors) {
      try {
        const settings = settingsMap.get(instructor.id);
        
        // Skip if reminders are disabled
        if (settings && !settings.availabilityReminderEnabled) {
          continue;
        }
        
        // Use default settings if no custom settings exist
        const frequency = settings?.reminderFrequency || 'weekly';
        const reminderDay = settings?.reminderDayOfWeek ?? 0; // Default Sunday
        const emailEnabled = settings?.emailEnabled ?? true;
        const inAppEnabled = settings?.inAppEnabled ?? true;
        
        // Check if we should send a reminder based on frequency
        let shouldSend = false;
        
        if (frequency === 'daily') {
          shouldSend = true;
        } else if (frequency === 'weekly' && dayOfWeek === reminderDay) {
          shouldSend = true;
        } else if (frequency === 'biweekly') {
          // Send every other week on the reminder day
          const weekNumber = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
          shouldSend = dayOfWeek === reminderDay && weekNumber % 2 === 0;
        } else if (frequency === 'monthly' && now.getDate() === 1) {
          shouldSend = true;
        }
        
        // Check if we already sent a reminder today
        if (settings?.lastReminderSentAt) {
          const lastSent = new Date(settings.lastReminderSentAt);
          if (lastSent.toDateString() === now.toDateString()) {
            shouldSend = false;
          }
        }
        
        if (!shouldSend) {
          continue;
        }
        
        // Build notification channels
        const channels: ('email' | 'in_app')[] = [];
        if (emailEnabled) channels.push('email');
        if (inAppEnabled) channels.push('in_app');
        
        if (channels.length === 0) {
          continue;
        }
        
        // Send the reminder
        await enqueueNotification({
          type: 'availability_reminder',
          title: 'Please Update Your Availability',
          message: `Hi ${instructor.firstName}, please update your availability for the upcoming weeks to help with scheduling. You can do this from your instructor dashboard.`,
          recipients: [{
            type: 'staff',
            id: instructor.id.toString(),
            email: instructor.email,
            name: `${instructor.firstName} ${instructor.lastName}`,
          }],
          channels,
        });
        
        // Update last reminder sent timestamp
        if (settings) {
          await db.update(instructorReminderSettings)
            .set({ lastReminderSentAt: now })
            .where(eq(instructorReminderSettings.instructorId, instructor.id));
        }
        
        results.sent++;
      } catch (error: any) {
        results.errors.push(`Failed to send reminder to instructor ${instructor.id}: ${error.message}`);
      }
    }
  } catch (error: any) {
    results.errors.push(`Failed to fetch instructors: ${error.message}`);
  }
  
  return results;
}
