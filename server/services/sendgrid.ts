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

// UAT email override: when UAT_EMAIL_OVERRIDE is true/1, ALL outgoing emails
// are redirected to OFFICE_NOTIFICATION_EMAILS so no real students/parents/staff
// receive mail during UAT with imported live data.
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
}

// Central helper: applies the UAT recipient override to a single outgoing email.
// Returns the (possibly rewritten) recipients + subject, or blocked=true if the
// override is on but no override recipients are configured (fail safe — never
// fall back to real recipients).
// `bypass` marks emails that must always reach the REAL recipient even during
// UAT (login/OTP/verification codes, password resets, invitations, and
// staff/office alerts). Class-update, billing, and bulk/scheduled emails must
// NOT set it.
export function applyUatEmailOverride(to: string[], subject: string, bypass?: boolean): UatOverrideResult {
  if (!isUatOverrideEnabled()) {
    return { blocked: false, to, subject };
  }
  if (bypass) {
    console.log(
      `[UAT EMAIL OVERRIDE] PASS-THROUGH (login/account or staff alert): "${subject}" sent to real recipient(s) [${to.join(", ")}]`,
    );
    return { blocked: false, to, subject };
  }

  const originalRecipients = to.join(", ");
  const overrideRecipients = getOverrideRecipients();

  if (overrideRecipients.length === 0) {
    console.warn(
      `[UAT EMAIL OVERRIDE] BLOCKED email "${subject}" to [${originalRecipients}] — UAT_EMAIL_OVERRIDE is on but OFFICE_NOTIFICATION_EMAILS is empty/unset. Email NOT sent.`,
    );
    return { blocked: true, to: [], subject };
  }

  const newSubject = `[UAT OVERRIDE — original to: ${originalRecipients}] ${subject}`;
  console.log(
    `[UAT EMAIL OVERRIDE] Redirecting email "${subject}" from [${originalRecipients}] to [${overrideRecipients.join(", ")}]`,
  );
  return { blocked: false, to: overrideRecipients, subject: newSubject };
}

interface EmailParams {
  to: string[];
  from: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  // Always deliver to the real recipient even when UAT_EMAIL_OVERRIDE is on.
  // Reserved for login/account emails (OTP, password reset, invites) and
  // staff/office alerts. Never set for student/parent class or billing mail.
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
    return true;
  } catch (error) {
    console.error("SendGrid email error:", error);
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
    } catch (error: any) {
      const errorMessage = error?.response?.body?.errors?.[0]?.message || error?.message || String(error);
      console.error(`✗ Failed to send email to ${recipient}:`, errorMessage);
      results.errors.push(`Failed to send to ${recipient}: ${errorMessage}`);
      results.success = false;
    }
  }

  console.log(`Email sending complete: ${results.sentCount}/${recipients.length} sent successfully`);
  return results;
}
