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
