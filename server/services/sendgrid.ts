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

interface EmailParams {
  to: string[];
  from: string;
  subject: string;
  text?: string;
  html?: string;
}

export async function sendEmail(params: EmailParams): Promise<boolean> {
  // Mock mode - log and return success
  if (!isConfigured || !mailService) {
    console.log(`[MOCK EMAIL] To: ${params.to.join(', ')}, From: ${params.from}, Subject: ${params.subject}`);
    return true;
  }

  try {
    const emailData: any = {
      to: params.to,
      from: params.from,
      subject: params.subject,
    };
    
    if (params.text) emailData.text = params.text;
    if (params.html) emailData.html = params.html;
    
    await mailService.send(emailData);
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
  const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0] || "localhost:5000"}`;
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
    from: "noreply@mortysdriving.com",
    subject: "Admin Password Reset — Morty's Driving School",
    text: `Hi ${firstName},\n\nReset your admin password here (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`,
    html,
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

    try {
      await mailService.send({
        to: recipient,
        from: from,
        subject: subject,
        text: text,
        html: html,
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
