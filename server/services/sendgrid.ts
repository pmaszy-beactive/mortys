import { MailService } from "@sendgrid/mail";

// Check if SendGrid is configured
const isConfigured = !!process.env.SENDGRID_API_KEY;
let mailService: MailService | null = null;

if (isConfigured) {
  mailService = new MailService();
  mailService.setApiKey(process.env.SENDGRID_API_KEY!);
  console.log("SendGrid service initialized with API key");
} else {
  console.warn("SendGrid API key not found - running in mock mode. Set SENDGRID_API_KEY to send real emails.");
}

const REPLY_TO = process.env.SENDGRID_REPLY_TO || "info@mortys.ca";

// UAT email override: when UAT_EMAIL_OVERRIDE is true/1, outgoing emails are
// redirected to OFFICE_NOTIFICATION_EMAILS so no real students, parents, or
// staff receive mail during UAT with imported live data.
function isUatOverrideEnabled(): boolean {
  const v = (process.env.UAT_EMAIL_OVERRIDE || "").trim().toLowerCase();
  return v === "true" || v === "1";
}

function getOverrideRecipients(): string[] {
  return (process.env.OFFICE_NOTIFICATION_EMAILS || "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));
}

export interface UatOverrideResult {
  // When blocked is true the email must NOT be sent at all.
  blocked: boolean;
  to: string[];
  subject: string;
  // True when recipients were rewritten to the UAT override address(es).
  redirected?: boolean;
}

// Exposed for audit logging in sendEmail.
export function isUatOverrideEnabledForAudit(): boolean {
  return isUatOverrideEnabled();
}

// Central helper: applies the UAT recipient override to a single outgoing email.
// Returns the (possibly rewritten) recipients + subject, or blocked=true if the
// override is on but no override recipients are configured (fail safe — never
// fall back to real recipients).
// `bypass` marks account-access emails that must reach the REAL recipient even
// during UAT (login/OTP/verification codes, password resets, and invitations).
// Operational alerts and ordinary notifications must NOT set it.
export function applyUatEmailOverride(to: string[], subject: string, bypass?: boolean): UatOverrideResult {
  if (!isUatOverrideEnabled()) {
    return { blocked: false, to, subject };
  }
  if (bypass) {
    console.log(
      `[UAT EMAIL OVERRIDE] PASS-THROUGH (login/account email): "${subject}" sent to real recipient(s) [${to.join(", ")}]`,
    );
    return { blocked: false, to, subject };
  }

  const originalRecipients = to.join(", ");
  const overrideRecipients = getOverrideRecipients();

  if (overrideRecipients.length === 0) {
    console.warn(
      `[UAT EMAIL OVERRIDE] BLOCKED email "${subject}" to [${originalRecipients}] — UAT_EMAIL_OVERRIDE is on but OFFICE_NOTIFICATION_EMAILS is empty/unset. Email NOT sent.`,
    );
    console.log(`[EMAIL-AUDIT] NOT SENT (UAT override on, no override recipients configured) — intended for [${originalRecipients}], subject "${subject}"`);
    return { blocked: true, to: [], subject };
  }

  const newSubject = `[UAT OVERRIDE — original to: ${originalRecipients}] ${subject}`;
  console.log(
    `[UAT EMAIL OVERRIDE] Redirecting email "${subject}" from [${originalRecipients}] to [${overrideRecipients.join(", ")}]`,
  );
  return { blocked: false, to: overrideRecipients, subject: newSubject, redirected: true };
}

interface EmailParams {
  to: string[];
  from: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  // Always deliver to the real recipient even when UAT_EMAIL_OVERRIDE is on.
  // Reserved for login/account emails (OTP, password reset, invites). Never
  // set for operational alerts, class notifications, or billing mail.
  uatBypass?: boolean;
}

export async function sendEmail(params: EmailParams): Promise<boolean> {
  const override = applyUatEmailOverride(params.to, params.subject, params.uatBypass);
  if (override.blocked) {
    return false;
  }
  const to = override.to;
  const subject = override.subject;

  // Mock mode - log and return success
  if (!isConfigured || !mailService) {
    console.log(`[MOCK EMAIL] To: ${to.join(', ')}, From: ${params.from}, Subject: ${subject}`);
    console.log(`[EMAIL-AUDIT] NOT SENT (mock mode, no SendGrid key) — would deliver to [${to.join(", ")}], subject "${subject}"`);
    return true;
  }

  try {
    const emailData: any = {
      to,
      from: params.from,
      replyTo: params.replyTo || REPLY_TO,
      subject,
    };
    
    if (params.text) emailData.text = params.text;
    if (params.html) emailData.html = params.html;
    
    await mailService.send({ ...emailData, trackingSettings: { clickTracking: { enable: false, enableText: false } } });
    console.log(
      `[EMAIL-AUDIT] SENT to [${to.join(", ")}]${override.redirected ? ` (UAT-redirected from [${params.to.join(", ")}])` : params.uatBypass && isUatOverrideEnabledForAudit() ? " (UAT bypass — real recipient)" : ""} — subject "${subject}"`,
    );
    return true;
  } catch (error) {
    console.error("SendGrid email error:", error);
    console.log(`[EMAIL-AUDIT] NOT SENT (SendGrid error) — intended for [${to.join(", ")}], subject "${subject}"`);
    return false;
  }
}

export async function sendAdminPasswordResetEmail(
  email: string,
  firstName: string,
  resetToken: string
): Promise<boolean> {
  const baseUrl = process.env.APP_URL || process.env.APP_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN || "localhost:5000"}`;
  const resetUrl = `${baseUrl}/admin/reset-password/${resetToken}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 20px; border-radius: 8px;">
      <div style="background: #111111; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
        <h1 style="color: #ECC462; margin: 0; font-size: 24px;">Morty's Driving School</h1>
        <p style="color: #ffffff; margin: 8px 0 0; font-size: 14px;">Admin Portal</p>
      </div>
      <div style="background: #ffffff; padding: 32px; border-radius: 0 0 8px 8px;">
        <h2 style="color: #111111; margin-top: 0;">Password Reset Request</h2>
        <p style="color: #444444;">Hi ${firstName},</p>
        <p style="color: #444444;">We received a request to reset your admin password. Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${resetUrl}" style="background: #ECC462; color: #111111; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">Reset My Password</a>
        </div>
        <p style="color: #888888; font-size: 13px;">If you didn't request this, you can safely ignore this email. Your password won't change.</p>
        <p style="color: #888888; font-size: 12px; word-break: break-all;">Or copy this link: ${resetUrl}</p>
      </div>
    </div>
  `;

  return sendEmail({
    to: [email],
    from: process.env.SENDGRID_FROM_EMAIL || "info@mortysdrivingschool.com",
    replyTo: REPLY_TO,
    subject: "Admin Password Reset — Morty's Driving School",
    text: `Hi ${firstName},\n\nReset your admin password here (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`,
    html,
    uatBypass: true,
  });
}

// ---------------- No-show (missed-class) fee notifications ----------------

const FROM_EMAIL = () => process.env.SENDGRID_FROM_EMAIL || "billing@mortys.ca";

function getOfficeRecipients(): string[] {
  return (process.env.OFFICE_NOTIFICATION_EMAILS || "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));
}

export interface NoShowFeeEmailDetails {
  studentEmail: string;
  studentFirstName: string;
  invoiceNumber: string;
  amount: string; // "50.00"
  classLabel: string; // e.g. "Theory class #3" or "Driving session"
  classSchedule: string; // formatted date/time
}

function noShowEmailShell(inner: string): string {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden;">
    <div style="background:#111111;padding:24px;text-align:center;">
      <h1 style="color:#ECC462;margin:0;font-size:22px;">Morty's Driving School</h1>
    </div>
    <div style="padding:24px;">${inner}</div>
    <div style="background:#f7f7f7;padding:16px;text-align:center;color:#999;font-size:11px;">
      This is an automated message from Morty's Driving School. Please do not reply to this email.
    </div>
  </div>`;
}

/** Notify the student that the missed-class fee was charged to their card. */
export async function sendNoShowFeeChargedEmail(d: NoShowFeeEmailDetails, appUrl: string): Promise<boolean> {
  const inner = `
    <p style="color:#333;">Hi ${d.studentFirstName},</p>
    <p style="color:#333;">You were marked absent for the following class, and per your contract (clause T01731) a missed-class fee was charged to your card on file:</p>
    <table style="width:100%;font-size:14px;color:#333;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:6px 12px;color:#666;">Class:</td><td style="padding:6px 12px;">${d.classLabel}</td></tr>
      <tr><td style="padding:6px 12px;color:#666;">Scheduled:</td><td style="padding:6px 12px;">${d.classSchedule}</td></tr>
      <tr><td style="padding:6px 12px;color:#666;">Invoice:</td><td style="padding:6px 12px;">${d.invoiceNumber}</td></tr>
      <tr><td style="padding:6px 12px;color:#666;font-weight:bold;">Amount charged:</td><td style="padding:6px 12px;font-weight:bold;">$${d.amount}</td></tr>
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="${appUrl}/student/billing" style="background:#ECC462;color:#111111;text-decoration:none;padding:12px 32px;border-radius:6px;font-weight:bold;display:inline-block;">View My Billing</a>
    </div>
    <p style="color:#999;font-size:12px;">If you believe this charge was made in error, please contact the office.</p>`;
  return sendEmail({
    to: [d.studentEmail],
    from: FROM_EMAIL(),
    subject: `Missed-class fee charged — Invoice ${d.invoiceNumber} ($${d.amount})`,
    text: `Hi ${d.studentFirstName},\n\nYou were marked absent for ${d.classLabel} scheduled ${d.classSchedule}. Per your contract (clause T01731), a missed-class fee of $${d.amount} was charged to your card on file (Invoice ${d.invoiceNumber}).\n\nView your billing: ${appUrl}/student/billing\n\nIf you believe this charge was made in error, please contact the office.\n\nMorty's Driving School`,
    html: noShowEmailShell(inner),
  });
}

/**
 * The charge failed (declined card, no card on file, etc.) — tell the student
 * they have an outstanding balance to pay.
 */
export async function sendNoShowFeeUnpaidEmail(d: NoShowFeeEmailDetails, appUrl: string): Promise<boolean> {
  const inner = `
    <p style="color:#333;">Hi ${d.studentFirstName},</p>
    <p style="color:#333;">You were marked absent for the following class. Per your contract (clause T01731), a missed-class fee applies, but we were unable to charge your card. You have an outstanding balance to pay:</p>
    <table style="width:100%;font-size:14px;color:#333;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:6px 12px;color:#666;">Class:</td><td style="padding:6px 12px;">${d.classLabel}</td></tr>
      <tr><td style="padding:6px 12px;color:#666;">Scheduled:</td><td style="padding:6px 12px;">${d.classSchedule}</td></tr>
      <tr><td style="padding:6px 12px;color:#666;">Invoice:</td><td style="padding:6px 12px;">${d.invoiceNumber}</td></tr>
      <tr><td style="padding:6px 12px;color:#666;font-weight:bold;">Amount due:</td><td style="padding:6px 12px;font-weight:bold;">$${d.amount}</td></tr>
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="${appUrl}/student/billing" style="background:#ECC462;color:#111111;text-decoration:none;padding:12px 32px;border-radius:6px;font-weight:bold;display:inline-block;">Pay Invoice Online</a>
    </div>
    <p style="color:#999;font-size:12px;">Log in to your student account to pay this invoice, or contact the office to arrange payment.</p>`;
  return sendEmail({
    to: [d.studentEmail],
    from: FROM_EMAIL(),
    subject: `Missed-class fee — outstanding balance of $${d.amount} (Invoice ${d.invoiceNumber})`,
    text: `Hi ${d.studentFirstName},\n\nYou were marked absent for ${d.classLabel} scheduled ${d.classSchedule}. Per your contract (clause T01731), a missed-class fee of $${d.amount} applies, but we were unable to charge your card. Invoice ${d.invoiceNumber} is outstanding.\n\nPay online: ${appUrl}/student/billing\n\nOr contact the office to arrange payment.\n\nMorty's Driving School`,
    html: noShowEmailShell(inner),
  });
}

/** Alert the office that an automatic no-show fee charge failed. */
export async function sendNoShowFeeFailureOfficeAlert(
  d: NoShowFeeEmailDetails & { studentName: string; failureReason: string },
): Promise<boolean> {
  const office = getOfficeRecipients();
  if (office.length === 0) {
    console.warn("[no-show fee] OFFICE_NOTIFICATION_EMAILS not configured — office failure alert not sent");
    return false;
  }
  const inner = `
    <p style="color:#333;">An automatic missed-class fee charge <strong>failed</strong> and needs follow-up:</p>
    <table style="width:100%;font-size:14px;color:#333;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:6px 12px;color:#666;">Student:</td><td style="padding:6px 12px;">${d.studentName} (${d.studentEmail})</td></tr>
      <tr><td style="padding:6px 12px;color:#666;">Class:</td><td style="padding:6px 12px;">${d.classLabel}</td></tr>
      <tr><td style="padding:6px 12px;color:#666;">Scheduled:</td><td style="padding:6px 12px;">${d.classSchedule}</td></tr>
      <tr><td style="padding:6px 12px;color:#666;">Invoice:</td><td style="padding:6px 12px;">${d.invoiceNumber}</td></tr>
      <tr><td style="padding:6px 12px;color:#666;">Amount:</td><td style="padding:6px 12px;">$${d.amount}</td></tr>
      <tr><td style="padding:6px 12px;color:#666;">Reason:</td><td style="padding:6px 12px;">${d.failureReason}</td></tr>
    </table>
    <p style="color:#999;font-size:12px;">The student has been notified that they have an outstanding balance.</p>`;
  return sendEmail({
    to: office,
    from: FROM_EMAIL(),
    subject: `[Action needed] Missed-class fee charge failed — ${d.studentName}, Invoice ${d.invoiceNumber} ($${d.amount})`,
    text: `An automatic missed-class fee charge failed.\n\nStudent: ${d.studentName} (${d.studentEmail})\nClass: ${d.classLabel}\nScheduled: ${d.classSchedule}\nInvoice: ${d.invoiceNumber}\nAmount: $${d.amount}\nReason: ${d.failureReason}\n\nThe student has been notified that they have an outstanding balance.`,
    html: noShowEmailShell(inner),
    uatBypass: true, // staff/office alert — always deliver to the real office inbox
  });
}

export async function sendIncarCancellationFeeEmail(
  d: NoShowFeeEmailDetails,
  appUrl: string,
  charged: boolean,
): Promise<boolean> {
  const disposition = charged
    ? "was charged to your saved card"
    : "could not be charged and remains due";
  const inner = `
    <p style="color:#333;">Hi ${d.studentFirstName},</p>
    <p style="color:#333;">Your In-Car 12/13 seat was cancelled less than 24 hours before its scheduled start. The $100.00 cancellation fee plus applicable taxes ${disposition}.</p>
    <table style="width:100%;font-size:14px;color:#333;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:6px 12px;color:#666;">Scheduled:</td><td style="padding:6px 12px;">${d.classSchedule}</td></tr>
      <tr><td style="padding:6px 12px;color:#666;">Invoice:</td><td style="padding:6px 12px;">${d.invoiceNumber}</td></tr>
      <tr><td style="padding:6px 12px;color:#666;font-weight:bold;">${charged ? "Amount charged" : "Amount due"}:</td><td style="padding:6px 12px;font-weight:bold;">$${d.amount}</td></tr>
    </table>
    <div style="text-align:center;margin:24px 0;"><a href="${appUrl}/student/billing" style="background:#ECC462;color:#111;text-decoration:none;padding:12px 32px;border-radius:6px;font-weight:bold;display:inline-block;">View My Billing</a></div>`;
  return sendEmail({
    to: [d.studentEmail],
    from: FROM_EMAIL(),
    subject: `In-Car 12/13 cancellation fee ${charged ? "charged" : "due"} — Invoice ${d.invoiceNumber} ($${d.amount})`,
    text: `Hi ${d.studentFirstName},\n\nYour In-Car 12/13 seat scheduled ${d.classSchedule} was cancelled less than 24 hours before class. Invoice ${d.invoiceNumber} for $${d.amount} ${disposition}.\n\nView billing: ${appUrl}/student/billing`,
    html: noShowEmailShell(inner),
  });
}

export async function sendIncarCancellationFeeOfficeAlert(
  d: NoShowFeeEmailDetails & { studentName: string; failureReason: string },
): Promise<boolean> {
  const office = getOfficeRecipients();
  if (office.length === 0) {
    console.warn("[In-Car 12/13 cancellation fee] OFFICE_NOTIFICATION_EMAILS not configured");
    return false;
  }
  return sendEmail({
    to: office,
    from: FROM_EMAIL(),
    subject: `[Action needed] In-Car 12/13 cancellation invoice unpaid — ${d.studentName}, ${d.invoiceNumber}`,
    text: `The automatic cancellation-fee charge failed.\nStudent: ${d.studentName} (${d.studentEmail})\nScheduled: ${d.classSchedule}\nInvoice: ${d.invoiceNumber}\nAmount due: $${d.amount}\nReason: ${d.failureReason}`,
    html: noShowEmailShell(`<p>An automatic In-Car 12/13 cancellation-fee charge failed and the invoice remains due.</p><p><strong>${d.studentName}</strong> — ${d.invoiceNumber}, $${d.amount}<br/>${d.classSchedule}<br/>Reason: ${d.failureReason}</p>`),
  });
}

export async function sendBulkEmail(
  recipients: string[],
  from: string,
  subject: string,
  text: string,
  html?: string,
): Promise<{ success: boolean; sentCount: number; errors: string[] }> {
  const results = {
    success: true,
    sentCount: 0,
    errors: [] as string[],
  };

  // Mock mode - log and return success
  if (!isConfigured || !mailService) {
    console.log(`[MOCK BULK EMAIL] Sending to ${recipients.length} recipients`);
    console.log(`  From: ${from}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Recipients: ${recipients.join(', ')}`);
    console.log(`[EMAIL-AUDIT] NOT SENT (mock mode, no SendGrid key) — bulk email would deliver to [${recipients.join(", ")}], subject "${subject}"`);
    results.sentCount = recipients.length;
    return results;
  }

  // Send emails individually to each recipient to avoid batch permission issues
  console.log(`Starting to send ${recipients.length} individual emails...`);
  
  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];

    // Apply the UAT override per-recipient so the subject marker shows who
    // this specific email was originally meant for.
    const override = applyUatEmailOverride([recipient], subject);
    if (override.blocked) {
      results.errors.push(`Blocked by UAT email override (no override recipients configured): ${recipient}`);
      results.success = false;
      continue;
    }

    try {
      await mailService.send({
        to: override.to,
        from: from,
        replyTo: REPLY_TO,
        subject: override.subject,
        text: text,
        html: html,
        trackingSettings: { clickTracking: { enable: false, enableText: false } },
      });
      results.sentCount++;
      console.log(`✓ Email ${i + 1}/${recipients.length} sent successfully to ${recipient}`);
      console.log(`[EMAIL-AUDIT] SENT to [${override.to.join(", ")}]${override.redirected ? ` (UAT-redirected from [${recipient}])` : ""} — bulk email, subject "${override.subject}"`);
    } catch (error: any) {
      const errorMessage = error?.response?.body?.errors?.[0]?.message || error?.message || String(error);
      console.error(`✗ Failed to send email to ${recipient}:`, errorMessage);
      console.log(`[EMAIL-AUDIT] NOT SENT (SendGrid error) — bulk email intended for [${override.to.join(", ")}] (original recipient ${recipient}), subject "${override.subject}"`);
      results.errors.push(`Failed to send to ${recipient}: ${errorMessage}`);
      results.success = false;
    }
  }

  console.log(`Email sending complete: ${results.sentCount}/${recipients.length} sent successfully`);
  return results;
}
