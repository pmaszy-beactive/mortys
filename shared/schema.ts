import { pgTable, text, serial, integer, boolean, timestamp, decimal, json, varchar, index, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from 'drizzle-orm';

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: varchar("role").default("staff"), // owner, admin, staff, manager
  canOverrideBookingPolicies: boolean("can_override_booking_policies").default(false),
  password: varchar("password"), // bcrypt hashed password for admin users
  resetPasswordToken: varchar("reset_password_token").unique(),
  resetPasswordExpiry: timestamp("reset_password_expiry"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const students = pgTable("students", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull(),
  homePhone: text("home_phone"),
  primaryLanguage: text("primary_language").default("English"),
  dateOfBirth: text("date_of_birth").notNull(),
  address: text("address").notNull(),
  city: text("city"),
  postalCode: text("postal_code"),
  province: text("province"),
  country: text("country").default("Canada"),
  courseType: text("course_type").notNull(), // auto, moto, scooter
  status: text("status").notNull().default("active"), // active, completed, on-hold, transferred
  progress: integer("progress").notNull().default(0), // percentage 0-100
  phase: text("phase"), // Auto Phase 2, Auto Phase 3, Auto Phase 4, Moto Phase 1, Moto Phase 2
  instructorId: integer("instructor_id").references(() => instructors.id),
  favoriteInstructorId: integer("favorite_instructor_id").references(() => instructors.id),
  locationId: integer("location_id").references(() => locations.id),
  attestationNumber: text("attestation_number"),
  contractNumber: text("contract_number"), // Auto-generated when first class attended
  started: integer("started"), // Year student started their course
  emergencyContact: text("emergency_contact").notNull(),
  emergencyPhone: text("emergency_phone").notNull(),
  
  // Additional fields for legacy migration (all nullable for existing data compatibility)
  legacyId: text("legacy_id"),
  enrollmentDate: text("enrollment_date"),
  completionDate: text("completion_date"),
  transferredFrom: text("transferred_from"),
  transferredCredits: integer("transferred_credits"),
  totalHoursCompleted: integer("total_hours_completed"),
  totalHoursRequired: integer("total_hours_required"),
  theoryHoursCompleted: integer("theory_hours_completed"),
  practicalHoursCompleted: integer("practical_hours_completed"),
  
  // Payment and billing
  totalAmountDue: decimal("total_amount_due", { precision: 10, scale: 2 }),
  amountPaid: decimal("amount_paid", { precision: 10, scale: 2 }),
  paymentPlan: text("payment_plan"),
  lastPaymentDate: text("last_payment_date"),
  stripeCustomerId: text("stripe_customer_id").unique(), // Stripe customer ID for payment processing
  
  // Government and compliance
  governmentId: text("government_id"),
  driverLicenseNumber: text("driver_license_number"),
  licenseExpiryDate: text("license_expiry_date"),
  learnerPermitNumber: text("learner_permit_number"), // Nom de dossier / learner's permit number
  learnerPermitValidDate: text("learner_permit_valid_date"),
  learnerPermitExpiryDate: text("learner_permit_expiry_date"),
  learnerPermitPhoto: text("learner_permit_photo"), // Base64 encoded permit photo
  medicalCertificate: boolean("medical_certificate"),
  visionTest: boolean("vision_test"),
  
  // Digital assets
  profilePhoto: text("profile_photo"),
  digitalSignature: text("digital_signature"),
  signatureConsent: boolean("signature_consent"),
  
  // Academic records
  testScores: json("test_scores"),
  finalExamScore: integer("final_exam_score"),
  roadTestDate: text("road_test_date"),
  roadTestResult: text("road_test_result"),
  
  // Special accommodations
  specialNeeds: text("special_needs"),
  accommodations: text("accommodations"),
  languagePreference: text("language_preference"),
  
  // Theory Classes and In-Car Sessions tracking
  currentTheoryClass: integer("current_theory_class"), // 1-12, current theory class number
  currentInCarSession: integer("current_in_car_session"), // 1-15, current in-car session number  
  completedTheoryClasses: json("completed_theory_classes"), // Array of completed theory class numbers [1,2,3,...]
  completedInCarSessions: json("completed_in_car_sessions"), // Array of completed in-car session numbers [1,2,3,...]
  
  // Invite system fields
  inviteToken: text("invite_token").unique(),
  inviteExpiry: timestamp("invite_expiry"),
  accountStatus: text("account_status").notNull().default("pending_invite"), // pending_invite, active, suspended
  inviteSentAt: timestamp("invite_sent_at"),
  inviteAcceptedAt: timestamp("invite_accepted_at"),
  password: text("password"), // Hashed password after invite acceptance
  
  // Password reset fields
  resetPasswordToken: text("reset_password_token").unique(),
  resetPasswordExpiry: timestamp("reset_password_expiry"),
  
  // Notification preferences
  emailNotificationsEnabled: boolean("email_notifications_enabled").default(true),
  smsNotificationsEnabled: boolean("sms_notifications_enabled").default(false), // For future use
  notifyUpcomingClasses: boolean("notify_upcoming_classes").default(true),
  upcomingClassReminderTime: text("upcoming_class_reminder_time").default("24h"),
  notifyScheduleChanges: boolean("notify_schedule_changes").default(true),
  notifyScheduleOpenings: boolean("notify_schedule_openings").default(true),
  notifyPaymentReceipts: boolean("notify_payment_receipts").default(true),
});

// Parents/Guardians table
export const parents = pgTable("parents", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  relationship: text("relationship"), // Parent, Guardian, etc.
  password: text("password"), // Hashed password
  
  // Selected student context (for families with multiple students)
  selectedStudentId: integer("selected_student_id").references(() => students.id),
  
  // Invite system fields
  inviteToken: text("invite_token").unique(),
  inviteExpiry: timestamp("invite_expiry"),
  accountStatus: text("account_status").notNull().default("pending_invite"), // pending_invite, active, suspended
  inviteSentAt: timestamp("invite_sent_at"),
  inviteAcceptedAt: timestamp("invite_accepted_at"),
  
  // Password reset fields
  resetPasswordToken: text("reset_password_token").unique(),
  resetPasswordExpiry: timestamp("reset_password_expiry"),
});

// Junction table linking students to parents with permission levels
export const studentParents = pgTable("student_parents", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: 'cascade' }),
  parentId: integer("parent_id").notNull().references(() => parents.id, { onDelete: 'cascade' }),
  permissionLevel: text("permission_level").notNull().default("view_only"), // view_only, view_book, view_book_pay
  addedAt: timestamp("added_at").defaultNow(),
});

