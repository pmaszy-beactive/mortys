import { storage } from "../storage";
import { ZoomMeeting, InsertZoomMeeting, ZoomAttendance, InsertZoomAttendance, Class } from "@shared/schema";

interface ZoomConfig {
  apiKey: string;
  apiSecret: string;
  webhookSecret?: string;
}

interface ZoomMeetingResponse {
  id: string;
  uuid: string;
  join_url: string;
  start_url: string;
  password?: string;
  status: string;
}

interface ZoomParticipant {
  id: string;
  name: string;
  user_email: string;
  join_time: string;
  leave_time: string;
  duration: number;
}

interface ZoomAttendanceReport {
  participants: ZoomParticipant[];
  total_records: number;
}

export class ZoomService {
  private config: ZoomConfig;
  private baseUrl = 'https://api.zoom.us/v2';

  constructor(config: ZoomConfig) {
    this.config = config;
  }

  private async generateAccessToken(): Promise<string> {
    // JWT token generation for Zoom API
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };

    const payload = {
      iss: this.config.apiKey,
      exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour expiration
    };

    // In a real implementation, you would use a proper JWT library
    // For now, we'll return a placeholder that would be replaced with actual JWT generation
    return 'jwt_token_placeholder';
  }

  private async makeZoomRequest(endpoint: string, method: string = 'GET', data?: any): Promise<any> {
    const token = await this.generateAccessToken();
    
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Zoom API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async createMeeting(classData: Class): Promise<ZoomMeeting> {
    const meetingData = {
      topic: `${classData.courseType} - Class ${classData.classNumber}`,
      type: 2, // Scheduled meeting
      start_time: `${classData.date}T${classData.time}:00`,
      duration: classData.duration,
      timezone: 'America/New_York',
      settings: {
        host_video: true,
        participant_video: true,
        waiting_room: true,
        mute_upon_entry: true,
        approval_type: 0, // Automatically approve
        registration_type: 1, // Attendees register once
        enforce_login: false,
        auto_recording: 'cloud', // Automatically record to cloud
      }
    };

    try {
      const zoomResponse: ZoomMeetingResponse = await this.makeZoomRequest('/users/me/meetings', 'POST', meetingData);
      
      const zoomMeetingData: InsertZoomMeeting = {
        classId: classData.id,
        zoomMeetingId: zoomResponse.id,
        meetingUuid: zoomResponse.uuid,
        joinUrl: zoomResponse.join_url,
        startUrl: zoomResponse.start_url,
        passcode: zoomResponse.password || null,
        status: 'scheduled',
        actualStartTime: null,
        actualEndTime: null,
      };

      const meeting = await storage.createZoomMeeting(zoomMeetingData);
      
      // Update the class with the Zoom link
      await storage.updateClass(classData.id, {
        zoomLink: zoomResponse.join_url
      });

      return meeting;
    } catch (error) {
      console.error('Error creating Zoom meeting:', error);
      throw new Error('Failed to create Zoom meeting');
    }
  }

  async getAttendanceReport(meetingUuid: string): Promise<ZoomAttendanceReport> {
    try {
      const response = await this.makeZoomRequest(`/report/meetings/${meetingUuid}/participants`);
      return response;
    } catch (error) {
      console.error('Error fetching attendance report:', error);
      throw new Error('Failed to fetch attendance report');
    }
  }

  async processAttendanceReport(zoomMeetingId: number): Promise<void> {
    try {
      const meeting = await storage.getZoomMeeting(zoomMeetingId);
      if (!meeting || !meeting.meetingUuid) {
        throw new Error('Meeting not found or missing UUID');
      }

      const attendanceReport = await this.getAttendanceReport(meeting.meetingUuid);
      const settings = await storage.getZoomSettings();
      
      // Get enrolled students for this class
      const enrollments = await storage.getClassEnrollmentsByClass(meeting.classId);
      
      for (const participant of attendanceReport.participants) {
        // Try to match participant with enrolled student
        const matchedEnrollment = enrollments.find(enrollment => {
          // Match by email or name - this could be enhanced with better matching logic
          return participant.user_email && participant.user_email.toLowerCase().includes(enrollment.studentId.toString());
        });

        if (matchedEnrollment) {
          const duration = Math.floor(participant.duration / 60); // Convert to minutes
          
          // Determine attendance status based on settings
          let attendanceStatus = 'absent';
          if (settings.autoMarkAttendance) {
            const meetingDuration = 60; // Default meeting duration in minutes
            const attendancePercentage = (duration / meetingDuration) * 100;
            
            if (duration >= settings.minimumAttendanceMinutes && 
                attendancePercentage >= settings.minimumAttendancePercentage) {
              attendanceStatus = 'present';
            } else if (duration > 0) {
              attendanceStatus = 'partial';
            }
          }

          const attendanceData: InsertZoomAttendance = {
            zoomMeetingId: meeting.id,
            studentId: matchedEnrollment.studentId!,
            participantName: participant.name,
            joinTime: new Date(participant.join_time),
            leaveTime: new Date(participant.leave_time),
            duration,
            attendanceStatus,
            isManuallyAdjusted: false,
            adjustedBy: null,
            adjustmentReason: null,
          };

          await storage.createZoomAttendance(attendanceData);
          
          // Update class enrollment with attendance
          await storage.updateClassEnrollment(matchedEnrollment.id, {
            attendanceStatus,
          });
        }
      }

      // Mark meeting as completed
      await storage.updateZoomMeeting(meeting.id, {
        status: 'ended',
        actualEndTime: new Date(),
      });

    } catch (error) {
      console.error('Error processing attendance report:', error);
      throw new Error('Failed to process attendance report');
    }
  }

  async handleWebhook(payload: any): Promise<void> {
    try {
      const { event, payload: eventPayload } = payload;
      
      switch (event) {
        case 'meeting.ended':
          // Wait a few minutes before processing to ensure all data is available
          setTimeout(async () => {
            const meeting = await storage.getZoomMeetingByZoomId(eventPayload.object.id);
            if (meeting) {
              await this.processAttendanceReport(meeting.id);
            }
          }, 300000); // 5 minutes delay
          break;
          
        case 'meeting.started':
          const startedMeeting = await storage.getZoomMeetingByZoomId(eventPayload.object.id);
          if (startedMeeting) {
            await storage.updateZoomMeeting(startedMeeting.id, {
              status: 'started',
              actualStartTime: new Date(),
            });
          }
          break;
      }
    } catch (error) {
      console.error('Error handling Zoom webhook:', error);
      throw new Error('Failed to handle webhook');
    }
  }

  async adjustAttendance(attendanceId: number, status: string, reason: string, adjustedBy: number): Promise<void> {
    try {
      await storage.updateZoomAttendance(attendanceId, {
        attendanceStatus: status,
        isManuallyAdjusted: true,
        adjustedBy,
        adjustmentReason: reason,
      });

      // Also update the class enrollment
      const attendance = await storage.getZoomAttendance(attendanceId);
      if (attendance) {
        const enrollments = await storage.getClassEnrollmentsByStudent(attendance.studentId);
        const relevantEnrollment = enrollments.find(e => {
          // Find the enrollment that matches this meeting's class
          return true; // Simplified for now
        });
        
        if (relevantEnrollment) {
          await storage.updateClassEnrollment(relevantEnrollment.id, {
            attendanceStatus: status,
          });
        }
      }
    } catch (error) {
      console.error('Error adjusting attendance:', error);
      throw new Error('Failed to adjust attendance');
    }
  }
}

// Export a factory function to create the service with config
export function createZoomService(config: ZoomConfig): ZoomService {
  return new ZoomService(config);
}