import { storage } from "./storage";
import sgMail from "@sendgrid/mail";
import * as notificationService from "./services/notifications";

const CHECK_INTERVAL = 60000; // Check every minute
const REMINDER_HOURS_BEFORE = 24; // Send reminder 24 hours before class

let intervalId: NodeJS.Timeout | null = null;

async function processScheduledMessages() {
  try {
    const communications = await storage.getCommunications();
    const now = new Date();
    
    // Find scheduled messages that should be sent now
    const messagesToSend = communications.filter(comm => {
      if (comm.status !== 'scheduled' || !comm.sendDate) {
        return false;
      }
      
      const sendDate = new Date(comm.sendDate);
      return sendDate <= now;
    });
    
    if (messagesToSend.length === 0) {
      return;
    }
    
    console.log(`[SCHEDULED-MESSAGES] Found ${messagesToSend.length} messages to send`);
    
    for (const message of messagesToSend) {
      try {
        // Get recipient emails (for now, skip if recipients is not an array)
        if (!Array.isArray(message.recipients) || message.recipients.length === 0) {
          console.log(`[SCHEDULED-MESSAGES] No recipients for message ${message.id}, skipping`);
          continue;
        }
        
        // For scheduled messages, recipients should already be email addresses
        // In production, you would resolve recipient groups to actual emails
        const recipientEmails = message.recipients.filter((r): r is string => typeof r === 'string' && r.includes('@'));
        
        if (recipientEmails.length === 0) {
          console.log(`[SCHEDULED-MESSAGES] No valid email addresses for message ${message.id}, skipping`);
          continue;
        }
        
        // Send the email using SendGrid
        const fromEmail = process.env.SENDGRID_FROM_EMAIL || "info@mortys.ca";
        
        await sgMail.send({
          to: recipientEmails,
          from: fromEmail,
          subject: message.subject,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #111111 0%, #2d2d2d 100%); padding: 30px; text-align: center;">
                <h1 style="color: #ECC462; margin: 0; font-size: 28px;">Morty's Driving School</h1>
              </div>
              <div style="background: #ffffff; padding: 40px; border-left: 4px solid #ECC462;">
                <h2 style="color: #111111; margin-top: 0;">${message.subject}</h2>
                <div style="color: #333333; line-height: 1.6; white-space: pre-wrap;">
                  ${message.message}
                </div>
              </div>
              <div style="background: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666;">
                <p>This message was sent from Morty's Driving School Management System</p>
              </div>
            </div>
          `,
        });
        
        // Update message status to sent
        await storage.updateCommunication(message.id, {
          status: 'sent',
        });
        
        console.log(`[SCHEDULED-MESSAGES] Successfully sent message ${message.id} to ${recipientEmails.length} recipients`);
      } catch (error) {
        console.error(`[SCHEDULED-MESSAGES] Error sending message ${message.id}:`, error);
        
        // Mark as failed
        await storage.updateCommunication(message.id, {
          status: 'failed',
        });
      }
    }
  } catch (error) {
    console.error('[SCHEDULED-MESSAGES] Error processing scheduled messages:', error);
  }
}


// Check for upcoming classes and send reminders
async function processUpcomingClassReminders() {
  try {
    const classes = await storage.getClasses();
    const now = new Date();
    const reminderWindow = new Date(now.getTime() + (REMINDER_HOURS_BEFORE * 60 * 60 * 1000));
    
    // Find classes happening within the next 24 hours
    const upcomingClasses = classes.filter(cls => {
      if (!cls.date || !cls.time) return false;
      
      // Parse the scheduled date and time
      const classDateTime = new Date(`${cls.date}T${cls.time}`);
      
      // Check if class is within reminder window and in the future
      return classDateTime > now && classDateTime <= reminderWindow && cls.status === 'scheduled';
    });
    
    if (upcomingClasses.length === 0) {
      return;
    }
    
    console.log(`[SCHEDULED-MESSAGES] Found ${upcomingClasses.length} upcoming classes for reminders`);
    
    for (const cls of upcomingClasses) {
      try {
        // Get instructor name if assigned
        let instructorName: string | undefined;
        if (cls.instructorId) {
          const instructor = await storage.getInstructor(cls.instructorId);
          if (instructor) {
            instructorName = `${instructor.firstName} ${instructor.lastName}`;
          }
        }
        
        // Generate class title from course type and class number
        const classTitle = `${cls.courseType.charAt(0).toUpperCase() + cls.courseType.slice(1)} - Class ${cls.classNumber}`;
        
        // Calculate end time based on duration
        const startTime = cls.time;
        const startDate = new Date(`2000-01-01T${cls.time}`);
        const endDate = new Date(startDate.getTime() + (cls.duration * 60 * 1000));
        const endTime = endDate.toTimeString().slice(0, 5);
        
        await notificationService.notifyUpcomingClass({
          id: cls.id,
          title: classTitle,
          scheduledDate: cls.date,
          startTime,
          endTime,
          instructorName,
          location: cls.room || undefined,
        });
        
        console.log(`[SCHEDULED-MESSAGES] Sent reminder for class ${cls.id}: ${classTitle}`);
      } catch (error) {
        console.error(`[SCHEDULED-MESSAGES] Error sending reminder for class ${cls.id}:`, error);
      }
    }
  } catch (error) {
    console.error('[SCHEDULED-MESSAGES] Error processing upcoming class reminders:', error);
  }
}

export function startScheduledMessageWorker() {
  if (intervalId) {
    console.log('[SCHEDULED-MESSAGES] Worker already running');
    return;
  }
  
  console.log('[SCHEDULED-MESSAGES] Starting scheduled message worker');
  
  // Run immediately
  processScheduledMessages();
  processUpcomingClassReminders();
  
  // Then run every minute for scheduled messages
  intervalId = setInterval(() => {
    processScheduledMessages();
    // Only check reminders every 15 minutes to avoid duplicates
    if (new Date().getMinutes() % 15 === 0) {
      processUpcomingClassReminders();
    }
  }, CHECK_INTERVAL);
}

export function stopScheduledMessageWorker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[SCHEDULED-MESSAGES] Stopped scheduled message worker');
  }
}