// Student course enrollments - tracks multiple courses per student
export const studentCourses = pgTable("student_courses", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: 'cascade' }),
  courseType: text("course_type").notNull(), // auto, moto, scooter
  status: text("status").notNull().default("active"), // active, completed, on-hold, transferred
  progress: integer("progress").notNull().default(0), // percentage 0-100
  phase: text("phase"), // Auto Phase 2, Auto Phase 3, Auto Phase 4, Moto Phase 1, Moto Phase 2
  instructorId: integer("instructor_id").references(() => instructors.id),
  favoriteInstructorId: integer("favorite_instructor_id").references(() => instructors.id),
  attestationNumber: text("attestation_number"),
  contractNumber: text("contract_number"),
  started: integer("started"), // Year student started this course
  enrollmentDate: text("enrollment_date"),
  completionDate: text("completion_date"),
  totalHoursCompleted: integer("total_hours_completed"),
  totalHoursRequired: integer("total_hours_required"),
  theoryHoursCompleted: integer("theory_hours_completed"),
  practicalHoursCompleted: integer("practical_hours_completed"),
  currentTheoryClass: integer("current_theory_class"), // 1-12, current theory class number
  currentInCarSession: integer("current_in_car_session"), // 1-15, current in-car session number
  completedTheoryClasses: json("completed_theory_classes"), // Array of completed theory class numbers
  completedInCarSessions: json("completed_in_car_sessions"), // Array of completed in-car session numbers
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const vehicles = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  vehicleNumber: integer("vehicle_number"), // display order number, unique per vehicleType
  licensePlate: text("license_plate").notNull().unique(),
  make: text("make").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  vehicleType: text("vehicle_type").notNull(), // auto, motorcycle, scooter
  color: text("color"),
  vin: text("vin").unique(),
  status: text("status").notNull().default("active"), // active, maintenance, out_of_service
  registrationExpiry: text("registration_expiry"),
  insuranceExpiry: text("insurance_expiry"),
  lastMaintenanceDate: text("last_maintenance_date"),
  maintenanceNotes: text("maintenance_notes"),
  fuelType: text("fuel_type"), // gasoline, electric, hybrid
  transmission: text("transmission"), // manual, automatic
  notes: text("notes"),
}, (table) => ({
  typeNumberUnique: unique("vehicles_type_number_unique").on(table.vehicleType, table.vehicleNumber),
}));

export const instructors = pgTable("instructors", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  specializations: json("specializations"), // Enhanced: {courseType: {theory: boolean, practical: boolean}}
  instructorLicenseNumber: text("instructor_license_number"),
  permitNumber: text("permit_number"), // Government permit number for instruction
  locationAssignment: text("location_assignment"), // Primary teaching location
  secondaryLocations: json("secondary_locations"), // Array of additional locations
  vehicleId: integer("vehicle_id").references(() => vehicles.id), // Assigned vehicle
  status: text("status").notNull().default("active"), // active, inactive, suspended
  digitalSignature: text("digital_signature"), // base64 encoded signature
  hireDate: text("hire_date"),
  certificationExpiry: text("certification_expiry"),
  emergencyContact: text("emergency_contact"),
  emergencyPhone: text("emergency_phone"),
  notes: text("notes"),
  
  // Invite system fields
  inviteToken: text("invite_token").unique(),
  inviteExpiry: timestamp("invite_expiry"),
  accountStatus: text("account_status").notNull().default("pending_invite"), // pending_invite, active, suspended
  inviteSentAt: timestamp("invite_sent_at"),
  inviteAcceptedAt: timestamp("invite_accepted_at"),
  termsAcceptedAt: timestamp("terms_accepted_at"),
  password: text("password"), // Hashed password after invite acceptance
});

export const classes = pgTable("classes", {
  id: serial("id").primaryKey(),
  courseType: text("course_type").notNull(), // auto, moto, scooter (vehicle type)
  classType: text("class_type").notNull().default("theory"), // theory, driving (class type)
  classNumber: integer("class_number").notNull(), // 1, 2, 3, 4, 5
  date: text("date").notNull(),
  time: text("time").notNull(),
  duration: integer("duration").notNull().default(120), // minutes
  instructorId: integer("instructor_id").references(() => instructors.id),
  vehicleId: integer("vehicle_id").references(() => vehicles.id), // Assigned vehicle for practical sessions
  vehicleConfirmed: boolean("vehicle_confirmed").notNull().default(false), // Instructor confirmation
  confirmedAt: timestamp("confirmed_at"), // When vehicle was confirmed
  room: text("room"),
  maxStudents: integer("max_students").notNull().default(15),
  status: text("status").notNull().default("scheduled"), // scheduled, completed, cancelled
  lessonType: text("lesson_type").notNull().default("regular"), // regular, one_off (refresher/extra lessons)
  isExtra: boolean("is_extra").notNull().default(false), // Extra/ad-hoc lesson (requires payment, not part of course)
  price: integer("price"), // Price in cents for extra lessons
  topic: text("topic"), // Description/topic for extra lessons
  confirmationStatus: text("confirmation_status").notNull().default("pending"), // pending, confirmed, change_requested
  changeRequestReason: text("change_request_reason"), // Reason for requesting change
  changeRequestTime: text("change_request_time"), // Suggested new time
  changeRequestedAt: timestamp("change_requested_at"), // When change was requested
  zoomLink: text("zoom_link"),
  hasTest: boolean("has_test").notNull().default(false), // class #5 has test
  attendanceSignature: text("attendance_signature"), // Instructor's signature for bulk attendance
  attendanceSignedAt: text("attendance_signed_at"), // When attendance was signed
  attendanceSignedBy: integer("attendance_signed_by").references(() => instructors.id), // Instructor who signed
});

export const classEnrollments = pgTable("class_enrollments", {
  id: serial("id").primaryKey(),
  classId: integer("class_id").references(() => classes.id),
  studentId: integer("student_id").references(() => students.id),
  attendanceStatus: text("attendance_status").default("registered"), // registered, checked_in, attended, absent, no-show
  testScore: integer("test_score"), // for class #5 test
  cancelledAt: timestamp("cancelled_at"), // soft delete timestamp
  lastPaymentIntentId: text("last_payment_intent_id"), // Track used payment intents to prevent reuse
  paymentStatus: text("payment_status").default("not_required"), // not_required, pending, paid, failed (for extra lessons)
  paidAmount: integer("paid_amount"), // Amount paid in cents for extra lessons
  checkInSignature: text("check_in_signature"), // Base64 encoded student signature on check-in
  checkInAt: timestamp("check_in_at"), // When student checked in
  checkOutSignature: text("check_out_signature"), // Base64 encoded student signature on check-out
  checkOutAt: timestamp("check_out_at"), // When student checked out
});

