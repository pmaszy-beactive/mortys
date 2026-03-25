import crypto from "crypto";
import sgMail from "@sendgrid/mail";

sgMail.setApiKey(process.env.SENDGRID_API_KEY || "");

export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function getInviteExpiry(): Date {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 7); // 7 days from now
  return expiry;
}

function getBaseUrl(): string {
  return "https://morty.empowerdemos.com";
}

export async function sendInstructorInviteEmail(
  email: string,
  firstName: string,
  inviteToken: string,
): Promise<void> {
  const baseUrl = getBaseUrl();
  const inviteLink = `${baseUrl}/instructor-invite/${inviteToken}`;
  const msg = {
    to: email,
    from: process.env.SENDGRID_FROM_EMAIL || "info@mortys.ca",
    subject: "You've Been Invited to Join Morty's Driving School",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #111111 0%, #2c2c2c 100%); color: #ECC462; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { padding: 30px; background-color: #f9fafb; }
          .button { display: inline-block; padding: 14px 35px; background-color: #ECC462; color: #111111; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: bold; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
          .highlight { color: #ECC462; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 28px;">Welcome to Morty's Driving School!</h1>
          </div>
          <div class="content">
            <p>Hi ${firstName},</p>
            <p>You've been invited to join <span class="highlight">Morty's Driving School</span> as an instructor. We're excited to have you on our team!</p>
            <p>To get started, please click the button below to set up your account:</p>
            <div style="text-align: center;">
              <a href="${inviteLink}" class="button">Accept Invitation</a>
            </div>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #ECC462;">${inviteLink}</p>
            <p><strong>⏰ This invitation link will expire in 7 days.</strong></p>
            <p>During the setup process, you'll be asked to:</p>
            <ul>
              <li>Create a secure password</li>
              <li>Review and accept our terms and conditions</li>
              <li>Complete your instructor profile</li>
            </ul>
            <p>If you have any questions, please don't hesitate to contact our administration team.</p>
            <p>Best regards,<br><span class="highlight">Morty's Driving School Team</span></p>
          </div>
          <div class="footer">
            <p>This is an automated message. Please do not reply to this email.</p>
            <p>&copy; ${new Date().getFullYear()} Morty's Driving School. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
Hi ${firstName},

You've been invited to join Morty's Driving School as an instructor. We're excited to have you on our team!

To get started, please visit the following link to set up your account:
${inviteLink}

This invitation link will expire in 7 days.

During the setup process, you'll be asked to:
- Create a secure password
- Review and accept our terms and conditions
- Complete your instructor profile

If you have any questions, please don't hesitate to contact our administration team.

Best regards,
Morty's Driving School Team
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`Invite email sent to ${email}`);
  } catch (error) {
    console.error("Error sending invite email:", error);
    throw new Error("Failed to send invite email");
  }
}

export async function sendPasswordResetEmail(
  email: string,
  firstName: string,
  resetToken: string,
): Promise<void> {
  const baseUrl = getBaseUrl();
  const resetLink = `${baseUrl}/student/reset-password/${resetToken}`;
  console.log(`Password reset link generated: ${resetLink}`);

  const msg = {
    to: email,
    from: process.env.SENDGRID_FROM_EMAIL || "info@mortys.ca",
    subject: "Reset Your Password - Morty's Driving School",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #111111 0%, #2c2c2c 100%); color: #ECC462; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { padding: 30px; background-color: #f9fafb; }
          .button { display: inline-block; padding: 14px 35px; background-color: #ECC462; color: #111111; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: bold; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
          .highlight { color: #ECC462; font-weight: bold; }
          .warning { background: #fff4e6; border-left: 4px solid #ECC462; padding: 15px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 28px;">🔐 Password Reset Request</h1>
          </div>
          <div class="content">
            <p>Hi ${firstName},</p>
            <p>We received a request to reset your password for your <span class="highlight">Morty's Driving School</span> student account.</p>
            <p>Click the button below to create a new password:</p>
            <div style="text-align: center;">
              <a href="${resetLink}" class="button">Reset My Password</a>
            </div>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #ECC462;">${resetLink}</p>
            <div class="warning">
              <p style="margin: 0;"><strong>⏰ This link will expire in 1 hour for security reasons.</strong></p>
            </div>
            <p><strong>Important:</strong></p>
            <ul>
              <li>If you didn't request this password reset, please ignore this email</li>
              <li>Your password will remain unchanged until you create a new one</li>
              <li>Never share your password with anyone</li>
            </ul>
            <p>If you need assistance, please contact our support team.</p>
            <p>Best regards,<br><span class="highlight">Morty's Driving School Team</span></p>
          </div>
          <div class="footer">
            <p>This is an automated message. Please do not reply to this email.</p>
            <p>&copy; ${new Date().getFullYear()} Morty's Driving School. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
Hi ${firstName},

We received a request to reset your password for your Morty's Driving School student account.

To create a new password, please visit the following link:
${resetLink}

This link will expire in 1 hour for security reasons.

Important:
- If you didn't request this password reset, please ignore this email
- Your password will remain unchanged until you create a new one
- Never share your password with anyone

If you need assistance, please contact our support team.

Best regards,
Morty's Driving School Team
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`Password reset email sent to ${email}`);
  } catch (error) {
    console.error("Error sending password reset email:", error);
    throw new Error("Failed to send password reset email");
  }
}

export async function sendStudentInviteEmail(
  email: string,
  firstName: string,
  inviteToken: string,
): Promise<void> {
  const baseUrl = getBaseUrl();
  const inviteLink = `${baseUrl}/student-invite/${inviteToken}`;
  console.log(`Student invite link generated: ${inviteLink}`);

  const msg = {
    to: email,
    from: process.env.SENDGRID_FROM_EMAIL || "info@mortys.ca",
    subject: "Welcome to Morty's Driving School - Set Up Your Account",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #111111 0%, #2c2c2c 100%); color: #ECC462; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { padding: 30px; background-color: #f9fafb; }
          .button { display: inline-block; padding: 14px 35px; background-color: #ECC462; color: #111111; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: bold; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
          .highlight { color: #ECC462; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 28px;">🎓 Welcome to Morty's Driving School!</h1>
          </div>
          <div class="content">
            <p>Hi ${firstName},</p>
            <p>Congratulations on taking the first step toward getting your driver's license! We're thrilled to have you join <span class="highlight">Morty's Driving School</span>.</p>
            <p>To access your student portal and get started with your driving courses, please click the button below to set up your account:</p>
            <div style="text-align: center;">
              <a href="${inviteLink}" class="button">Set Up My Account</a>
            </div>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #ECC462;">${inviteLink}</p>
            <p><strong>⏰ This invitation link will expire in 7 days.</strong></p>
            <p>During the setup process, you'll:</p>
            <ul>
              <li>Create a secure password for your account</li>
              <li>Access your personalized student dashboard</li>
              <li>View your class schedule and progress</li>
              <li>Track your driving evaluations</li>
            </ul>
            <p>Once you're logged in, you'll be able to:</p>
            <ul>
              <li>📅 See your upcoming theory classes and driving sessions</li>
              <li>📊 Monitor your learning progress in real-time</li>
              <li>📝 Review your instructor evaluations</li>
              <li>💳 Manage your payments and contracts</li>
            </ul>
            <p>If you have any questions, please don't hesitate to contact our support team.</p>
            <p>Best regards,<br><span class="highlight">Morty's Driving School Team</span></p>
          </div>
          <div class="footer">
            <p>This is an automated message. Please do not reply to this email.</p>
            <p>&copy; ${new Date().getFullYear()} Morty's Driving School. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
Hi ${firstName},

Congratulations on taking the first step toward getting your driver's license! We're thrilled to have you join Morty's Driving School.

To access your student portal and get started with your driving courses, please visit the following link to set up your account:
${inviteLink}

This invitation link will expire in 7 days.

During the setup process, you'll:
- Create a secure password for your account
- Access your personalized student dashboard
- View your class schedule and progress
- Track your driving evaluations

Once you're logged in, you'll be able to:
- See your upcoming theory classes and driving sessions
- Monitor your learning progress in real-time
- Review your instructor evaluations
- Manage your payments and contracts

If you have any questions, please don't hesitate to contact our support team.

Best regards,
Morty's Driving School Team
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`Student invite email sent to ${email}`);
  } catch (error) {
    console.error("Error sending student invite email:", error);
    throw new Error("Failed to send student invite email");
  }
}

export async function sendParentInviteEmail(
  email: string,
  firstName: string,
  inviteToken: string,
  studentFirstName: string,
  studentLastName: string,
): Promise<void> {
  const baseUrl = getBaseUrl();
  const inviteLink = `${baseUrl}/parent-invite/${inviteToken}`;
  
  const msg = {
    to: email,
    from: process.env.SENDGRID_FROM_EMAIL || "info@mortys.ca",
    subject: `${studentFirstName} ${studentLastName} Has Added You as a Parent/Guardian`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #111111 0%, #2c2c2c 100%); color: #ECC462; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { padding: 30px; background-color: #f9fafb; }
          .button { display: inline-block; padding: 14px 35px; background-color: #ECC462; color: #111111; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: bold; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
          .highlight { color: #ECC462; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 28px;">Parent/Guardian Access Invitation</h1>
          </div>
          <div class="content">
            <p>Hi ${firstName},</p>
            <p><strong>${studentFirstName} ${studentLastName}</strong> has added you as a parent/guardian to their account at <span class="highlight">Morty's Driving School</span>.</p>
            <p>This gives you access to monitor their driving education progress, view their schedule, and manage their account based on the permissions they've granted you.</p>
            <p>To get started, please click the button below to set up your parent portal account:</p>
            <div style="text-align: center;">
              <a href="${inviteLink}" class="button">Accept Invitation</a>
            </div>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #ECC462;">${inviteLink}</p>
            <p><strong>⏰ This invitation link will expire in 7 days.</strong></p>
            <p>During the setup process, you'll:</p>
            <ul>
              <li>🔐 Create a secure password for your account</li>
              <li>📱 Access the parent/guardian portal</li>
              <li>👀 View your student's progress and schedule</li>
            </ul>
            <p>Once logged in, you'll be able to:</p>
            <ul>
              <li>📊 Track ${studentFirstName}'s learning progress</li>
              <li>📅 View upcoming classes and sessions</li>
              <li>📝 Read instructor evaluations</li>
              <li>💳 Manage payments (if authorized)</li>
              <li>📆 Book classes (if authorized)</li>
            </ul>
            <p>If you have any questions, please don't hesitate to contact our support team.</p>
            <p>Best regards,<br><span class="highlight">Morty's Driving School Team</span></p>
          </div>
          <div class="footer">
            <p>This is an automated message. Please do not reply to this email.</p>
            <p>&copy; ${new Date().getFullYear()} Morty's Driving School. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
Hi ${firstName},

${studentFirstName} ${studentLastName} has added you as a parent/guardian to their account at Morty's Driving School.

This gives you access to monitor their driving education progress, view their schedule, and manage their account based on the permissions they've granted you.

To get started, please visit the following link to set up your parent portal account:
${inviteLink}

This invitation link will expire in 7 days.

During the setup process, you'll:
- Create a secure password for your account
- Access the parent/guardian portal
- View your student's progress and schedule

Once logged in, you'll be able to:
- Track ${studentFirstName}'s learning progress
- View upcoming classes and sessions
- Read instructor evaluations
- Manage payments (if authorized)
- Book classes (if authorized)

If you have any questions, please don't hesitate to contact our support team.

Best regards,
Morty's Driving School Team
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`Parent invite email sent to ${email}`);
  } catch (error) {
    console.error("Error sending parent invite email:", error);
    throw new Error("Failed to send parent invite email");
  }
}

// Policy Override Notification Email
export interface PolicyOverrideNotificationParams {
  recipientEmails: string[];
  staffName: string;
  studentName: string;
  actionType: string; // book, edit, cancel, reschedule
  policyType: string; // max_duration, max_bookings_per_day, etc.
  reason: string;
  classInfo: string;
  originalValue: string;
  overriddenValue: string;
  overrideDate: Date;
}

export async function sendPolicyOverrideNotification(
  params: PolicyOverrideNotificationParams
): Promise<string[]> {
  const {
    recipientEmails,
    staffName,
    studentName,
    actionType,
    policyType,
    reason,
    classInfo,
    originalValue,
    overriddenValue,
    overrideDate
  } = params;

  const formattedDate = overrideDate.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const policyTypeLabels: Record<string, string> = {
    'max_duration': 'Maximum Class Duration',
    'max_bookings_per_day': 'Maximum Bookings Per Day',
    'advance_booking_days': 'Advance Booking Days Limit'
  };

  const actionTypeLabels: Record<string, string> = {
    'book': 'Class Booking',
    'edit': 'Class Edit',
    'cancel': 'Class Cancellation',
    'reschedule': 'Class Reschedule'
  };

  const successfulRecipients: string[] = [];

  for (const email of recipientEmails) {
    const msg = {
      to: email,
      from: process.env.SENDGRID_FROM_EMAIL || "info@mortys.ca",
      subject: `Policy Override Alert - ${actionTypeLabels[actionType] || actionType}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #111111 0%, #2c2c2c 100%); color: #ECC462; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { padding: 30px; background-color: #f9fafb; }
            .alert-box { background: #fff4e6; border-left: 4px solid #ECC462; padding: 15px; margin: 20px 0; }
            .detail-row { display: flex; margin: 10px 0; border-bottom: 1px solid #eee; padding-bottom: 10px; }
            .detail-label { font-weight: bold; width: 150px; color: #666; }
            .detail-value { flex: 1; }
            .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
            .highlight { color: #ECC462; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0; font-size: 24px;">Policy Override Notification</h1>
            </div>
            <div class="content">
              <div class="alert-box">
                <p style="margin: 0;"><strong>A booking policy has been overridden.</strong></p>
              </div>
              
              <h3 style="color: #111; border-bottom: 2px solid #ECC462; padding-bottom: 10px;">Override Details</h3>
              
              <div class="detail-row">
                <span class="detail-label">Staff Member:</span>
                <span class="detail-value">${staffName}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Student:</span>
                <span class="detail-value">${studentName}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Action:</span>
                <span class="detail-value">${actionTypeLabels[actionType] || actionType}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Policy Overridden:</span>
                <span class="detail-value">${policyTypeLabels[policyType] || policyType}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Policy Limit:</span>
                <span class="detail-value">${originalValue}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Override Value:</span>
                <span class="detail-value">${overriddenValue}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Class Info:</span>
                <span class="detail-value">${classInfo}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Date/Time:</span>
                <span class="detail-value">${formattedDate}</span>
              </div>
              
              <h3 style="color: #111; border-bottom: 2px solid #ECC462; padding-bottom: 10px; margin-top: 30px;">Override Reason</h3>
              <p style="background: #f5f5f5; padding: 15px; border-radius: 5px; font-style: italic;">"${reason}"</p>
              
              <p style="margin-top: 30px; font-size: 12px; color: #666;">
                This is an automated notification from the Morty's Driving School management system. 
                This override has been logged for audit and compliance purposes.
              </p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} Morty's Driving School. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
Policy Override Notification

A booking policy has been overridden.

Override Details:
- Staff Member: ${staffName}
- Student: ${studentName}
- Action: ${actionTypeLabels[actionType] || actionType}
- Policy Overridden: ${policyTypeLabels[policyType] || policyType}
- Policy Limit: ${originalValue}
- Override Value: ${overriddenValue}
- Class Info: ${classInfo}
- Date/Time: ${formattedDate}

Override Reason:
"${reason}"

This is an automated notification from the Morty's Driving School management system.
This override has been logged for audit and compliance purposes.
      `
    };

    try {
      await sgMail.send(msg);
      console.log(`Policy override notification sent to ${email}`);
      successfulRecipients.push(email);
    } catch (error) {
      console.error(`Error sending policy override notification to ${email}:`, error);
    }
  }

  return successfulRecipients;
}