// Transfer Credits System - DriveTraqr Style
export const transferCredits = pgTable("transfer_credits", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  previousSchool: text("previous_school").notNull(), // School Name (as internal transfer)
  learnerPermitDate: text("learner_permit_date").notNull(), // Date Of Issue of Learner's Permit
  currentPhase: integer("current_phase").notNull(), // Current Phase (2, 3, or 4)
  phaseStartDate: text("phase_start_date").notNull(), // Start Date of Phase X
  completedCourses: text("completed_courses").array().notNull().default([]), // Array of completed courses ["Theory 6", "In Car 1", etc.]
  courseType: text("course_type").notNull(), // auto, moto, scooter
  transferDate: text("transfer_date").notNull(),
  status: text("status").notNull().default("pending"), // pending, approved, rejected
  equivalencyNotes: text("equivalency_notes"),
  
  // Legacy fields (keeping for backwards compatibility)
  creditsEarned: integer("credits_earned").default(0),
  totalCreditsRequired: integer("total_credits_required").default(0),
  theoryHours: integer("theory_hours").default(0),
  practicalHours: integer("practical_hours").default(0),
  creditValue: decimal("credit_value", { precision: 10, scale: 2 }).default("0.00"),
  verificationDocument: text("verification_document"),
  verifiedBy: text("verified_by"),
  adjustmentAmount: decimal("adjustment_amount", { precision: 10, scale: 2 }).default("0.00"),
});

export const contractTemplates = pgTable("contract_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  courseType: text("course_type").notNull(), // auto, moto, scooter
  baseAmount: decimal("base_amount", { precision: 10, scale: 2 }).notNull(),
  description: text("description"),
  termsAndConditions: text("terms_and_conditions"),
  paymentMethods: json("payment_methods").$type<string[]>().default(["full", "installment"]),
  defaultPaymentMethod: text("default_payment_method").default("full"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const contracts = pgTable("contracts", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => students.id),
  templateId: integer("template_id").references(() => contractTemplates.id),
  courseType: text("course_type").notNull(),
  contractDate: text("contract_date").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").notNull(), // full, installment, transfer
  status: text("status").notNull().default("pending"), // pending, active, completed
  specialNotes: text("special_notes"),
  attestationGenerated: boolean("attestation_generated").notNull().default(false),
  autoGenerated: boolean("auto_generated").notNull().default(false),
  
  // Enhanced contract fields for legacy migration
  legacyContractId: text("legacy_contract_id"),
  contractNumber: text("contract_number"),
  originalAmount: decimal("original_amount", { precision: 10, scale: 2 }),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).default("0.00"),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).default("0.00"),
  paymentSchedule: json("payment_schedule"), // Array of payment dates and amounts
  paymentHistory: json("payment_history"), // Complete payment transaction history
  parentGuardianName: text("parent_guardian_name"),
  parentGuardianSignature: text("parent_guardian_signature"),
  contractDocument: text("contract_document"), // Base64 encoded PDF or image
  signedDate: text("signed_date"),
  witnessName: text("witness_name"),
  witnessSignature: text("witness_signature"),
});

export const evaluations = pgTable("evaluations", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => students.id),
  instructorId: integer("instructor_id").references(() => instructors.id),
  classId: integer("class_id").references(() => classes.id), // Link to specific class
  evaluationDate: text("evaluation_date").notNull(),
  sessionType: text("session_type").notNull(), // in-car, theory
  strengths: text("strengths"),
  weaknesses: text("weaknesses"),
  checklist: json("checklist"), // JSON object with evaluation items
  ratings: json("ratings"), // {punctuality: 1-5, control: 1-5, roadAwareness: 1-5, trafficRules: 1-5}
  overallRating: integer("overall_rating"), // 1-5
  comments: text("comments"), // Instructor comments
  notes: text("notes"),
  signedOff: boolean("signed_off").notNull().default(false),
  instructorSignature: text("instructor_signature"), // Base64 encoded signature
  signatureDate: text("signature_date"), // When instructor signature was captured
  signatureIpAddress: text("signature_ip_address"), // IP address for audit trail
  studentSignature: text("student_signature"), // Base64 encoded student signature
  studentSignatureDate: text("student_signature_date"), // When student signature was captured
  submittedAt: timestamp("submitted_at"), // When evaluation was submitted
  
  // Enhanced evaluation fields for legacy migration
  legacyEvaluationId: text("legacy_evaluation_id"),
  sessionNumber: integer("session_number"),
  duration: integer("duration"), // minutes
  vehicleType: text("vehicle_type"), // auto, motorcycle, scooter
  weatherConditions: text("weather_conditions"),
  trafficConditions: text("traffic_conditions"),
  routeDescription: text("route_description"),
  skillsAssessed: json("skills_assessed"), // Detailed skill breakdown
  recommendationsForNext: text("recommendations_for_next"),
  studentSelfAssessment: text("student_self_assessment"),
  parentalFeedback: text("parental_feedback"),
  evaluationPhotos: json("evaluation_photos"), // Array of base64 images
});

export const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => students.id),
  authorId: varchar("author_id").references(() => users.id),
  content: text("content").notNull(),
  visibility: text("visibility").notNull(), // office-only, student-visible, instructor-only
  noteDate: text("note_date").notNull(),
});

export const communications = pgTable("communications", {
  id: serial("id").primaryKey(),
  authorId: varchar("author_id").references(() => users.id),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  recipients: json("recipients"), // JSON array of recipient IDs and types
  messageType: text("message_type").notNull(), // announcement, reminder, schedule-change, payment-notice, general
  sendDate: text("send_date"),
  status: text("status").notNull().default("draft"), // draft, scheduled, sent
  openRate: integer("open_rate").default(0),
  clickRate: integer("click_rate").default(0),
});

export const instructorAvailability = pgTable("instructor_availability", {
  id: serial("id").primaryKey(),
  instructorId: integer("instructor_id").references(() => instructors.id).notNull(),
  dayOfWeek: integer("day_of_week").notNull(), // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  startTime: text("start_time").notNull(), // HH:MM format
  endTime: text("end_time").notNull(), // HH:MM format
  isAvailable: boolean("is_available").notNull().default(true),
});

export const instructorReminderSettings = pgTable("instructor_reminder_settings", {
  id: serial("id").primaryKey(),
  instructorId: integer("instructor_id").references(() => instructors.id).notNull().unique(),
  availabilityReminderEnabled: boolean("availability_reminder_enabled").notNull().default(true),
  reminderFrequency: text("reminder_frequency").notNull().default("weekly"), // daily, weekly, biweekly, monthly
  reminderDayOfWeek: integer("reminder_day_of_week").default(0), // 0 = Sunday, 1 = Monday (for weekly/biweekly)
  reminderTime: text("reminder_time").default("09:00"), // HH:MM format for when to send reminder
  emailEnabled: boolean("email_enabled").notNull().default(true),
  inAppEnabled: boolean("in_app_enabled").notNull().default(true),
  lastReminderSentAt: timestamp("last_reminder_sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const zoomMeetings = pgTable("zoom_meetings", {
  id: serial("id").primaryKey(),
  classId: integer("class_id").references(() => classes.id).notNull(),
  zoomMeetingId: text("zoom_meeting_id").notNull(), // Zoom's meeting ID
  meetingUuid: text("meeting_uuid"), // Zoom's meeting UUID for attendance retrieval
  joinUrl: text("join_url").notNull(),
  startUrl: text("start_url").notNull(),
  passcode: text("passcode"),
  status: text("status").notNull().default("scheduled"), // scheduled, started, ended
  createdAt: timestamp("created_at").defaultNow().notNull(),
  actualStartTime: timestamp("actual_start_time"),
  actualEndTime: timestamp("actual_end_time"),
});

export const zoomAttendance = pgTable("zoom_attendance", {
  id: serial("id").primaryKey(),
  zoomMeetingId: integer("zoom_meeting_id").references(() => zoomMeetings.id).notNull(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  participantName: text("participant_name").notNull(),
  joinTime: timestamp("join_time").notNull(),
  leaveTime: timestamp("leave_time").notNull(),
  duration: integer("duration").notNull(), // in minutes
  attendanceStatus: text("attendance_status").notNull().default("present"), // present, absent, partial
  isManuallyAdjusted: boolean("is_manually_adjusted").notNull().default(false),
  adjustedBy: varchar("adjusted_by").references(() => users.id),
  adjustmentReason: text("adjustment_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const zoomSettings = pgTable("zoom_settings", {
  id: serial("id").primaryKey(),
  minimumAttendanceMinutes: integer("minimum_attendance_minutes").notNull().default(30),
  minimumAttendancePercentage: integer("minimum_attendance_percentage").notNull().default(75),
  autoMarkAttendance: boolean("auto_mark_attendance").notNull().default(true),
  webhookUrl: text("webhook_url"),
  apiKey: text("api_key"),
  apiSecret: text("api_secret"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const insertStudentSchema = createInsertSchema(students).omit({ id: true });
export const insertParentSchema = createInsertSchema(parents).omit({ id: true });
export const insertStudentParentSchema = createInsertSchema(studentParents).omit({ id: true });
export const insertStudentCourseSchema = createInsertSchema(studentCourses).omit({ id: true, createdAt: true, updatedAt: true });
export const insertInstructorSchema = createInsertSchema(instructors).omit({ id: true });

// Enhanced instructor specialization type for form handling
export const instructorSpecializationSchema = z.object({
  courseType: z.enum(['auto', 'moto', 'scooter']),
  theory: z.boolean().default(false),
  practical: z.boolean().default(false),
});
export const insertClassSchema = createInsertSchema(classes).omit({ id: true });
export const insertClassEnrollmentSchema = createInsertSchema(classEnrollments).omit({ id: true });
export const insertContractTemplateSchema = createInsertSchema(contractTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export const insertContractSchema = createInsertSchema(contracts).omit({ id: true });
export const insertEvaluationSchema = createInsertSchema(evaluations).omit({ id: true });
export const insertNoteSchema = createInsertSchema(notes).omit({ id: true });
export const insertCommunicationSchema = createInsertSchema(communications).omit({ id: true });
export const insertInstructorAvailabilitySchema = createInsertSchema(instructorAvailability).omit({ id: true });
export const insertInstructorReminderSettingsSchema = createInsertSchema(instructorReminderSettings).omit({ id: true, createdAt: true, updatedAt: true, lastReminderSentAt: true });
export const insertZoomMeetingSchema = createInsertSchema(zoomMeetings).omit({ id: true, createdAt: true });
export const insertZoomAttendanceSchema = createInsertSchema(zoomAttendance).omit({ id: true, createdAt: true });
export const insertZoomSettingsSchema = createInsertSchema(zoomSettings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTransferCreditSchema = createInsertSchema(transferCredits).omit({ 
  id: true,
  creditsEarned: true, // Now optional/computed
  totalCreditsRequired: true, // Now optional/computed 
  theoryHours: true, // Now optional/legacy
  practicalHours: true, // Now optional/legacy
  verificationDocument: true, // Optional
  verifiedBy: true, // Optional
  adjustmentAmount: true // Optional
}).extend({
  creditValue: z.string().optional().default("0.00"), // Provide default for legacy field
});
// Transaction schema moved below table definition

// Types
export type Student = typeof students.$inferSelect;
export type InsertStudent = z.infer<typeof insertStudentSchema>;
export type Parent = typeof parents.$inferSelect;
export type InsertParent = z.infer<typeof insertParentSchema>;
export type StudentParent = typeof studentParents.$inferSelect;
export type InsertStudentParent = z.infer<typeof insertStudentParentSchema>;
export type StudentCourse = typeof studentCourses.$inferSelect;
export type InsertStudentCourse = z.infer<typeof insertStudentCourseSchema>;
export type Instructor = typeof instructors.$inferSelect;
export type InsertInstructor = z.infer<typeof insertInstructorSchema>;
export type Class = typeof classes.$inferSelect;
export type InsertClass = z.infer<typeof insertClassSchema>;
export type ClassEnrollment = typeof classEnrollments.$inferSelect;
export type InsertClassEnrollment = z.infer<typeof insertClassEnrollmentSchema>;
export type ContractTemplate = typeof contractTemplates.$inferSelect;
export type InsertContractTemplate = z.infer<typeof insertContractTemplateSchema>;
export type Contract = typeof contracts.$inferSelect;
export type InsertContract = z.infer<typeof insertContractSchema>;
export type Evaluation = typeof evaluations.$inferSelect;
export type InsertEvaluation = z.infer<typeof insertEvaluationSchema>;
export type Note = typeof notes.$inferSelect;
export type InsertNote = z.infer<typeof insertNoteSchema>;
export type Communication = typeof communications.$inferSelect;
export type InsertCommunication = z.infer<typeof insertCommunicationSchema>;
export type InstructorAvailability = typeof instructorAvailability.$inferSelect;
export type InsertInstructorAvailability = z.infer<typeof insertInstructorAvailabilitySchema>;

export type InstructorReminderSettings = typeof instructorReminderSettings.$inferSelect;
export type InsertInstructorReminderSettings = z.infer<typeof insertInstructorReminderSettingsSchema>;

export type ZoomMeeting = typeof zoomMeetings.$inferSelect;
export type InsertZoomMeeting = z.infer<typeof insertZoomMeetingSchema>;

export type ZoomAttendance = typeof zoomAttendance.$inferSelect;
export type InsertZoomAttendance = z.infer<typeof insertZoomAttendanceSchema>;

// Application Settings
export const appSettings = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Global ledger to prevent Stripe policy fee payment reuse across all enrollments
export const policyFeePayments = pgTable("policy_fee_payments", {
  id: serial("id").primaryKey(),
  paymentIntentId: text("payment_intent_id").notNull().unique(), // Enforce global uniqueness
  enrollmentId: integer("enrollment_id").references(() => classEnrollments.id).notNull(),
  status: text("status").notNull(), // 'reschedule' or 'cancel'
  amount: integer("amount").notNull(), // in cents
  currency: text("currency").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAppSettingsSchema = createInsertSchema(appSettings).omit({ id: true });
export const insertPolicyFeePaymentSchema = createInsertSchema(policyFeePayments).omit({ id: true, createdAt: true });
export type AppSettings = typeof appSettings.$inferSelect;
export type InsertAppSettings = z.infer<typeof insertAppSettingsSchema>;
export type PolicyFeePayment = typeof policyFeePayments.$inferSelect;
export type InsertPolicyFeePayment = z.infer<typeof insertPolicyFeePaymentSchema>;

// Booking Policies - Define limits and rules for class bookings
export const bookingPolicies = pgTable("booking_policies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // e.g., "Student Booking Limit", "Daily Maximum"
  policyType: text("policy_type").notNull(), // max_duration, max_bookings_per_day, advance_booking_days, etc.
  courseType: text("course_type"), // auto, moto, scooter, or null for all
  classType: text("class_type"), // theory, driving, or null for all
  value: integer("value").notNull(), // numeric value (e.g., 120 for 2 hours in minutes)
  isActive: boolean("is_active").notNull().default(true),
  description: text("description"), // Human-readable description
  effectiveFrom: timestamp("effective_from").defaultNow(), // When this policy takes effect
  effectiveTo: timestamp("effective_to"), // When this policy expires (null = no expiration)
  version: integer("version").notNull().default(1), // Current version number
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBookingPolicySchema = createInsertSchema(bookingPolicies).omit({ id: true, createdAt: true, updatedAt: true, version: true });
export type BookingPolicy = typeof bookingPolicies.$inferSelect;
export type InsertBookingPolicy = z.infer<typeof insertBookingPolicySchema>;

// Booking Policy Version History - Track all changes to booking policies
export const bookingPolicyVersions = pgTable("booking_policy_versions", {
  id: serial("id").primaryKey(),
  policyId: integer("policy_id").references(() => bookingPolicies.id).notNull(),
  version: integer("version").notNull(),
  name: text("name").notNull(),
  policyType: text("policy_type").notNull(),
  courseType: text("course_type"),
  classType: text("class_type"),
  value: integer("value").notNull(),
  isActive: boolean("is_active").notNull(),
  description: text("description"),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  changedBy: varchar("changed_by").references(() => users.id).notNull(),
  changeReason: text("change_reason"), // Optional reason for the change
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertBookingPolicyVersionSchema = createInsertSchema(bookingPolicyVersions).omit({ id: true, createdAt: true });
export type BookingPolicyVersion = typeof bookingPolicyVersions.$inferSelect;
export type InsertBookingPolicyVersion = z.infer<typeof insertBookingPolicyVersionSchema>;

// Policy Override Audit Log - Track all policy override actions for compliance
export const policyOverrideLogs = pgTable("policy_override_logs", {
  id: serial("id").primaryKey(),
  staffUserId: varchar("staff_user_id").references(() => users.id).notNull(),
  actionType: text("action_type").notNull(), // book, edit, cancel, reschedule
  policyType: text("policy_type").notNull(), // max_duration, max_bookings_per_day, advance_booking_days
  reason: text("reason").notNull(), // Required reason for the override
  studentId: integer("student_id").references(() => students.id),
  classId: integer("class_id").references(() => classes.id),
  enrollmentId: integer("enrollment_id").references(() => classEnrollments.id),
  originalValue: text("original_value"), // What the policy limit was
  overriddenValue: text("overridden_value"), // What was actually allowed
  notificationSent: boolean("notification_sent").default(false),
  notificationRecipients: text("notification_recipients"), // JSON array of email addresses
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPolicyOverrideLogSchema = createInsertSchema(policyOverrideLogs).omit({ id: true, createdAt: true });
export type PolicyOverrideLog = typeof policyOverrideLogs.$inferSelect;
export type InsertPolicyOverrideLog = z.infer<typeof insertPolicyOverrideLogSchema>;

export type ZoomSettings = typeof zoomSettings.$inferSelect;
export type InsertZoomSettings = z.infer<typeof insertZoomSettingsSchema>;

export type TransferCredit = typeof transferCredits.$inferSelect;
export type InsertTransferCredit = z.infer<typeof insertTransferCreditSchema>;

export type StudentTransaction = typeof studentTransactions.$inferSelect;
export type InsertStudentTransaction = z.infer<typeof insertStudentTransactionSchema>;

// School Permits Tables
export const schoolPermits = pgTable("school_permits", {
  id: serial("id").primaryKey(),
  permitCode: text("permit_code").notNull(), // L-020, L-390, etc.
  location: text("location").notNull(), // Montreal, Dollard-des-Ormeaux, etc.
  courseTypes: text("course_types").notNull(), // JSON array: ["auto", "moto", "scooter"]
  startNumber: integer("start_number").notNull(), // 3276842
  endNumber: integer("end_number").notNull(), // 3277041
  totalNumbers: integer("total_numbers").notNull(), // calculated field
  availableNumbers: integer("available_numbers").notNull(), // decreases as numbers are assigned
  isActive: boolean("is_active").notNull().default(true),
  // Expiry tracking fields
  issueDate: text("issue_date"), // When the permit was issued
  expiryDate: text("expiry_date"), // When the permit expires
  renewalReminderSent: boolean("renewal_reminder_sent").default(false),
  // Document upload support
  documentUrl: text("document_url"), // URL to uploaded permit document
  documentFileName: text("document_file_name"), // Original filename
  documentUploadedAt: timestamp("document_uploaded_at"),
  // Additional metadata
  notes: text("notes"), // Admin notes about the permit
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const permitNumbers = pgTable("permit_numbers", {
  id: serial("id").primaryKey(),
  permitId: integer("permit_id").references(() => schoolPermits.id).notNull(),
  number: integer("number").notNull(),
  isAssigned: boolean("is_assigned").notNull().default(false),
  assignedToStudentId: integer("assigned_to_student_id").references(() => students.id),
  assignedDate: timestamp("assigned_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Student Transactions for Statement of Account
export const studentTransactions = pgTable("student_transactions", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  date: text("date").notNull(),
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  gst: decimal("gst", { precision: 10, scale: 2 }).default("0.00"),
  pst: decimal("pst", { precision: 10, scale: 2 }).default("0.00"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  transactionType: text("transaction_type").notNull(), // payment, charge, refund, adjustment
  paymentMethod: text("payment_method"), // cash, credit, debit, check, e-transfer
  referenceNumber: text("reference_number"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Additional tables for comprehensive legacy migration
export const lessonRecords = pgTable("lesson_records", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  instructorId: integer("instructor_id").references(() => instructors.id),
  lessonDate: text("lesson_date").notNull(),
  lessonType: text("lesson_type").notNull(), // theory, practical, evaluation
  duration: integer("duration").notNull(), // minutes
  status: text("status").notNull(), // completed, cancelled, no-show
  notes: text("notes"),
  skillsPracticed: json("skills_practiced"),
  legacyLessonId: text("legacy_lesson_id"),
  vehicleUsed: text("vehicle_used"),
  startLocation: text("start_location"),
  endLocation: text("end_location"),
  weatherConditions: text("weather_conditions"),
  instructorFeedback: text("instructor_feedback"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const paymentTransactions = pgTable("payment_transactions", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  contractId: integer("contract_id").references(() => contracts.id),
  transactionDate: text("transaction_date").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").notNull(), // cash, cheque, credit, debit, etransfer
  transactionType: text("transaction_type").notNull(), // payment, refund, adjustment
  receiptNumber: text("receipt_number"),
  notes: text("notes"),
  processedBy: text("processed_by"),
  legacyTransactionId: text("legacy_transaction_id"),
  balanceAfter: decimal("balance_after", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const studentDocuments = pgTable("student_documents", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => students.id),
  registrationId: integer("registration_id"), // For pre-registration uploads before student is created
  documentType: text("document_type").notNull(), // contract, evaluation, certificate, photo, permit, consent_form, medical_certificate, photo_id
  documentName: text("document_name").notNull(),
  documentData: text("document_data"), // Base64 encoded file
  uploadDate: text("upload_date").notNull(),
  fileSize: integer("file_size"), // bytes
  mimeType: text("mime_type"),
  legacyDocumentId: text("legacy_document_id"),
  isSigned: boolean("is_signed").default(false),
  signedDate: text("signed_date"),
  verificationStatus: text("verification_status").notNull().default("pending"), // pending, approved, rejected
  verifiedBy: varchar("verified_by").references(() => users.id), // Admin who verified
  verifiedAt: timestamp("verified_at"),
  rejectionReason: text("rejection_reason"),
  folderName: text("folder_name"), // Nom de dossier - organizational folder name for the document
  expiryDate: text("expiry_date"), // Document expiry date (e.g., permit expiration)
  notes: text("notes"), // Admin notes about the document
  createdAt: timestamp("created_at").defaultNow(),
});

export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  postalCode: text("postal_code").notNull(),
  province: text("province").notNull(),
  country: text("country").notNull().default("Canada"),
  phone: text("phone"),
  email: text("email"),
  isActive: boolean("is_active").notNull().default(true),
  isPrimary: boolean("is_primary").notNull().default(false),
  locationCode: text("location_code").unique(), // Short code like "DT" for Downtown, "NW" for North West
  operatingHours: json("operating_hours"), // Operating hours for each day
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const studentNotifications = pgTable("student_notifications", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  type: text("type").notNull(), // lesson_reminder, payment_due, class_update, general
  title: text("title").notNull(),
  message: text("message").notNull(),
  payload: json("payload"), // Additional data like class ID, payment amount, etc.
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Billing System Tables

// Lesson packages students can purchase
export const lessonPackages = pgTable("lesson_packages", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  lessonCount: integer("lesson_count").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  courseType: text("course_type").notNull(), // auto, moto, scooter
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_lesson_packages_course_type_active").on(table.courseType, table.isActive)
]);

// Student payment methods (Stripe payment methods)
export const studentPaymentMethods = pgTable("student_payment_methods", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  stripePaymentMethodId: text("stripe_payment_method_id").notNull().unique(),
  cardBrand: text("card_brand"), // visa, mastercard, amex, etc.
  last4: text("last4"), // Last 4 digits
  expiryMonth: integer("expiry_month"),
  expiryYear: integer("expiry_year"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_student_payment_methods_student").on(table.studentId)
]);

// Invoices for outstanding balances
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  dueDate: text("due_date"),
  status: text("status").notNull().default("unpaid"), // unpaid, paid, overdue, cancelled
  description: text("description").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_invoices_student_status").on(table.studentId, table.status)
]);

// Student credits for future use
export const studentCredits = pgTable("student_credits", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  transactionId: integer("transaction_id").references(() => studentTransactions.id),
  expiryDate: text("expiry_date"),
  isUsed: boolean("is_used").notNull().default(false),
  usedDate: timestamp("used_date"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_student_credits_student").on(table.studentId)
]);

// Receipts for completed transactions
export const billingReceipts = pgTable("billing_receipts", {
  id: serial("id").primaryKey(),
  transactionId: integer("transaction_id").references(() => studentTransactions.id).notNull(),
  receiptNumber: text("receipt_number").notNull().unique(),
  pdfPath: text("pdf_path"),
  generatedAt: timestamp("generated_at").defaultNow(),
}, (table) => [
  index("idx_billing_receipts_transaction").on(table.transactionId)
]);

// Payer profiles for tracking who actually pays (may differ from student)
export const payerProfiles = pgTable("payer_profiles", {
  id: serial("id").primaryKey(),
  payerType: text("payer_type").notNull(), // student, parent, guardian, employer, other
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  studentId: integer("student_id").references(() => students.id), // Legacy: single student reference (use payerProfileStudents for multi-student)
  parentId: integer("parent_id"), // If payer is a linked parent (nullable, no FK constraint)
  relationship: text("relationship"), // For guardian/other: relationship to student
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Bridge table for payer-student many-to-many relationship (families with multiple students)
export const payerProfileStudents = pgTable("payer_profile_students", {
  id: serial("id").primaryKey(),
  payerProfileId: integer("payer_profile_id").notNull().references(() => payerProfiles.id, { onDelete: 'cascade' }),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: 'cascade' }),
  isPrimary: boolean("is_primary").notNull().default(false), // Primary student for this payer
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_payer_profile_students_payer").on(table.payerProfileId),
  index("idx_payer_profile_students_student").on(table.studentId)
]);

// Payment intakes for unreconciled/manual payments (e-transfer, cash, cheque)
export const paymentIntakes = pgTable("payment_intakes", {
  id: serial("id").primaryKey(),
  payerName: text("payer_name").notNull(), // Name as it appears on payment (may not match records)
  payerEmail: text("payer_email"),
  payerPhone: text("payer_phone"),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").notNull(), // e-transfer, cash, cheque, bank_transfer, other
  referenceNumber: text("reference_number"), // E-transfer confirmation, cheque number, etc.
  receivedDate: text("received_date").notNull(),
  notes: text("notes"),
  studentId: integer("student_id").references(() => students.id), // Linked student (null until reconciled)
  payerProfileId: integer("payer_profile_id").references(() => payerProfiles.id), // Linked payer profile
  status: text("status").notNull().default("pending"), // pending, partially_allocated, reconciled, returned
  allocatedAmount: decimal("allocated_amount", { precision: 10, scale: 2 }).default("0.00"), // Amount allocated to students
  reconciledBy: varchar("reconciled_by").references(() => users.id),
  reconciledAt: timestamp("reconciled_at"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_payment_intakes_status").on(table.status),
  index("idx_payment_intakes_student").on(table.studentId),
  index("idx_payment_intakes_received_date").on(table.receivedDate)
]);

// Payment allocations linking payments to student transactions
export const paymentAllocations = pgTable("payment_allocations", {
  id: serial("id").primaryKey(),
  paymentIntakeId: integer("payment_intake_id").references(() => paymentIntakes.id).notNull(),
  studentTransactionId: integer("student_transaction_id").references(() => studentTransactions.id).notNull(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  allocatedBy: varchar("allocated_by").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_payment_allocations_intake").on(table.paymentIntakeId),
  index("idx_payment_allocations_transaction").on(table.studentTransactionId)
]);

// Payroll access audit log
export const payrollAccessLogs = pgTable("payroll_access_logs", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id),
  userEmail: text("user_email"),
  userRole: text("user_role"),
  action: text("action").notNull(), // view, export_csv, export_pdf, access_denied
  filters: json("filters"), // What filters were applied
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  success: boolean("success").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Payment reconciliation audit log
export const paymentAuditLogs = pgTable("payment_audit_logs", {
  id: serial("id").primaryKey(),
  paymentIntakeId: integer("payment_intake_id").references(() => paymentIntakes.id).notNull(),
  action: text("action").notNull(), // created, allocated, partially_allocated, reconciled, returned, updated
  actorId: varchar("actor_id").references(() => users.id),
  previousData: json("previous_data"), // Snapshot before change
  newData: json("new_data"), // Snapshot after change
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas
export const insertSchoolPermitSchema = createInsertSchema(schoolPermits).omit({
  id: true,
  totalNumbers: true,
  availableNumbers: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPermitNumberSchema = createInsertSchema(permitNumbers).omit({
  id: true,
  createdAt: true,
});

export const insertLessonRecordSchema = createInsertSchema(lessonRecords).omit({
  id: true,
  createdAt: true,
});

export const insertPaymentTransactionSchema = createInsertSchema(paymentTransactions).omit({
  id: true,
  createdAt: true,
});

export const insertStudentDocumentSchema = createInsertSchema(studentDocuments).omit({
  id: true,
  createdAt: true,
});

export const insertStudentTransactionSchema = createInsertSchema(studentTransactions).omit({ id: true, createdAt: true });

export const insertLocationSchema = createInsertSchema(locations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertVehicleSchema = createInsertSchema(vehicles).omit({
  id: true,
});

export const insertStudentNotificationSchema = createInsertSchema(studentNotifications).omit({
  id: true,
  createdAt: true,
});

// Billing insert schemas
export const insertLessonPackageSchema = createInsertSchema(lessonPackages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertStudentPaymentMethodSchema = createInsertSchema(studentPaymentMethods).omit({
  id: true,
  createdAt: true,
});

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertStudentCreditSchema = createInsertSchema(studentCredits).omit({
  id: true,
  createdAt: true,
});

export const insertBillingReceiptSchema = createInsertSchema(billingReceipts).omit({
  id: true,
  generatedAt: true,
});

export const insertPayerProfileSchema = createInsertSchema(payerProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPayerProfileStudentSchema = createInsertSchema(payerProfileStudents).omit({
  id: true,
  createdAt: true,
});

export const insertPaymentIntakeSchema = createInsertSchema(paymentIntakes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPaymentAllocationSchema = createInsertSchema(paymentAllocations).omit({
  id: true,
  createdAt: true,
});

export const insertPaymentAuditLogSchema = createInsertSchema(paymentAuditLogs).omit({
  id: true,
  createdAt: true,
});

export const insertPayrollAccessLogSchema = createInsertSchema(payrollAccessLogs).omit({
  id: true,
  createdAt: true,
});

// Types
export type SchoolPermit = typeof schoolPermits.$inferSelect;
export type InsertSchoolPermit = z.infer<typeof insertSchoolPermitSchema>;
export type PermitNumber = typeof permitNumbers.$inferSelect;
export type InsertPermitNumber = z.infer<typeof insertPermitNumberSchema>;
export type LessonRecord = typeof lessonRecords.$inferSelect;
export type InsertLessonRecord = z.infer<typeof insertLessonRecordSchema>;
export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type InsertPaymentTransaction = z.infer<typeof insertPaymentTransactionSchema>;
export type StudentDocument = typeof studentDocuments.$inferSelect;
export type InsertStudentDocument = z.infer<typeof insertStudentDocumentSchema>;
export type Location = typeof locations.$inferSelect;
export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Vehicle = typeof vehicles.$inferSelect;
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type StudentNotification = typeof studentNotifications.$inferSelect;
export type InsertStudentNotification = z.infer<typeof insertStudentNotificationSchema>;

// Billing types
export type LessonPackage = typeof lessonPackages.$inferSelect;
export type InsertLessonPackage = z.infer<typeof insertLessonPackageSchema>;
export type StudentPaymentMethod = typeof studentPaymentMethods.$inferSelect;
export type InsertStudentPaymentMethod = z.infer<typeof insertStudentPaymentMethodSchema>;
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type StudentCredit = typeof studentCredits.$inferSelect;
export type InsertStudentCredit = z.infer<typeof insertStudentCreditSchema>;
export type BillingReceipt = typeof billingReceipts.$inferSelect;
export type InsertBillingReceipt = z.infer<typeof insertBillingReceiptSchema>;

// Payment reconciliation types
export type PayerProfile = typeof payerProfiles.$inferSelect;
export type InsertPayerProfile = z.infer<typeof insertPayerProfileSchema>;
export type PayerProfileStudent = typeof payerProfileStudents.$inferSelect;
export type InsertPayerProfileStudent = z.infer<typeof insertPayerProfileStudentSchema>;
export type PaymentIntake = typeof paymentIntakes.$inferSelect;
export type InsertPaymentIntake = z.infer<typeof insertPaymentIntakeSchema>;
export type PaymentAllocation = typeof paymentAllocations.$inferSelect;
export type InsertPaymentAllocation = z.infer<typeof insertPaymentAllocationSchema>;
export type PaymentAuditLog = typeof paymentAuditLogs.$inferSelect;
export type InsertPaymentAuditLog = z.infer<typeof insertPaymentAuditLogSchema>;
export type PayrollAccessLog = typeof payrollAccessLogs.$inferSelect;
export type InsertPayrollAccessLog = z.infer<typeof insertPayrollAccessLogSchema>;

// Unified Notification System Tables

// Notification templates for different event types
export const notificationTemplates = pgTable("notification_templates", {
  id: serial("id").primaryKey(),
  notificationType: text("notification_type").notNull(), // upcoming_class, schedule_change, payment_due, payment_received, policy_override
  channel: text("channel").notNull(), // email, in_app
  subjectTemplate: text("subject_template"), // For email
  bodyTemplate: text("body_template").notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Notification preferences for all user types
export const notificationPreferences = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  recipientType: text("recipient_type").notNull(), // student, parent, staff
  recipientId: text("recipient_id").notNull(), // student.id, parent.id, or user.id
  notificationType: text("notification_type").notNull(), // upcoming_class, schedule_change, payment_due, payment_received, policy_override
  emailEnabled: boolean("email_enabled").default(true),
  inAppEnabled: boolean("in_app_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_notification_prefs_recipient").on(table.recipientType, table.recipientId),
]);

// Central notification events log
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  notificationType: text("notification_type").notNull(), // upcoming_class, schedule_change, payment_due, payment_received, policy_override
  title: text("title").notNull(),
  message: text("message").notNull(),
  payload: json("payload"), // Additional context data (classId, paymentAmount, etc.)
  triggeredBy: text("triggered_by"), // user ID who triggered the event (for manual actions)
  createdAt: timestamp("created_at").defaultNow(),
});

// Notification delivery tracking per recipient
export const notificationDeliveries = pgTable("notification_deliveries", {
  id: serial("id").primaryKey(),
  notificationId: integer("notification_id").references(() => notifications.id).notNull(),
  recipientType: text("recipient_type").notNull(), // student, parent, staff
  recipientId: text("recipient_id").notNull(),
  recipientEmail: text("recipient_email"),
  recipientName: text("recipient_name"),
  channel: text("channel").notNull(), // email, in_app
  status: text("status").notNull().default("pending"), // pending, sent, delivered, failed, read
  sentAt: timestamp("sent_at"),
  readAt: timestamp("read_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_notification_deliveries_recipient").on(table.recipientType, table.recipientId),
  index("idx_notification_deliveries_status").on(table.status),
]);

// Insert schemas
export const insertNotificationTemplateSchema = createInsertSchema(notificationTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertNotificationPreferenceSchema = createInsertSchema(notificationPreferences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
});

export const insertNotificationDeliverySchema = createInsertSchema(notificationDeliveries).omit({
  id: true,
  createdAt: true,
});

// Types
export type NotificationTemplate = typeof notificationTemplates.$inferSelect;
export type InsertNotificationTemplate = z.infer<typeof insertNotificationTemplateSchema>;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreference = z.infer<typeof insertNotificationPreferenceSchema>;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
export type InsertNotificationDelivery = z.infer<typeof insertNotificationDeliverySchema>;

// Student Notes - internal and student-visible notes
export const studentNotes = pgTable("student_notes", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  authorId: text("author_id").notNull(),
  authorName: text("author_name").notNull(),
  authorRole: text("author_role").notNull(),
  noteType: text("note_type").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertStudentNoteSchema = createInsertSchema(studentNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type StudentNote = typeof studentNotes.$inferSelect;
export type InsertStudentNote = z.infer<typeof insertStudentNoteSchema>;

// Email verification tokens for student self-registration
export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  code: text("code").notNull(), // 6-digit verification code
  expiresAt: timestamp("expires_at").notNull(),
  verified: boolean("verified").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Student registration - pending registrations before email verification
export const studentRegistrations = pgTable("student_registrations", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  verificationTokenId: integer("verification_token_id").references(() => emailVerificationTokens.id),
  emailVerified: boolean("email_verified").notNull().default(false),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  onboardingStep: integer("onboarding_step").notNull().default(1), // 1-5 for wizard steps
  // Onboarding data stored as JSON until completion
  onboardingData: json("onboarding_data").$type<{
    firstName?: string;
    lastName?: string;
    phone?: string;
    homePhone?: string;
    dateOfBirth?: string;
    primaryLanguage?: string;
    address?: string;
    city?: string;
    postalCode?: string;
    province?: string;
    country?: string;
    permitNumber?: string; // Nom de dossier / permit number
    permitExpiryDate?: string;
    driverLicenseNumber?: string;
    licenseExpiryDate?: string;
    emergencyContact?: string;
    emergencyPhone?: string;
    courseType?: string;
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schemas for new tables
export const insertEmailVerificationTokenSchema = createInsertSchema(emailVerificationTokens).omit({
  id: true,
  createdAt: true,
});

export const insertStudentRegistrationSchema = createInsertSchema(studentRegistrations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types for new tables
export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;
export type InsertEmailVerificationToken = z.infer<typeof insertEmailVerificationTokenSchema>;
export type StudentRegistration = typeof studentRegistrations.$inferSelect;
export type InsertStudentRegistration = z.infer<typeof insertStudentRegistrationSchema>;

// Auth types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
