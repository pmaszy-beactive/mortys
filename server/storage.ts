import { 
  users, students, instructors, classes, classEnrollments, contracts, contractTemplates,
  evaluations, notes, communications, instructorAvailability, instructorReminderSettings,
  zoomMeetings, zoomAttendance, zoomSettings, schoolPermits, permitNumbers,
  lessonRecords, paymentTransactions, studentDocuments, studentTransactions, transferCredits,
  locations, vehicles, appSettings, studentNotifications, parents, studentParents, studentCourses,
  lessonPackages, studentPaymentMethods, invoices, studentCredits, billingReceipts, policyFeePayments,
  bookingPolicies, bookingPolicyVersions, policyOverrideLogs, payerProfiles, paymentIntakes, paymentAllocations, paymentAuditLogs,
  payerProfileStudents, payrollAccessLogs, studentNotes,
  type User, type UpsertUser, type Student, type InsertStudent,
  type Instructor, type InsertInstructor, type Class, type InsertClass,
  type ClassEnrollment, type InsertClassEnrollment, 
  type ContractTemplate, type InsertContractTemplate, type Contract, type InsertContract,
  type Evaluation, type InsertEvaluation, type Note, type InsertNote,
  type Communication, type InsertCommunication,
  type InstructorAvailability, type InsertInstructorAvailability,
  type InstructorReminderSettings, type InsertInstructorReminderSettings,
  type ZoomMeeting, type InsertZoomMeeting, type ZoomAttendance, type InsertZoomAttendance,
  type ZoomSettings, type InsertZoomSettings, type SchoolPermit, type InsertSchoolPermit,
  type PermitNumber, type InsertPermitNumber, type StudentTransaction, type InsertStudentTransaction,
  type TransferCredit, type InsertTransferCredit, type Location, type InsertLocation,
  type Vehicle, type InsertVehicle, type StudentNotification, type InsertStudentNotification,
  type Parent, type InsertParent, type StudentParent, type InsertStudentParent,
  type StudentCourse, type InsertStudentCourse,
  type LessonPackage, type InsertLessonPackage, type StudentPaymentMethod, type InsertStudentPaymentMethod,
  type Invoice, type InsertInvoice, type StudentCredit, type InsertStudentCredit,
  type BillingReceipt, type InsertBillingReceipt, type StudentDocument, type InsertStudentDocument,
  type BookingPolicy, type InsertBookingPolicy,
  type BookingPolicyVersion, type InsertBookingPolicyVersion,
  type PolicyOverrideLog, type InsertPolicyOverrideLog,
  type PayerProfile, type InsertPayerProfile, type PaymentIntake, type InsertPaymentIntake,
  type PaymentAllocation, type InsertPaymentAllocation, type PaymentAuditLog, type InsertPaymentAuditLog,
  type PayerProfileStudent, type InsertPayerProfileStudent,
  type PaymentTransaction, type PayrollAccessLog, type InsertPayrollAccessLog,
  type StudentNote, type InsertStudentNote
} from "@shared/schema";
import { db } from "./db";
import { eq, and, sql, gte, lte, isNotNull, isNull } from "drizzle-orm";

export interface IStorage {
  // Users - Basic Auth methods
  getUsers(): Promise<User[]>;
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: UpsertUser): Promise<User>;
  // (IMPORTANT) this user operation is mandatory for Replit Auth.
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Students
  getStudents(): Promise<Student[]>;
  searchStudents(params: {
    searchTerm?: string;
    courseType?: string;
    status?: string;
    locationId?: number;
    phoneNumber?: string;
    attestationNumber?: string;
    contractNumber?: string;
    dateOfBirth?: string;
    enrollmentDate?: string;
    isTransfer?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ students: Student[]; total: number }>;
  getStudent(id: number): Promise<Student | undefined>;
  createStudent(student: InsertStudent): Promise<Student>;
  updateStudent(id: number, student: Partial<InsertStudent>): Promise<Student>;
  deleteStudent(id: number): Promise<void>;
  
  // Student Portal Methods
  getStudentByEmail(email: string): Promise<Student | undefined>;
  getStudentByInviteToken(token: string): Promise<Student | undefined>;
  getStudentByResetToken(token: string): Promise<Student | undefined>;
  getStudentNotifications(studentId: number): Promise<StudentNotification[]>;
  createStudentNotification(notification: InsertStudentNotification): Promise<StudentNotification>;
  markNotificationAsRead(notificationId: number): Promise<void>;
  getStudentClasses(studentId: number): Promise<Class[]>;
  getStudentPaymentHistory(studentId: number): Promise<StudentTransaction[]>;
  
  // Student Documents
  getStudentDocuments(studentId: number): Promise<StudentDocument[]>;
  createStudentDocument(document: InsertStudentDocument): Promise<StudentDocument>;
  updateStudentDocument(id: number, document: Partial<InsertStudentDocument>): Promise<StudentDocument>;
  deleteStudentDocument(id: number): Promise<void>;
  
  // Student Notes
  getStudentNotes(studentId: number, noteType?: string): Promise<StudentNote[]>;
  createStudentNote(note: InsertStudentNote): Promise<StudentNote>;
  deleteStudentNote(id: number): Promise<void>;
  
  // Parents & Guardians
  getParents(): Promise<Parent[]>;
  getParent(id: number): Promise<Parent | undefined>;
  getParentByEmail(email: string): Promise<Parent | undefined>;
  getParentByInviteToken(token: string): Promise<Parent | undefined>;
  getParentByResetToken(token: string): Promise<Parent | undefined>;
  createParent(parent: InsertParent): Promise<Parent>;
  updateParent(id: number, parent: Partial<InsertParent>): Promise<Parent>;
  deleteParent(id: number): Promise<void>;
  
  // Student-Parent Relationships
  getStudentParents(studentId: number): Promise<StudentParent[]>;
  getParentStudents(parentId: number): Promise<StudentParent[]>;
  createStudentParent(relationship: InsertStudentParent): Promise<StudentParent>;
  updateStudentParent(id: number, relationship: Partial<InsertStudentParent>): Promise<StudentParent>;
  deleteStudentParent(id: number): Promise<void>;
  
  // Student Course Enrollments
  getStudentCourses(studentId: number): Promise<StudentCourse[]>;
  getStudentCourse(id: number): Promise<StudentCourse | undefined>;
  createStudentCourse(course: InsertStudentCourse): Promise<StudentCourse>;
  updateStudentCourse(id: number, course: Partial<InsertStudentCourse>): Promise<StudentCourse>;
  deleteStudentCourse(id: number): Promise<void>;
  
  // Booking Policies
  getBookingPolicies(): Promise<BookingPolicy[]>;
  getBookingPolicy(id: number): Promise<BookingPolicy | undefined>;
  getActiveBookingPolicies(courseType?: string, classType?: string): Promise<BookingPolicy[]>;
  createBookingPolicy(policy: InsertBookingPolicy): Promise<BookingPolicy>;
  updateBookingPolicy(id: number, policy: Partial<InsertBookingPolicy>): Promise<BookingPolicy>;
  deleteBookingPolicy(id: number): Promise<void>;
  
  // Policy Override Logs
  getPolicyOverrideLogs(filters?: { staffUserId?: number; studentId?: number; startDate?: string; endDate?: string }): Promise<PolicyOverrideLog[]>;
  getPolicyOverrideLog(id: number): Promise<PolicyOverrideLog | undefined>;
  createPolicyOverrideLog(log: InsertPolicyOverrideLog): Promise<PolicyOverrideLog>;
  updatePolicyOverrideLog(id: number, updates: Partial<InsertPolicyOverrideLog>): Promise<PolicyOverrideLog>;
  
  // Analytics
  getStudentCompletionAnalytics(enrollmentYear?: number, completionYear?: number): Promise<{
    enrollmentYear: number;
    completionYear: number | null;
    studentsStarted: number;
    studentsCompleted: number;
    courseType: string;
    completionRate: number;
  }[]>;
  
  getStudentRegistrationAnalytics(params: {
    period: 'day' | 'month' | 'year';
    startDate?: string;
    endDate?: string;
    locationId?: number;
  }): Promise<{
    period: string;
    locationId: number | null;
    locationName: string | null;
    registrations: number;
    courseType: string;
  }[]>;
  
  // Instructors
  getInstructors(): Promise<Instructor[]>;
  getInstructor(id: number): Promise<Instructor | undefined>;
  getInstructorByEmail(email: string): Promise<Instructor | undefined>;
  getInstructorByInviteToken(token: string): Promise<Instructor | undefined>;
  createInstructor(instructor: InsertInstructor): Promise<Instructor>;
  updateInstructor(id: number, instructor: Partial<InsertInstructor>): Promise<Instructor>;
  deleteInstructor(id: number): Promise<void>;
  
  // Instructor Hours Analytics
  getInstructorHours(params: {
    instructorId?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<{
    instructorId: number;
    instructorName: string;
    theoryHours: number;
    practicalHours: number;
    totalHours: number;
  }[]>;

  // Instructor-specific methods
  getInstructorStudents(instructorId: number): Promise<Student[]>;
  getInstructorClasses(instructorId: number): Promise<Class[]>;
  getInstructorEvaluations(instructorId: number): Promise<Evaluation[]>;
  getInstructorClassesNeedingEvaluation(instructorId: number): Promise<any[]>;
  
  // Classes
  getClasses(): Promise<Class[]>;
  getClass(id: number): Promise<Class | undefined>;
  createClass(classData: InsertClass): Promise<Class>;
  updateClass(id: number, classData: Partial<InsertClass>): Promise<Class>;
  deleteClass(id: number): Promise<void>;
  confirmClassVehicle(classId: number): Promise<void>;
  confirmClass(classId: number): Promise<void>;
  requestClassChange(classId: number, reason: string, suggestedTime?: string): Promise<void>;
  
  // Class Enrollments
  getClassEnrollments(): Promise<ClassEnrollment[]>;
  getClassEnrollment(id: number): Promise<ClassEnrollment | undefined>;
  getClassEnrollmentsByClass(classId: number): Promise<ClassEnrollment[]>;
  getClassEnrollmentsByStudent(studentId: number): Promise<ClassEnrollment[]>;
  createClassEnrollment(enrollment: InsertClassEnrollment): Promise<ClassEnrollment>;
  updateClassEnrollment(id: number, enrollment: Partial<InsertClassEnrollment>): Promise<ClassEnrollment>;
  deleteClassEnrollment(id: number): Promise<void>;
  
  // Class Booking
  getAvailableClasses(studentId: number, filters?: { courseType?: string; instructorId?: number; startDate?: string; endDate?: string }): Promise<Array<Class & { instructorName: string; enrolledCount: number; spotsRemaining: number }>>;
  bookClass(studentId: number, classId: number): Promise<{ success: boolean; message?: string; enrollment?: ClassEnrollment }>;
  
  // Contract Templates
  getContractTemplates(): Promise<ContractTemplate[]>;
  getContractTemplate(id: number): Promise<ContractTemplate | undefined>;
  getContractTemplateByType(courseType: string): Promise<ContractTemplate | undefined>;
  createContractTemplate(template: InsertContractTemplate): Promise<ContractTemplate>;
  updateContractTemplate(id: number, template: Partial<InsertContractTemplate>): Promise<ContractTemplate>;
  
  // Contracts
  getContracts(): Promise<Contract[]>;
  getContract(id: number): Promise<Contract | undefined>;
  getContractsByStudent(studentId: number): Promise<Contract[]>;
  createContract(contract: InsertContract): Promise<Contract>;
  updateContract(id: number, contract: Partial<InsertContract>): Promise<Contract>;
  
  // Evaluations
  getEvaluations(): Promise<Evaluation[]>;
  getEvaluation(id: number): Promise<Evaluation | undefined>;
  getEvaluationsByStudent(studentId: number): Promise<Evaluation[]>;
  createEvaluation(evaluation: InsertEvaluation): Promise<Evaluation>;
  updateEvaluation(id: number, evaluation: Partial<InsertEvaluation>): Promise<Evaluation>;
  
  // Notes
  getNotes(): Promise<Note[]>;
  getNote(id: number): Promise<Note | undefined>;
  getNotesByStudent(studentId: number): Promise<Note[]>;
  createNote(note: InsertNote): Promise<Note>;
  updateNote(id: number, note: Partial<InsertNote>): Promise<Note>;
  deleteNote(id: number): Promise<void>;
  
  // Communications
  getCommunications(): Promise<Communication[]>;
  getCommunication(id: number): Promise<Communication | undefined>;
  createCommunication(communication: InsertCommunication): Promise<Communication>;
  updateCommunication(id: number, communication: Partial<InsertCommunication>): Promise<Communication>;
  
  // Instructor Availability
  getInstructorAvailability(instructorId: number): Promise<InstructorAvailability[]>;
  createInstructorAvailability(availability: InsertInstructorAvailability): Promise<InstructorAvailability>;
  updateInstructorAvailability(id: number, availability: Partial<InsertInstructorAvailability>): Promise<InstructorAvailability>;
  deleteInstructorAvailability(id: number): Promise<void>;
  
  // Instructor Reminder Settings
  getInstructorReminderSettings(instructorId: number): Promise<InstructorReminderSettings | undefined>;
  getAllInstructorReminderSettings(): Promise<InstructorReminderSettings[]>;
  upsertInstructorReminderSettings(instructorId: number, settings: Partial<InsertInstructorReminderSettings>): Promise<InstructorReminderSettings>;
  updateInstructorReminderLastSent(instructorId: number): Promise<void>;
  
  // Zoom Meetings
  getZoomMeeting(id: number): Promise<ZoomMeeting | undefined>;
  getZoomMeetingByZoomId(zoomMeetingId: string): Promise<ZoomMeeting | undefined>;
  getZoomMeetingsByClass(classId: number): Promise<ZoomMeeting[]>;
  createZoomMeeting(meeting: InsertZoomMeeting): Promise<ZoomMeeting>;
  updateZoomMeeting(id: number, meeting: Partial<InsertZoomMeeting>): Promise<ZoomMeeting>;
  deleteZoomMeeting(id: number): Promise<void>;
  
  // Zoom Attendance
  getZoomAttendance(id: number): Promise<ZoomAttendance | undefined>;
  getZoomAttendanceByMeeting(zoomMeetingId: number): Promise<ZoomAttendance[]>;
  getZoomAttendanceByStudent(studentId: number): Promise<ZoomAttendance[]>;
  createZoomAttendance(attendance: InsertZoomAttendance): Promise<ZoomAttendance>;
  updateZoomAttendance(id: number, attendance: Partial<InsertZoomAttendance>): Promise<ZoomAttendance>;
  deleteZoomAttendance(id: number): Promise<void>;
  
  // Zoom Settings
  getZoomSettings(): Promise<ZoomSettings>;
  updateZoomSettings(settings: Partial<InsertZoomSettings>): Promise<ZoomSettings>;
  
  // School Permits
  getSchoolPermits(): Promise<SchoolPermit[]>;
  getSchoolPermit(id: number): Promise<SchoolPermit | undefined>;
  createSchoolPermit(permit: InsertSchoolPermit): Promise<SchoolPermit>;
  updateSchoolPermit(id: number, permit: Partial<InsertSchoolPermit>): Promise<SchoolPermit>;
  deleteSchoolPermit(id: number): Promise<void>;
  
  // Permit Numbers
  getPermitNumbers(permitId: number): Promise<PermitNumber[]>;
  getAvailablePermitNumber(permitId: number, courseType: string): Promise<PermitNumber | undefined>;
  assignPermitNumber(permitNumberId: number, studentId: number): Promise<PermitNumber>;
  getAssignedPermitNumbers(studentId: number): Promise<PermitNumber[]>;
  
  // Student Transactions
  getStudentTransactions(studentId?: number): Promise<StudentTransaction[]>;
  createStudentTransaction(transaction: InsertStudentTransaction): Promise<StudentTransaction>;
  
  // Payment Transactions (legacy)
  getPaymentTransactions(studentId?: number): Promise<PaymentTransaction[]>;
  
  // Transfer Credits
  getTransferCredits(): Promise<TransferCredit[]>;
  getTransferCredit(id: number): Promise<TransferCredit | undefined>;
  getTransferCreditsByStudent(studentId: number): Promise<TransferCredit[]>;
  createTransferCredit(transferCredit: InsertTransferCredit): Promise<TransferCredit>;
  updateTransferCredit(id: number, transferCredit: Partial<InsertTransferCredit>): Promise<TransferCredit>;
  deleteTransferCredit(id: number): Promise<void>;
  
  // Locations
  getLocations(): Promise<Location[]>;
  getLocation(id: number): Promise<Location | undefined>;
  getActiveLocations(): Promise<Location[]>;
  createLocation(location: InsertLocation): Promise<Location>;
  updateLocation(id: number, location: Partial<InsertLocation>): Promise<Location>;
  deleteLocation(id: number): Promise<void>;
  
  // Vehicles
  getVehicles(): Promise<Vehicle[]>;
  getVehicle(id: number): Promise<Vehicle | undefined>;
  getActiveVehicles(): Promise<Vehicle[]>;
  createVehicle(vehicle: InsertVehicle): Promise<Vehicle>;
  updateVehicle(id: number, vehicle: Partial<InsertVehicle>): Promise<Vehicle>;
  deleteVehicle(id: number): Promise<void>;
  
  // Settings
  getSettings(): Promise<{ [key: string]: string }>;
  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;
  getNextContractNumber(): Promise<number>;
  incrementContractNumber(): Promise<number>;
  
  // Billing System
  getLessonPackages(): Promise<LessonPackage[]>;
  getActiveLessonPackages(courseType?: string): Promise<LessonPackage[]>;
  createLessonPackage(pkg: InsertLessonPackage): Promise<LessonPackage>;
  updateLessonPackage(id: number, pkg: Partial<InsertLessonPackage>): Promise<LessonPackage>;
  
  getStudentPaymentMethods(studentId: number): Promise<StudentPaymentMethod[]>;
  createStudentPaymentMethod(method: InsertStudentPaymentMethod): Promise<StudentPaymentMethod>;
  setDefaultPaymentMethod(studentId: number, methodId: number): Promise<void>;
  deleteStudentPaymentMethod(id: number): Promise<void>;
  
  getStudentInvoices(studentId: number): Promise<Invoice[]>;
  getUnpaidInvoices(studentId: number): Promise<Invoice[]>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  updateInvoiceStatus(id: number, status: string): Promise<Invoice>;
  
  getStudentCredits(studentId: number): Promise<StudentCredit[]>;
  getAvailableCredits(studentId: number): Promise<number>;
  createStudentCredit(credit: InsertStudentCredit): Promise<StudentCredit>;
  useStudentCredit(creditId: number): Promise<void>;
  
  getBillingReceipt(transactionId: number): Promise<BillingReceipt | undefined>;
  createBillingReceipt(receipt: InsertBillingReceipt): Promise<BillingReceipt>;
  
  // Lesson Notes (internal instructor notes after lessons)
  getLessonNotesByInstructor(instructorId: number): Promise<any[]>;
  getLessonNotesByStudent(studentId: number): Promise<any[]>;
  getLessonNote(id: number): Promise<any | undefined>;
  createLessonNote(note: {
    studentId: number;
    instructorId: number;
    classId?: number;
    lessonDate: string;
    lessonType: string;
    duration: number;
    notes: string;
    instructorFeedback?: string;
    status: string;
  }): Promise<any>;
  updateLessonNote(id: number, note: {
    notes?: string;
    instructorFeedback?: string;
  }): Promise<any>;
  
  // Payment Reconciliation
  getPaymentIntakes(filters?: { status?: string; startDate?: string; endDate?: string; search?: string }): Promise<PaymentIntake[]>;
  getPaymentIntake(id: number): Promise<PaymentIntake | undefined>;
  createPaymentIntake(intake: InsertPaymentIntake): Promise<PaymentIntake>;
  updatePaymentIntake(id: number, intake: Partial<InsertPaymentIntake>): Promise<PaymentIntake>;
  
  getPaymentAllocations(paymentIntakeId: number): Promise<PaymentAllocation[]>;
  createPaymentAllocation(allocation: InsertPaymentAllocation): Promise<PaymentAllocation>;
  
  getPaymentAuditLogs(paymentIntakeId: number): Promise<PaymentAuditLog[]>;
  createPaymentAuditLog(log: InsertPaymentAuditLog): Promise<PaymentAuditLog>;
  
  // Payroll access audit logging
  createPayrollAccessLog(log: InsertPayrollAccessLog): Promise<PayrollAccessLog>;
  getPayrollAccessLogs(): Promise<PayrollAccessLog[]>;
  
  getPayerProfiles(filters?: { search?: string; studentId?: number }): Promise<PayerProfile[]>;
  getPayerProfile(id: number): Promise<PayerProfile | undefined>;
  createPayerProfile(payer: InsertPayerProfile): Promise<PayerProfile>;
  updatePayerProfile(id: number, payer: Partial<InsertPayerProfile>): Promise<PayerProfile>;
  
  // Payer-Student linking (many-to-many for families with multiple students)
  getPayerProfileStudents(payerProfileId: number): Promise<PayerProfileStudent[]>;
  addPayerProfileStudent(link: InsertPayerProfileStudent): Promise<PayerProfileStudent>;
  removePayerProfileStudent(payerProfileId: number, studentId: number): Promise<void>;
  getPayerProfilesWithStudents(): Promise<(PayerProfile & { linkedStudents: Student[] })[]>;
  
  // Parent selected student context
  updateParentSelectedStudent(parentId: number, studentId: number | null): Promise<Parent>;
  
  searchStudents(query: string): Promise<Student[]>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User> = new Map();
  private students: Map<number, Student> = new Map();
  private instructors: Map<number, Instructor> = new Map();
  private classes: Map<number, Class> = new Map();
  private classEnrollments: Map<number, ClassEnrollment> = new Map();
  private contracts: Map<number, Contract> = new Map();
  private evaluations: Map<number, Evaluation> = new Map();
  private notes: Map<number, Note> = new Map();
  private communications: Map<number, Communication> = new Map();
  private instructorAvailability: Map<number, InstructorAvailability> = new Map();
  private studentTransactions: Map<number, StudentTransaction> = new Map();
  
  private currentId = 1;
  private settings: Map<string, string> = new Map();

  constructor() {
    this.seedData();
    this.initializeSettings();
  }

  private initializeSettings() {
    // Initialize default settings
    this.settings.set('nextContractNumber', '1');
  }

  private seedData() {
    // Create admin user
    const adminUser: User = {
      id: `user-${this.currentId++}`,
      email: "admin@mortys.com",
      firstName: "Admin",
      lastName: "User",
      profileImageUrl: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.users.set(adminUser.id, adminUser);

    // Create sample instructors
    const instructor1: Instructor = {
      id: this.currentId++,
      userId: null,
      firstName: "Mike",
      lastName: "Wilson",
      email: "mike.wilson@mortys.com",
      phone: "(555) 123-4567",
      specializations: ["auto"],
      instructorLicenseNumber: "INS-001",
      permitNumber: null,
      locationAssignment: null,
      secondaryLocations: null,
      vehicleId: null,
      status: "active",
      digitalSignature: null,
      hireDate: null,
      certificationExpiry: null,
      emergencyContact: null,
      emergencyPhone: null,
      notes: null
    };
    const instructor2: Instructor = {
      id: this.currentId++,
      userId: null,
      firstName: "Lisa",
      lastName: "Chen",
      email: "lisa.chen@mortys.com",
      phone: "(555) 234-5678",
      specializations: ["moto", "scooter"],
      instructorLicenseNumber: "INS-002",
      permitNumber: null,
      locationAssignment: null,
      secondaryLocations: null,
      vehicleId: null,
      status: "active",
      digitalSignature: null,
      hireDate: null,
      certificationExpiry: null,
      emergencyContact: null,
      emergencyPhone: null,
      notes: null
    };
    const instructor3: Instructor = {
      id: this.currentId++,
      userId: null,
      firstName: "David",
      lastName: "Kim",
      email: "david.kim@mortys.com",
      phone: "(555) 345-6789",
      specializations: ["auto", "moto", "scooter"],
      instructorLicenseNumber: "INS-003",
      permitNumber: null,
      locationAssignment: null,
      secondaryLocations: null,
      vehicleId: null,
      status: "active",
      digitalSignature: null,
      hireDate: null,
      certificationExpiry: null,
      emergencyContact: null,
      emergencyPhone: null,
      notes: null
    };

    this.instructors.set(instructor1.id, instructor1);
    this.instructors.set(instructor2.id, instructor2);
    this.instructors.set(instructor3.id, instructor3);

    // Create sample students
    const student1: Student = {
      id: this.currentId++,
      userId: null,
      firstName: "Sarah",
      lastName: "Johnson",
      email: "sarah.j@email.com",
      phone: "(555) 987-6543",
      homePhone: null,
      primaryLanguage: "English",
      dateOfBirth: "1995-03-15",
      address: "123 Main St",
      city: "Montreal",
      postalCode: "H1A 1A1",
      province: "Quebec",
      country: "Canada",
      courseType: "auto",
      status: "active",
      progress: 75,
      phase: null,
      instructorId: instructor1.id,
      favoriteInstructorId: null,
      locationId: null,
      attestationNumber: "ATT-2024-001",
      contractNumber: null,
      started: null,
      emergencyContact: "John Johnson",
      emergencyPhone: "(555) 987-6544",
      legacyId: null,
      enrollmentDate: null,
      completionDate: null,
      transferredFrom: null,
      transferredCredits: null,
      totalHoursCompleted: null,
      totalHoursRequired: null,
      theoryHoursCompleted: null,
      practicalHoursCompleted: null,
      totalAmountDue: null,
      amountPaid: null,
      paymentPlan: null,
      lastPaymentDate: null,
      governmentId: null,
      driverLicenseNumber: null,
      licenseExpiryDate: null,
      medicalCertificate: null,
      visionTest: null,
      profilePhoto: null,
      digitalSignature: null,
      signatureConsent: null,
      testScores: null,
      finalExamScore: null,
      roadTestDate: null,
      roadTestResult: null,
      specialNeeds: null,
      accommodations: null,
      languagePreference: null,
      currentTheoryClass: null,
      currentInCarSession: null,
      completedTheoryClasses: null,
      completedInCarSessions: null
    };
    const student2: Student = {
      id: this.currentId++,
      userId: null,
      firstName: "Mike",
      lastName: "Rodriguez",
      email: "mike.r@email.com",
      phone: "(555) 876-5432",
      homePhone: null,
      primaryLanguage: "English",
      dateOfBirth: "1992-07-22",
      address: "456 Oak Ave",
      city: "Montreal",
      postalCode: "H1B 2B2",
      province: "Quebec",
      country: "Canada",
      courseType: "moto",
      status: "active",
      progress: 40,
      phase: null,
      instructorId: instructor2.id,
      favoriteInstructorId: null,
      locationId: null,
      attestationNumber: "ATT-2024-002",
      contractNumber: null,
      started: null,
      emergencyContact: "Maria Rodriguez",
      emergencyPhone: "(555) 876-5433",
      legacyId: null,
      enrollmentDate: null,
      completionDate: null,
      transferredFrom: null,
      transferredCredits: null,
      totalHoursCompleted: null,
      totalHoursRequired: null,
      theoryHoursCompleted: null,
      practicalHoursCompleted: null,
      totalAmountDue: null,
      amountPaid: null,
      paymentPlan: null,
      lastPaymentDate: null,
      governmentId: null,
      driverLicenseNumber: null,
      licenseExpiryDate: null,
      medicalCertificate: null,
      visionTest: null,
      profilePhoto: null,
      digitalSignature: null,
      signatureConsent: null,
      testScores: null,
      finalExamScore: null,
      roadTestDate: null,
      roadTestResult: null,
      specialNeeds: null,
      accommodations: null,
      languagePreference: null,
      currentTheoryClass: null,
      currentInCarSession: null,
      completedTheoryClasses: null,
      completedInCarSessions: null
    };

    this.students.set(student1.id, student1);
    this.students.set(student2.id, student2);

    // Create sample classes
    const class1: Class = {
      id: this.currentId++,
      courseType: "auto",
      classNumber: 5,
      date: "2024-12-19",
      time: "14:00",
      duration: 120,
      instructorId: instructor1.id,
      room: "Room A1",
      maxStudents: 15,
      status: "scheduled",
      zoomLink: "https://zoom.us/j/123456789",
      hasTest: true
    };
    const class2: Class = {
      id: this.currentId++,
      courseType: "moto",
      classNumber: 2,
      date: "2024-12-19",
      time: "16:30",
      duration: 120,
      instructorId: instructor2.id,
      room: "Room B2",
      maxStudents: 12,
      status: "scheduled",
      zoomLink: "https://zoom.us/j/987654321",
      hasTest: false
    };

    this.classes.set(class1.id, class1);
    this.classes.set(class2.id, class2);

    // Create sample contracts
    const contract1: Contract = {
      id: this.currentId++,
      studentId: student1.id,
      courseType: "auto",
      contractDate: "2024-11-15",
      amount: "1200.00",
      paymentMethod: "installment",
      status: "active",
      specialNotes: null,
      attestationGenerated: false
    };

    this.contracts.set(contract1.id, contract1);
  }

  // Users
  async getUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.email === username);
  }

  async createUser(insertUser: UpsertUser): Promise<User> {
    const id = `user-${this.currentId++}`;
    const user: User = { 
      ...insertUser, 
      id,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.users.set(id, user);
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    // For existing user, update and return
    if (userData.id) {
      const existingUser = this.users.get(userData.id);
      if (existingUser) {
        const updatedUser: User = {
          ...existingUser,
          ...userData,
          updatedAt: new Date()
        };
        this.users.set(userData.id, updatedUser);
        return updatedUser;
      }
    }
    
    // For new user, create and return
    const id = userData.id || `user-${this.currentId++}`;
    const user: User = {
      ...userData,
      id,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.users.set(id, user);
    return user;
  }

  // Students
  async getStudents(): Promise<Student[]> {
    return Array.from(this.students.values());
  }

  async getStudent(id: number): Promise<Student | undefined> {
    return this.students.get(id);
  }

  async searchStudents(params: {
    searchTerm?: string;
    courseType?: string;
    status?: string;
    locationId?: number;
    phoneNumber?: string;
    attestationNumber?: string;
    contractNumber?: string;
    dateOfBirth?: string;
    enrollmentDate?: string;
    isTransfer?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ students: Student[]; total: number }> {
    let allStudents = Array.from(this.students.values());
    
    // Apply filters
    if (params.searchTerm) {
      const term = params.searchTerm.toLowerCase();
      allStudents = allStudents.filter(s => 
        s.firstName.toLowerCase().includes(term) ||
        s.lastName.toLowerCase().includes(term) ||
        s.email.toLowerCase().includes(term) ||
        (s.phone && s.phone.includes(term)) ||
        (s.attestationNumber && s.attestationNumber.toLowerCase().includes(term))
      );
    }
    
    if (params.courseType) {
      allStudents = allStudents.filter(s => s.courseType === params.courseType);
    }
    
    if (params.status) {
      allStudents = allStudents.filter(s => s.status === params.status);
    }
    
    if (params.locationId) {
      allStudents = allStudents.filter(s => s.locationId === params.locationId);
    }
    
    if (params.phoneNumber) {
      const phone = params.phoneNumber.toLowerCase();
      allStudents = allStudents.filter(s => s.phone && s.phone.toLowerCase().includes(phone));
    }
    
    if (params.attestationNumber) {
      const attest = params.attestationNumber.toLowerCase();
      allStudents = allStudents.filter(s => s.attestationNumber && s.attestationNumber.toLowerCase().includes(attest));
    }

    if (params.contractNumber) {
      const contractTerm = params.contractNumber.toLowerCase();
      const allContracts = Array.from(this.contracts.values());
      const matchingStudentIds = new Set(
        allContracts
          .filter(c => c.contractNumber && c.contractNumber.toLowerCase().includes(contractTerm))
          .map(c => c.studentId)
      );
      allStudents = allStudents.filter(s => matchingStudentIds.has(s.id));
    }
    
    if (params.dateOfBirth) {
      allStudents = allStudents.filter(s => s.dateOfBirth === params.dateOfBirth);
    }
    
    if (params.enrollmentDate) {
      allStudents = allStudents.filter(s => s.enrollmentDate === params.enrollmentDate);
    }

    if (params.isTransfer === true) {
      allStudents = allStudents.filter(s => s.transferredFrom && s.transferredFrom.trim() !== '');
    }
    
    const total = allStudents.length;
    
    // Apply pagination
    const offset = params.offset || 0;
    const limit = params.limit || total;
    const students = allStudents.slice(offset, offset + limit);
    
    return { students, total };
  }

  async createStudent(insertStudent: InsertStudent): Promise<Student> {
    const id = this.currentId++;
    const student: Student = { 
      ...insertStudent, 
      id,
      // Set default values for required fields that might be missing
      progress: insertStudent.progress ?? 0,
      city: insertStudent.city ?? null,
      postalCode: insertStudent.postalCode ?? null,
      province: insertStudent.province ?? null,
      country: insertStudent.country ?? "Canada",
      favoriteInstructorId: insertStudent.favoriteInstructorId ?? null,
      legacyId: insertStudent.legacyId ?? null,
      enrollmentDate: insertStudent.enrollmentDate ?? null,
      completionDate: insertStudent.completionDate ?? null,
      transferredFrom: insertStudent.transferredFrom ?? null,
      transferredCredits: insertStudent.transferredCredits ?? null,
      totalHoursCompleted: insertStudent.totalHoursCompleted ?? null,
      totalHoursRequired: insertStudent.totalHoursRequired ?? null,
      theoryHoursCompleted: insertStudent.theoryHoursCompleted ?? null,
      practicalHoursCompleted: insertStudent.practicalHoursCompleted ?? null,
      totalAmountDue: insertStudent.totalAmountDue ?? null,
      amountPaid: insertStudent.amountPaid ?? null,
      paymentPlan: insertStudent.paymentPlan ?? null,
      lastPaymentDate: insertStudent.lastPaymentDate ?? null,
      governmentId: insertStudent.governmentId ?? null,
      driverLicenseNumber: insertStudent.driverLicenseNumber ?? null,
      licenseExpiryDate: insertStudent.licenseExpiryDate ?? null,
      medicalCertificate: insertStudent.medicalCertificate ?? null,
      visionTest: insertStudent.visionTest ?? null,
      profilePhoto: insertStudent.profilePhoto ?? null,
      digitalSignature: insertStudent.digitalSignature ?? null,
      signatureConsent: insertStudent.signatureConsent ?? null,
      testScores: insertStudent.testScores ?? null,
      finalExamScore: insertStudent.finalExamScore ?? null,
      roadTestDate: insertStudent.roadTestDate ?? null,
      roadTestResult: insertStudent.roadTestResult ?? null,
      specialNeeds: insertStudent.specialNeeds ?? null,
      accommodations: insertStudent.accommodations ?? null,
      languagePreference: insertStudent.languagePreference ?? null,
      homePhone: insertStudent.homePhone ?? null,
      primaryLanguage: insertStudent.primaryLanguage ?? "English",
    };
    this.students.set(id, student);
    return student;
  }

  async updateStudent(id: number, updateData: Partial<InsertStudent>): Promise<Student> {
    const student = this.students.get(id);
    if (!student) throw new Error("Student not found");
    const updated = { ...student, ...updateData };
    this.students.set(id, updated);
    return updated;
  }

  async deleteStudent(id: number): Promise<void> {
    this.students.delete(id);
  }

  // Student Portal Methods (stubs for in-memory storage)
  async getStudentByEmail(email: string): Promise<Student | undefined> {
    return Array.from(this.students.values()).find(s => s.email === email);
  }

  async getStudentByInviteToken(token: string): Promise<Student | undefined> {
    return Array.from(this.students.values()).find(s => s.inviteToken === token);
  }

  async getStudentByResetToken(token: string): Promise<Student | undefined> {
    return Array.from(this.students.values()).find(s => s.resetPasswordToken === token);
  }

  async getStudentNotifications(studentId: number): Promise<StudentNotification[]> {
    return [];
  }

  async createStudentNotification(notification: InsertStudentNotification): Promise<StudentNotification> {
    return {
      id: 1,
      ...notification,
      createdAt: new Date(),
    };
  }

  async markNotificationAsRead(notificationId: number): Promise<void> {
    // Stub implementation
  }

  async getStudentClasses(studentId: number): Promise<Class[]> {
    const enrollments = Array.from(this.classEnrollments.values())
      .filter(e => e.studentId === studentId);
    const classIds = enrollments.map(e => e.classId);
    return Array.from(this.classes.values()).filter(c => classIds.includes(c.id));
  }

  async getStudentPaymentHistory(studentId: number): Promise<StudentTransaction[]> {
    return [];
  }

  // Student Documents (stub implementations for in-memory storage)
  async getStudentDocuments(studentId: number): Promise<StudentDocument[]> {
    return [];
  }

  async createStudentDocument(document: InsertStudentDocument): Promise<StudentDocument> {
    throw new Error("In-memory storage does not support student documents");
  }

  async updateStudentDocument(id: number, document: Partial<InsertStudentDocument>): Promise<StudentDocument> {
    throw new Error("In-memory storage does not support student documents");
  }

  async deleteStudentDocument(id: number): Promise<void> {
    throw new Error("In-memory storage does not support student documents");
  }

  // Student Notes (stub implementations for in-memory storage)
  async getStudentNotes(studentId: number, noteType?: string): Promise<StudentNote[]> {
    return [];
  }

  async createStudentNote(note: InsertStudentNote): Promise<StudentNote> {
    throw new Error("In-memory storage does not support student notes");
  }

  async deleteStudentNote(id: number): Promise<void> {
    throw new Error("In-memory storage does not support student notes");
  }

  // Parents & Guardians (stub implementations for in-memory storage)
  async getParents(): Promise<Parent[]> {
    return [];
  }

  async getParent(id: number): Promise<Parent | undefined> {
    return undefined;
  }

  async getParentByEmail(email: string): Promise<Parent | undefined> {
    return undefined;
  }

  async getParentByInviteToken(token: string): Promise<Parent | undefined> {
    return undefined;
  }

  async getParentByResetToken(token: string): Promise<Parent | undefined> {
    return undefined;
  }

  async createParent(parent: InsertParent): Promise<Parent> {
    return {
      id: 1,
      ...parent,
    };
  }

  async updateParent(id: number, parent: Partial<InsertParent>): Promise<Parent> {
    return {
      id,
      firstName: '',
      lastName: '',
      email: '',
      ...parent,
    };
  }

  async deleteParent(id: number): Promise<void> {
    // Stub implementation
  }

  // Student-Parent Relationships (stub implementations)
  async getStudentParents(studentId: number): Promise<StudentParent[]> {
    return [];
  }

  async getParentStudents(parentId: number): Promise<StudentParent[]> {
    return [];
  }

  async createStudentParent(relationship: InsertStudentParent): Promise<StudentParent> {
    return {
      id: 1,
      ...relationship,
      addedAt: new Date(),
    };
  }

  async updateStudentParent(id: number, relationship: Partial<InsertStudentParent>): Promise<StudentParent> {
    return {
      id,
      studentId: 0,
      parentId: 0,
      permissionLevel: 'view_only',
      ...relationship,
      addedAt: new Date(),
    };
  }

  async deleteStudentParent(id: number): Promise<void> {
    // Stub implementation
  }

  // Student Course Enrollments (stub implementations)
  async getStudentCourses(studentId: number): Promise<StudentCourse[]> {
    return [];
  }

  async getStudentCourse(id: number): Promise<StudentCourse | undefined> {
    return undefined;
  }

  async createStudentCourse(course: InsertStudentCourse): Promise<StudentCourse> {
    return { id: 0, ...course } as StudentCourse;
  }

  async updateStudentCourse(id: number, course: Partial<InsertStudentCourse>): Promise<StudentCourse> {
    return { id } as StudentCourse;
  }

  async deleteStudentCourse(id: number): Promise<void> {
    // Stub implementation
  }

  // Booking Policies - Stub implementations
  async getBookingPolicies(): Promise<BookingPolicy[]> {
    return [];
  }

  async getBookingPolicy(id: number): Promise<BookingPolicy | undefined> {
    return undefined;
  }

  async getActiveBookingPolicies(courseType?: string, classType?: string): Promise<BookingPolicy[]> {
    return [];
  }

  async createBookingPolicy(policy: InsertBookingPolicy): Promise<BookingPolicy> {
    return { id: 0, ...policy, createdAt: new Date(), updatedAt: new Date() } as BookingPolicy;
  }

  async updateBookingPolicy(id: number, policy: Partial<InsertBookingPolicy>): Promise<BookingPolicy> {
    return { id, ...policy, createdAt: new Date(), updatedAt: new Date() } as BookingPolicy;
  }

  async deleteBookingPolicy(id: number): Promise<void> {
    // Stub implementation
  }

  // Policy Override Logs - Stub implementations
  async getPolicyOverrideLogs(filters?: { staffUserId?: number; studentId?: number; startDate?: string; endDate?: string }): Promise<PolicyOverrideLog[]> {
    return [];
  }

  async getPolicyOverrideLog(id: number): Promise<PolicyOverrideLog | undefined> {
    return undefined;
  }

  async createPolicyOverrideLog(log: InsertPolicyOverrideLog): Promise<PolicyOverrideLog> {
    return { id: 0, ...log, createdAt: new Date() } as PolicyOverrideLog;
  }

  async updatePolicyOverrideLog(id: number, updates: Partial<InsertPolicyOverrideLog>): Promise<PolicyOverrideLog> {
    return { id, ...updates, createdAt: new Date() } as PolicyOverrideLog;
  }

  // Instructors
  async getInstructors(): Promise<Instructor[]> {
    return Array.from(this.instructors.values());
  }

  async getInstructor(id: number): Promise<Instructor | undefined> {
    return this.instructors.get(id);
  }

  async createInstructor(insertInstructor: InsertInstructor): Promise<Instructor> {
    const id = this.currentId++;
    const instructor: Instructor = { ...insertInstructor, id };
    this.instructors.set(id, instructor);
    return instructor;
  }

  async updateInstructor(id: number, updateData: Partial<InsertInstructor>): Promise<Instructor> {
    const instructor = this.instructors.get(id);
    if (!instructor) throw new Error("Instructor not found");
    const updated = { ...instructor, ...updateData };
    this.instructors.set(id, updated);
    return updated;
  }

  async deleteInstructor(id: number): Promise<void> {
    this.instructors.delete(id);
  }

  // Analytics Methods
  async getStudentCompletionAnalytics(enrollmentYear?: number, completionYear?: number): Promise<{
    enrollmentYear: number;
    completionYear: number | null;
    studentsStarted: number;
    studentsCompleted: number;
    courseType: string;
    completionRate: number;
  }[]> {
    // Simple mock analytics - in real app would calculate from data
    return [
      {
        enrollmentYear: 2024,
        completionYear: 2024,
        studentsStarted: 100,
        studentsCompleted: 85,
        courseType: "auto",
        completionRate: 85
      }
    ];
  }

  async getStudentRegistrationAnalytics(params: {
    period: 'day' | 'month' | 'year';
    startDate?: string;
    endDate?: string;
    locationId?: number;
  }): Promise<{
    period: string;
    locationId: number | null;
    locationName: string | null;
    registrations: number;
    courseType: string;
  }[]> {
    // Simple mock analytics
    return [
      {
        period: "2024-01",
        locationId: 1,
        locationName: "Montreal Downtown",
        registrations: 15,
        courseType: "auto"
      }
    ];
  }

  // Instructor Methods
  async getInstructorHours(params: {
    instructorId?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<{
    instructorId: number;
    instructorName: string;
    theoryHours: number;
    practicalHours: number;
    totalHours: number;
  }[]> {
    return [];
  }

  async getInstructorStudents(instructorId: number): Promise<Student[]> {
    return Array.from(this.students.values()).filter(s => s.instructorId === instructorId);
  }

  async getInstructorClasses(instructorId: number): Promise<Class[]> {
    return Array.from(this.classes.values()).filter(c => c.instructorId === instructorId);
  }

  async getInstructorEvaluations(instructorId: number): Promise<Evaluation[]> {
    return Array.from(this.evaluations.values()).filter(e => e.instructorId === instructorId);
  }

  // Classes
  async getClasses(): Promise<Class[]> {
    return Array.from(this.classes.values());
  }

  async getClass(id: number): Promise<Class | undefined> {
    return this.classes.get(id);
  }

  async createClass(insertClass: InsertClass): Promise<Class> {
    const id = this.currentId++;
    const classData: Class = { ...insertClass, id };
    this.classes.set(id, classData);
    return classData;
  }

  async updateClass(id: number, updateData: Partial<InsertClass>): Promise<Class> {
    const classData = this.classes.get(id);
    if (!classData) throw new Error("Class not found");
    const updated = { ...classData, ...updateData };
    this.classes.set(id, updated);
    return updated;
  }

  async deleteClass(id: number): Promise<void> {
    this.classes.delete(id);
  }

  async confirmClassVehicle(classId: number): Promise<void> {
    const classData = this.classes.get(classId);
    if (!classData) throw new Error("Class not found");
    const updated = { 
      ...classData, 
      vehicleConfirmed: true, 
      confirmedAt: new Date().toISOString() 
    };
    this.classes.set(classId, updated);
  }

  async confirmClass(classId: number): Promise<void> {
    const classData = this.classes.get(classId);
    if (!classData) throw new Error("Class not found");
    const updated = { 
      ...classData, 
      confirmationStatus: 'confirmed',
      confirmedAt: new Date().toISOString()
    };
    this.classes.set(classId, updated);
  }

  async requestClassChange(classId: number, reason: string, suggestedTime?: string): Promise<void> {
    const classData = this.classes.get(classId);
    if (!classData) throw new Error("Class not found");
    const updated = { 
      ...classData, 
      confirmationStatus: 'change_requested',
      changeRequestReason: reason,
      changeRequestTime: suggestedTime || null,
      changeRequestedAt: new Date().toISOString()
    };
    this.classes.set(classId, updated);
  }

  // Class Enrollments
  async getClassEnrollments(): Promise<ClassEnrollment[]> {
    return Array.from(this.classEnrollments.values());
  }

  async getClassEnrollment(id: number): Promise<ClassEnrollment | undefined> {
    return this.classEnrollments.get(id);
  }

  async getClassEnrollmentsByClass(classId: number): Promise<ClassEnrollment[]> {
    return Array.from(this.classEnrollments.values()).filter(e => e.classId === classId);
  }

  async getClassEnrollmentsByStudent(studentId: number): Promise<ClassEnrollment[]> {
    return Array.from(this.classEnrollments.values()).filter(e => e.studentId === studentId);
  }

  async createClassEnrollment(insertEnrollment: InsertClassEnrollment): Promise<ClassEnrollment> {
    const id = this.currentId++;
    const enrollment: ClassEnrollment = { ...insertEnrollment, id };
    this.classEnrollments.set(id, enrollment);
    return enrollment;
  }

  async updateClassEnrollment(id: number, updateData: Partial<InsertClassEnrollment>): Promise<ClassEnrollment> {
    const enrollment = this.classEnrollments.get(id);
    if (!enrollment) throw new Error("Class enrollment not found");
    const updated = { ...enrollment, ...updateData };
    this.classEnrollments.set(id, updated);
    return updated;
  }

  async deleteClassEnrollment(id: number): Promise<void> {
    this.classEnrollments.delete(id);
  }

  async getAvailableClasses(
    studentId: number, 
    filters?: { courseType?: string; instructorId?: number; startDate?: string; endDate?: string }
  ): Promise<Array<Class & { instructorName: string; enrolledCount: number; spotsRemaining: number }>> {
    return [];
  }

  async bookClass(
    studentId: number, 
    classId: number
  ): Promise<{ success: boolean; message?: string; enrollment?: ClassEnrollment }> {
    return { success: false, message: 'MemStorage does not support class booking' };
  }

  // Contract Templates (MemStorage stub - not used in production)
  async getContractTemplates(): Promise<ContractTemplate[]> {
    return [];
  }

  async getContractTemplate(id: number): Promise<ContractTemplate | undefined> {
    return undefined;
  }

  async getContractTemplateByType(courseType: string): Promise<ContractTemplate | undefined> {
    return undefined;
  }

  async createContractTemplate(template: InsertContractTemplate): Promise<ContractTemplate> {
    throw new Error('MemStorage does not support contract templates');
  }

  async updateContractTemplate(id: number, template: Partial<InsertContractTemplate>): Promise<ContractTemplate> {
    throw new Error('MemStorage does not support contract templates');
  }

  // Contracts
  async getContracts(): Promise<Contract[]> {
    return Array.from(this.contracts.values());
  }

  async getContract(id: number): Promise<Contract | undefined> {
    return this.contracts.get(id);
  }

  async getContractsByStudent(studentId: number): Promise<Contract[]> {
    return Array.from(this.contracts.values()).filter(c => c.studentId === studentId);
  }

  async createContract(insertContract: InsertContract): Promise<Contract> {
    const id = this.currentId++;
    const contract: Contract = { ...insertContract, id };
    this.contracts.set(id, contract);
    return contract;
  }

  async updateContract(id: number, updateData: Partial<InsertContract>): Promise<Contract> {
    const contract = this.contracts.get(id);
    if (!contract) throw new Error("Contract not found");
    const updated = { ...contract, ...updateData };
    this.contracts.set(id, updated);
    return updated;
  }

  // Evaluations
  async getEvaluations(): Promise<Evaluation[]> {
    return Array.from(this.evaluations.values());
  }

  async getEvaluation(id: number): Promise<Evaluation | undefined> {
    return this.evaluations.get(id);
  }

  async getEvaluationsByStudent(studentId: number): Promise<Evaluation[]> {
    return Array.from(this.evaluations.values()).filter(e => e.studentId === studentId);
  }

  async createEvaluation(insertEvaluation: InsertEvaluation): Promise<Evaluation> {
    const id = this.currentId++;
    const evaluation: Evaluation = { ...insertEvaluation, id };
    this.evaluations.set(id, evaluation);
    return evaluation;
  }

  async updateEvaluation(id: number, updateData: Partial<InsertEvaluation>): Promise<Evaluation> {
    const evaluation = this.evaluations.get(id);
    if (!evaluation) throw new Error("Evaluation not found");
    const updated = { ...evaluation, ...updateData };
    this.evaluations.set(id, updated);
    return updated;
  }

  // Notes
  async getNotes(): Promise<Note[]> {
    return Array.from(this.notes.values());
  }

  async getNote(id: number): Promise<Note | undefined> {
    return this.notes.get(id);
  }

  async getNotesByStudent(studentId: number): Promise<Note[]> {
    return Array.from(this.notes.values()).filter(n => n.studentId === studentId);
  }

  async createNote(insertNote: InsertNote): Promise<Note> {
    const id = this.currentId++;
    const note: Note = { ...insertNote, id };
    this.notes.set(id, note);
    return note;
  }

  async updateNote(id: number, updateData: Partial<InsertNote>): Promise<Note> {
    const note = this.notes.get(id);
    if (!note) throw new Error("Note not found");
    const updated = { ...note, ...updateData };
    this.notes.set(id, updated);
    return updated;
  }

  async deleteNote(id: number): Promise<void> {
    this.notes.delete(id);
  }

  // Settings methods for MemStorage
  async getSettings(): Promise<{ [key: string]: string }> {
    const result: { [key: string]: string } = {};
    this.settings.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  async getSetting(key: string): Promise<string | undefined> {
    return this.settings.get(key);
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.settings.set(key, value);
  }

  async getNextContractNumber(): Promise<number> {
    const current = this.settings.get('nextContractNumber') || '1';
    return parseInt(current);
  }

  async incrementContractNumber(): Promise<number> {
    const current = await this.getNextContractNumber();
    const next = current + 1;
    this.settings.set('nextContractNumber', next.toString());
    return current;
  }

  // Communications
  async getCommunications(): Promise<Communication[]> {
    return Array.from(this.communications.values());
  }

  async getCommunication(id: number): Promise<Communication | undefined> {
    return this.communications.get(id);
  }

  async createCommunication(insertCommunication: InsertCommunication): Promise<Communication> {
    const id = this.currentId++;
    const communication: Communication = { ...insertCommunication, id };
    this.communications.set(id, communication);
    return communication;
  }

  async updateCommunication(id: number, updateData: Partial<InsertCommunication>): Promise<Communication> {
    const communication = this.communications.get(id);
    if (!communication) throw new Error("Communication not found");
    const updated = { ...communication, ...updateData };
    this.communications.set(id, updated);
    return updated;
  }

  async getStudentCompletionAnalytics(): Promise<any[]> {
    // Mock implementation for MemStorage
    return [];
  }

  async getStudentRegistrationAnalytics(): Promise<any[]> {
    // Mock implementation for MemStorage
    return [];
  }

  // Lesson Notes - Mock implementation for MemStorage
  async getLessonNotesByInstructor(instructorId: number): Promise<any[]> {
    return [];
  }

  async getLessonNotesByStudent(studentId: number): Promise<any[]> {
    return [];
  }

  async getLessonNote(id: number): Promise<any | undefined> {
    return undefined;
  }

  async createLessonNote(note: any): Promise<any> {
    return { id: 1, ...note };
  }

  async updateLessonNote(id: number, note: any): Promise<any> {
    return { id, ...note };
  }
}

// Database Storage Implementation
export class DatabaseStorage implements IStorage {
  // Users - Basic Auth methods
  async getUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    // Legacy method - not used in Replit Auth
    return undefined;
  }

  async createUser(userData: any): Promise<User> {
    // Legacy method - not used in Replit Auth
    const [user] = await db.insert(users).values(userData).returning();
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Traditional Auth methods for demo/development
  async getUserByUsernamePassword(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, username));
    return user || undefined;
  }

  async createDemoUser(userData: any): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Students
  async getStudents(): Promise<Student[]> {
    return await db.select().from(students);
  }

  async getStudent(id: number): Promise<Student | undefined> {
    const [student] = await db.select().from(students).where(eq(students.id, id));
    return student || undefined;
  }

  async createStudent(insertStudent: InsertStudent): Promise<Student> {
    // Generate invite token and expiry for new students
    const { generateInviteToken, getInviteExpiry, sendStudentInviteEmail } = await import('./inviteService.js');
    const inviteToken = generateInviteToken();
    const inviteExpiry = getInviteExpiry();
    
    const [student] = await db
      .insert(students)
      .values({
        ...insertStudent,
        inviteToken,
        inviteExpiry,
        accountStatus: 'pending_invite',
        inviteSentAt: new Date(),
      })
      .returning();
    
    // Send invitation email asynchronously
    try {
      await sendStudentInviteEmail(student.email, student.firstName, inviteToken);
      console.log(`Student invitation email sent to ${student.email}`);
    } catch (error) {
      console.error(`Failed to send student invitation email to ${student.email}:`, error);
      // Don't fail student creation if email fails
    }
    
    return student;
  }

  async updateStudent(id: number, updateData: Partial<InsertStudent>): Promise<Student> {
    const [student] = await db
      .update(students)
      .set(updateData)
      .where(eq(students.id, id))
      .returning();
    return student;
  }

  async deleteStudent(id: number): Promise<void> {
    await db.delete(students).where(eq(students.id, id));
  }

  // Student Portal Methods
  async getStudentByEmail(email: string): Promise<Student | undefined> {
    const result = await db.select().from(students).where(eq(students.email, email));
    return result[0];
  }

  async getStudentByInviteToken(token: string): Promise<Student | undefined> {
    const [student] = await db.select().from(students).where(eq(students.inviteToken, token));
    return student || undefined;
  }

  async getStudentByResetToken(token: string): Promise<Student | undefined> {
    const [student] = await db.select().from(students).where(eq(students.resetPasswordToken, token));
    return student || undefined;
  }

  async getStudentNotifications(studentId: number): Promise<StudentNotification[]> {
    return await db.select().from(studentNotifications)
      .where(eq(studentNotifications.studentId, studentId))
      .orderBy(sql`${studentNotifications.createdAt} DESC`);
  }

  async createStudentNotification(notification: InsertStudentNotification): Promise<StudentNotification> {
    const result = await db.insert(studentNotifications).values(notification).returning();
    return result[0];
  }

  async markNotificationAsRead(notificationId: number): Promise<void> {
    await db.update(studentNotifications)
      .set({ readAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(studentNotifications.id, notificationId));
  }

  async getStudentClasses(studentId: number): Promise<Class[]> {
    const enrollments = await db.select().from(classEnrollments)
      .where(eq(classEnrollments.studentId, studentId));
    
    const classIds = enrollments.map(e => e.classId);
    if (classIds.length === 0) return [];
    
    return await db.select().from(classes)
      .where(sql`${classes.id} IN (${sql.join(classIds.map(id => sql`${id}`), sql`, `)})`);
  }

  async getStudentPaymentHistory(studentId: number): Promise<StudentTransaction[]> {
    return await db.select().from(studentTransactions)
      .where(eq(studentTransactions.studentId, studentId))
      .orderBy(sql`${studentTransactions.createdAt} DESC`);
  }

  // Student Documents Methods
  async getStudentDocuments(studentId: number): Promise<StudentDocument[]> {
    return await db.select().from(studentDocuments)
      .where(eq(studentDocuments.studentId, studentId))
      .orderBy(sql`${studentDocuments.createdAt} DESC`);
  }

  async createStudentDocument(document: InsertStudentDocument): Promise<StudentDocument> {
    const [newDocument] = await db.insert(studentDocuments).values(document).returning();
    return newDocument;
  }

  async updateStudentDocument(id: number, document: Partial<InsertStudentDocument>): Promise<StudentDocument> {
    const [updatedDocument] = await db.update(studentDocuments)
      .set(document)
      .where(eq(studentDocuments.id, id))
      .returning();
    return updatedDocument;
  }

  async deleteStudentDocument(id: number): Promise<void> {
    await db.delete(studentDocuments).where(eq(studentDocuments.id, id));
  }

  // Parents & Guardians Methods
  async getParents(): Promise<Parent[]> {
    return await db.select().from(parents);
  }

  async getParent(id: number): Promise<Parent | undefined> {
    const result = await db.select().from(parents).where(eq(parents.id, id));
    return result[0];
  }

  async getParentByEmail(email: string): Promise<Parent | undefined> {
    const result = await db.select().from(parents).where(eq(parents.email, email));
    return result[0];
  }

  async getParentByInviteToken(token: string): Promise<Parent | undefined> {
    const [parent] = await db.select().from(parents).where(eq(parents.inviteToken, token));
    return parent || undefined;
  }

  async getParentByResetToken(token: string): Promise<Parent | undefined> {
    const [parent] = await db.select().from(parents).where(eq(parents.resetPasswordToken, token));
    return parent || undefined;
  }

  async createParent(parent: InsertParent): Promise<Parent> {
    const [newParent] = await db.insert(parents).values(parent).returning();
    return newParent;
  }

  async updateParent(id: number, updateData: Partial<InsertParent>): Promise<Parent> {
    const [parent] = await db
      .update(parents)
      .set(updateData)
      .where(eq(parents.id, id))
      .returning();
    return parent;
  }

  async deleteParent(id: number): Promise<void> {
    await db.delete(parents).where(eq(parents.id, id));
  }

  // Student-Parent Relationships
  async getStudentParents(studentId: number): Promise<StudentParent[]> {
    return await db.select().from(studentParents)
      .where(eq(studentParents.studentId, studentId));
  }

  async getParentStudents(parentId: number): Promise<StudentParent[]> {
    return await db.select().from(studentParents)
      .where(eq(studentParents.parentId, parentId));
  }

  async createStudentParent(relationship: InsertStudentParent): Promise<StudentParent> {
    const [newRelationship] = await db.insert(studentParents).values(relationship).returning();
    return newRelationship;
  }

  async updateStudentParent(id: number, updateData: Partial<InsertStudentParent>): Promise<StudentParent> {
    const [relationship] = await db
      .update(studentParents)
      .set(updateData)
      .where(eq(studentParents.id, id))
      .returning();
    return relationship;
  }

  async deleteStudentParent(id: number): Promise<void> {
    await db.delete(studentParents).where(eq(studentParents.id, id));
  }

  // Student Course Enrollments
  async getStudentCourses(studentId: number): Promise<StudentCourse[]> {
    return await db.select().from(studentCourses)
      .where(eq(studentCourses.studentId, studentId));
  }

  async getStudentCourse(id: number): Promise<StudentCourse | undefined> {
    const [course] = await db.select().from(studentCourses)
      .where(eq(studentCourses.id, id));
    return course;
  }

  async createStudentCourse(course: InsertStudentCourse): Promise<StudentCourse> {
    const [newCourse] = await db.insert(studentCourses).values(course).returning();
    return newCourse;
  }

  async updateStudentCourse(id: number, updateData: Partial<InsertStudentCourse>): Promise<StudentCourse> {
    const [course] = await db
      .update(studentCourses)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(studentCourses.id, id))
      .returning();
    return course;
  }

  async deleteStudentCourse(id: number): Promise<void> {
    await db.delete(studentCourses).where(eq(studentCourses.id, id));
  }

  // Booking Policies
  async getBookingPolicies(): Promise<BookingPolicy[]> {
    return await db.select().from(bookingPolicies);
  }

  async getBookingPolicy(id: number): Promise<BookingPolicy | undefined> {
    const [policy] = await db.select().from(bookingPolicies)
      .where(eq(bookingPolicies.id, id));
    return policy;
  }

  async getActiveBookingPolicies(courseType?: string, classType?: string): Promise<BookingPolicy[]> {
    let query = db.select().from(bookingPolicies)
      .where(eq(bookingPolicies.isActive, true));
    
    const results = await query;
    
    return results.filter(policy => {
      const courseMatch = !policy.courseType || policy.courseType === courseType;
      const classMatch = !policy.classType || policy.classType === classType;
      return courseMatch && classMatch;
    });
  }

  async createBookingPolicy(policy: InsertBookingPolicy): Promise<BookingPolicy> {
    const [newPolicy] = await db.insert(bookingPolicies).values(policy).returning();
    return newPolicy;
  }

  async updateBookingPolicy(id: number, policy: Partial<InsertBookingPolicy>): Promise<BookingPolicy> {
    const [updated] = await db.update(bookingPolicies)
      .set({ ...policy, updatedAt: new Date() })
      .where(eq(bookingPolicies.id, id))
      .returning();
    return updated;
  }

  async deleteBookingPolicy(id: number): Promise<void> {
    await db.delete(bookingPolicies).where(eq(bookingPolicies.id, id));
  }

  async updateBookingPolicyWithVersion(
    id: number, 
    policy: Partial<InsertBookingPolicy>, 
    changedBy: string, 
    changeReason?: string
  ): Promise<BookingPolicy> {
    // Get the current policy to save as version history
    const currentPolicy = await this.getBookingPolicy(id);
    if (!currentPolicy) {
      throw new Error('Policy not found');
    }

    // Save current state to version history
    await db.insert(bookingPolicyVersions).values({
      policyId: id,
      version: currentPolicy.version,
      name: currentPolicy.name,
      policyType: currentPolicy.policyType,
      courseType: currentPolicy.courseType,
      classType: currentPolicy.classType,
      value: currentPolicy.value,
      isActive: currentPolicy.isActive,
      description: currentPolicy.description,
      effectiveFrom: currentPolicy.effectiveFrom,
      effectiveTo: currentPolicy.effectiveTo,
      changedBy,
      changeReason,
    });

    // Update the policy with new version
    const [updated] = await db.update(bookingPolicies)
      .set({ 
        ...policy, 
        version: currentPolicy.version + 1,
        updatedAt: new Date() 
      })
      .where(eq(bookingPolicies.id, id))
      .returning();
    return updated;
  }

  // Booking Policy Version History
  async getBookingPolicyVersions(policyId: number): Promise<BookingPolicyVersion[]> {
    return await db.select().from(bookingPolicyVersions)
      .where(eq(bookingPolicyVersions.policyId, policyId))
      .orderBy(sql`${bookingPolicyVersions.version} DESC`);
  }

  async getBookingPolicyVersion(id: number): Promise<BookingPolicyVersion | undefined> {
    const [version] = await db.select().from(bookingPolicyVersions)
      .where(eq(bookingPolicyVersions.id, id));
    return version;
  }

  async getEffectiveBookingPolicies(courseType?: string, classType?: string): Promise<BookingPolicy[]> {
    const now = new Date();
    const results = await db.select().from(bookingPolicies)
      .where(eq(bookingPolicies.isActive, true));
    
    return results.filter(policy => {
      // Check effective dates
      const isEffective = (!policy.effectiveFrom || new Date(policy.effectiveFrom) <= now) &&
                          (!policy.effectiveTo || new Date(policy.effectiveTo) >= now);
      if (!isEffective) return false;
      
      // Check course/class type match
      const courseMatch = !policy.courseType || policy.courseType === courseType;
      const classMatch = !policy.classType || policy.classType === classType;
      return courseMatch && classMatch;
    });
  }

  // Policy Override Logs
  async getPolicyOverrideLogs(filters?: { staffUserId?: number; studentId?: number; startDate?: string; endDate?: string }): Promise<PolicyOverrideLog[]> {
    let query = db.select().from(policyOverrideLogs);
    const conditions = [];
    
    if (filters?.staffUserId) {
      conditions.push(eq(policyOverrideLogs.staffUserId, filters.staffUserId));
    }
    if (filters?.studentId) {
      conditions.push(eq(policyOverrideLogs.studentId, filters.studentId));
    }
    if (filters?.startDate) {
      conditions.push(gte(policyOverrideLogs.createdAt, new Date(filters.startDate)));
    }
    if (filters?.endDate) {
      conditions.push(lte(policyOverrideLogs.createdAt, new Date(filters.endDate)));
    }
    
    if (conditions.length > 0) {
      return await db.select().from(policyOverrideLogs).where(and(...conditions)).orderBy(sql`${policyOverrideLogs.createdAt} DESC`);
    }
    return await db.select().from(policyOverrideLogs).orderBy(sql`${policyOverrideLogs.createdAt} DESC`);
  }

  async getPolicyOverrideLog(id: number): Promise<PolicyOverrideLog | undefined> {
    const [log] = await db.select().from(policyOverrideLogs)
      .where(eq(policyOverrideLogs.id, id));
    return log;
  }

  async createPolicyOverrideLog(log: InsertPolicyOverrideLog): Promise<PolicyOverrideLog> {
    const [newLog] = await db.insert(policyOverrideLogs).values(log).returning();
    return newLog;
  }

  async updatePolicyOverrideLog(id: number, updates: Partial<InsertPolicyOverrideLog>): Promise<PolicyOverrideLog> {
    const [updatedLog] = await db.update(policyOverrideLogs)
      .set(updates)
      .where(eq(policyOverrideLogs.id, id))
      .returning();
    return updatedLog;
  }

  async searchStudents(params: {
    searchTerm?: string;
    courseType?: string;
    status?: string;
    locationId?: number;
    phoneNumber?: string;
    attestationNumber?: string;
    contractNumber?: string;
    dateOfBirth?: string;
    enrollmentDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ students: Student[]; total: number }> {
    const { searchTerm, courseType, status, locationId, phoneNumber, attestationNumber, dateOfBirth, enrollmentDate, limit = 10, offset = 0 } = params;
    
    let query = db.select().from(students);
    let countQuery = db.select({ count: sql`count(*)`.as('count') }).from(students);
    
    // Apply filters if provided
    const whereConditions = [];
    
    if (searchTerm) {
      const searchPattern = `%${searchTerm}%`;
      whereConditions.push(
        sql`(
          LOWER(${students.firstName}) LIKE LOWER(${searchPattern}) OR 
          LOWER(${students.lastName}) LIKE LOWER(${searchPattern}) OR 
          LOWER(${students.email}) LIKE LOWER(${searchPattern}) OR
          LOWER(CONCAT(${students.firstName}, ' ', ${students.lastName})) LIKE LOWER(${searchPattern}) OR
          ${students.phone} LIKE ${searchPattern} OR
          LOWER(${students.attestationNumber}) LIKE LOWER(${searchPattern})
        )`
      );
    }
    
    if (courseType && courseType !== 'all') {
      whereConditions.push(eq(students.courseType, courseType));
    }
    
    if (status && status !== 'all') {
      whereConditions.push(eq(students.status, status));
    }
    
    if (locationId) {
      whereConditions.push(eq(students.locationId, locationId));
    }
    
    if (phoneNumber) {
      const phonePattern = `%${phoneNumber}%`;
      whereConditions.push(
        sql`${students.phone} LIKE ${phonePattern}`
      );
    }
    
    if (attestationNumber) {
      const attestationPattern = `%${attestationNumber}%`;
      whereConditions.push(
        sql`${students.attestationNumber} LIKE ${attestationPattern}`
      );
    }

    if (params.contractNumber) {
      const contractPattern = `%${params.contractNumber}%`;
      whereConditions.push(
        sql`EXISTS (
          SELECT 1 FROM contracts 
          WHERE contracts.student_id = ${students.id} 
          AND LOWER(contracts.contract_number) LIKE LOWER(${contractPattern})
        )`
      );
    }
    
    if (dateOfBirth) {
      whereConditions.push(eq(students.dateOfBirth, dateOfBirth));
    }
    
    if (enrollmentDate) {
      whereConditions.push(eq(students.enrollmentDate, enrollmentDate));
    }
    
    // Apply WHERE conditions
    if (whereConditions.length > 0) {
      const combinedConditions = whereConditions.reduce((acc, condition, index) => {
        return index === 0 ? condition : and(acc, condition);
      });
      query = query.where(combinedConditions);
      countQuery = countQuery.where(combinedConditions);
    }
    
    // Get total count
    const [{ count }] = await countQuery;
    
    // Apply pagination and ordering (most recent first)
    query = query
      .orderBy(sql`${students.id} DESC`)
      .limit(limit)
      .offset(offset);
    
    const results = await query;
    
    return {
      students: results,
      total: parseInt(count as string)
    };
  }

  // Analytics
  async getStudentCompletionAnalytics(enrollmentYear?: number, completionYear?: number): Promise<{
    enrollmentYear: number;
    completionYear: number | null;
    studentsStarted: number;
    studentsCompleted: number;
    courseType: string;
    completionRate: number;
  }[]> {
    const allStudents = await db.select().from(students);
    
    // Group students by enrollment year, completion year, and course type
    const analytics: { [key: string]: any } = {};
    
    for (const student of allStudents) {
      if (!student.enrollmentDate) continue;
      
      const enrollYear = parseInt(student.enrollmentDate.split('-')[0]);
      const completYear = student.completionDate ? parseInt(student.completionDate.split('-')[0]) : null;
      const courseType = student.courseType;
      
      // Filter by enrollment year if specified
      if (enrollmentYear && enrollYear !== enrollmentYear) continue;
      
      // Filter by completion year if specified
      if (completionYear && completYear !== completionYear) continue;
      
      const key = `${enrollYear}-${completYear || 'null'}-${courseType}`;
      
      if (!analytics[key]) {
        analytics[key] = {
          enrollmentYear: enrollYear,
          completionYear: completYear,
          courseType,
          studentsStarted: 0,
          studentsCompleted: 0,
          completionRate: 0
        };
      }
      
      analytics[key].studentsStarted++;
      if (student.completionDate) {
        analytics[key].studentsCompleted++;
      }
    }
    
    // Calculate completion rates and convert to array
    const results = Object.values(analytics).map((item: any) => ({
      ...item,
      completionRate: item.studentsStarted > 0 ? Math.round((item.studentsCompleted / item.studentsStarted) * 100) : 0
    }));
    
    // Sort by enrollment year, then completion year, then course type
    return results.sort((a, b) => {
      if (a.enrollmentYear !== b.enrollmentYear) return b.enrollmentYear - a.enrollmentYear;
      if (a.completionYear !== b.completionYear) {
        if (a.completionYear === null) return 1;
        if (b.completionYear === null) return -1;
        return b.completionYear - a.completionYear;
      }
      return a.courseType.localeCompare(b.courseType);
    });
  }

  async getStudentRegistrationAnalytics(params: {
    period: 'day' | 'month' | 'year';
    startDate?: string;
    endDate?: string;
    locationId?: number;
  }): Promise<{
    period: string;
    locationId: number | null;
    locationName: string | null;
    registrations: number;
    courseType: string;
  }[]> {
    // Join students with locations to get location names
    const studentsWithLocations = await db
      .select({
        enrollmentDate: students.enrollmentDate,
        courseType: students.courseType,
        locationId: students.locationId,
        locationName: locations.name,
      })
      .from(students)
      .leftJoin(locations, eq(students.locationId, locations.id))
      .where(
        and(
          isNotNull(students.enrollmentDate),
          params.startDate ? gte(students.enrollmentDate, params.startDate) : undefined,
          params.endDate ? lte(students.enrollmentDate, params.endDate) : undefined,
          params.locationId ? eq(students.locationId, params.locationId) : undefined
        )
      );

    // Group by period, location, and course type
    const analytics: { [key: string]: any } = {};

    for (const student of studentsWithLocations) {
      if (!student.enrollmentDate) continue;

      let periodKey: string;
      const enrollmentDate = new Date(student.enrollmentDate);

      switch (params.period) {
        case 'day':
          periodKey = student.enrollmentDate; // YYYY-MM-DD
          break;
        case 'month':
          periodKey = `${enrollmentDate.getFullYear()}-${String(enrollmentDate.getMonth() + 1).padStart(2, '0')}`;
          break;
        case 'year':
          periodKey = String(enrollmentDate.getFullYear());
          break;
        default:
          periodKey = `${enrollmentDate.getFullYear()}-${String(enrollmentDate.getMonth() + 1).padStart(2, '0')}`;
      }

      const key = `${periodKey}-${student.locationId || 'null'}-${student.courseType}`;

      if (!analytics[key]) {
        analytics[key] = {
          period: periodKey,
          locationId: student.locationId,
          locationName: student.locationName,
          courseType: student.courseType,
          registrations: 0
        };
      }

      analytics[key].registrations++;
    }

    // Convert to array and sort
    const results = Object.values(analytics).sort((a: any, b: any) => {
      if (a.period !== b.period) return b.period.localeCompare(a.period);
      if (a.locationName !== b.locationName) {
        if (!a.locationName) return 1;
        if (!b.locationName) return -1;
        return a.locationName.localeCompare(b.locationName);
      }
      return a.courseType.localeCompare(b.courseType);
    });

    return results;
  }

  // Instructors
  async getInstructors(): Promise<Instructor[]> {
    return await db.select().from(instructors);
  }

  async getInstructor(id: number): Promise<Instructor | undefined> {
    const [instructor] = await db.select().from(instructors).where(eq(instructors.id, id));
    return instructor || undefined;
  }

  async getInstructorByEmail(email: string): Promise<Instructor | undefined> {
    const [instructor] = await db.select().from(instructors).where(eq(instructors.email, email));
    return instructor || undefined;
  }

  async getInstructorByInviteToken(token: string): Promise<Instructor | undefined> {
    const [instructor] = await db.select().from(instructors).where(eq(instructors.inviteToken, token));
    return instructor || undefined;
  }

  async createInstructor(insertInstructor: InsertInstructor): Promise<Instructor> {
    const [instructor] = await db
      .insert(instructors)
      .values(insertInstructor)
      .returning();
    return instructor;
  }

  async updateInstructor(id: number, updateData: Partial<InsertInstructor>): Promise<Instructor> {
    const [instructor] = await db
      .update(instructors)
      .set(updateData)
      .where(eq(instructors.id, id))
      .returning();
    return instructor;
  }

  async deleteInstructor(id: number): Promise<void> {
    await db.delete(instructors).where(eq(instructors.id, id));
  }

  // Instructor-specific methods
  async getInstructorStudents(instructorId: number): Promise<Student[]> {
    return await db.select().from(students).where(eq(students.instructorId, instructorId));
  }

  async getInstructorClasses(instructorId: number): Promise<Class[]> {
    return await db.select().from(classes).where(eq(classes.instructorId, instructorId));
  }

  async getInstructorEvaluations(instructorId: number): Promise<Evaluation[]> {
    return await db.select().from(evaluations).where(eq(evaluations.instructorId, instructorId));
  }

  async getInstructorClassesNeedingEvaluation(instructorId: number): Promise<any[]> {
    // Get all completed/in-progress classes for this instructor
    const instructorClasses = await db
      .select()
      .from(classes)
      .where(
        and(
          eq(classes.instructorId, instructorId),
          sql`${classes.status} IN ('completed', 'in-progress')`
        )
      );

    // If no classes, return empty array
    if (instructorClasses.length === 0) {
      return [];
    }

    // Get all evaluations for these classes
    const classIds = instructorClasses.map(c => c.id);
    const existingEvaluations = classIds.length > 0 
      ? await db
          .select()
          .from(evaluations)
          .where(sql`${evaluations.classId} IN (${sql.join(classIds.map(id => sql`${id}`), sql`, `)})`)
      : [];

    // Track evaluated student+class pairs instead of just class IDs
    const evaluatedPairs = new Set(
      existingEvaluations
        .filter(e => e.classId !== null && e.studentId !== null)
        .map(e => `${e.classId}-${e.studentId}`)
    );

    // Get enrollments for all classes and filter out already-evaluated student+class pairs
    const result = [];
    for (const classItem of instructorClasses) {
      const enrollments = await db
        .select({
          enrollment: classEnrollments,
          student: students
        })
        .from(classEnrollments)
        .leftJoin(students, eq(classEnrollments.studentId, students.id))
        .where(
          and(
            eq(classEnrollments.classId, classItem.id),
            sql`${classEnrollments.attendanceStatus} IN ('attended', 'registered')`,
            isNull(classEnrollments.cancelledAt)
          )
        );

      for (const { enrollment, student } of enrollments) {
        if (student && !evaluatedPairs.has(`${classItem.id}-${student.id}`)) {
          result.push({
            class: classItem,
            enrollment,
            student
          });
        }
      }
    }

    return result;
  }

  // Instructor Hours Analytics
  async getInstructorHours(params: {
    instructorId?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<{
    instructorId: number;
    instructorName: string;
    theoryHours: number;
    practicalHours: number;
    totalHours: number;
  }[]> {
    const { instructorId, startDate, endDate } = params;
    
    // Build WHERE conditions
    const whereConditions = [eq(lessonRecords.status, 'completed')];
    
    if (instructorId) {
      whereConditions.push(eq(lessonRecords.instructorId, instructorId));
    }
    
    if (startDate) {
      whereConditions.push(sql`${lessonRecords.lessonDate} >= ${startDate}`);
    }
    
    if (endDate) {
      whereConditions.push(sql`${lessonRecords.lessonDate} <= ${endDate}`);
    }

    // Get lesson records with instructor info
    const records = await db
      .select({
        instructorId: lessonRecords.instructorId,
        firstName: instructors.firstName,
        lastName: instructors.lastName,
        lessonType: lessonRecords.lessonType,
        duration: lessonRecords.duration,
      })
      .from(lessonRecords)
      .innerJoin(instructors, eq(lessonRecords.instructorId, instructors.id))
      .where(and(...whereConditions));

    // Group by instructor and aggregate hours
    const hoursMap: { [key: number]: {
      instructorName: string;
      theoryHours: number;
      practicalHours: number;
    } } = {};

    for (const record of records) {
      if (!record.instructorId) continue;
      
      if (!hoursMap[record.instructorId]) {
        hoursMap[record.instructorId] = {
          instructorName: `${record.firstName} ${record.lastName}`,
          theoryHours: 0,
          practicalHours: 0,
        };
      }

      const hours = Math.round(record.duration / 60 * 100) / 100; // Convert minutes to hours, round to 2 decimals
      
      if (record.lessonType === 'theory') {
        hoursMap[record.instructorId].theoryHours += hours;
      } else if (record.lessonType === 'practical') {
        hoursMap[record.instructorId].practicalHours += hours;
      }
    }

    // Convert to result format
    return Object.entries(hoursMap).map(([instructorId, data]) => ({
      instructorId: parseInt(instructorId),
      instructorName: data.instructorName,
      theoryHours: Math.round(data.theoryHours * 100) / 100,
      practicalHours: Math.round(data.practicalHours * 100) / 100,
      totalHours: Math.round((data.theoryHours + data.practicalHours) * 100) / 100,
    }))
    .sort((a, b) => b.totalHours - a.totalHours); // Sort by total hours descending
  }

  // Classes
  async getClasses(): Promise<Class[]> {
    return await db.select().from(classes);
  }

  async getClass(id: number): Promise<Class | undefined> {
    const [classData] = await db.select().from(classes).where(eq(classes.id, id));
    return classData || undefined;
  }

  async createClass(insertClass: InsertClass): Promise<Class> {
    const [classData] = await db
      .insert(classes)
      .values(insertClass)
      .returning();
    return classData;
  }

  async updateClass(id: number, updateData: Partial<InsertClass>): Promise<Class> {
    const [classData] = await db
      .update(classes)
      .set(updateData)
      .where(eq(classes.id, id))
      .returning();
    return classData;
  }

  async deleteClass(id: number): Promise<void> {
    await db.delete(classes).where(eq(classes.id, id));
  }

  async confirmClassVehicle(classId: number): Promise<void> {
    await db
      .update(classes)
      .set({ 
        vehicleConfirmed: true, 
        confirmedAt: new Date() 
      })
      .where(eq(classes.id, classId));
  }

  async confirmClass(classId: number): Promise<void> {
    await db
      .update(classes)
      .set({ 
        confirmationStatus: 'confirmed',
        confirmedAt: new Date()
      })
      .where(eq(classes.id, classId));
  }

  async requestClassChange(classId: number, reason: string, suggestedTime?: string): Promise<void> {
    await db
      .update(classes)
      .set({ 
        confirmationStatus: 'change_requested',
        changeRequestReason: reason,
        changeRequestTime: suggestedTime || null,
        changeRequestedAt: new Date()
      })
      .where(eq(classes.id, classId));
  }

  // Class Enrollments
  async getClassEnrollments(): Promise<ClassEnrollment[]> {
    return await db.select().from(classEnrollments);
  }

  async getClassEnrollment(id: number): Promise<ClassEnrollment | undefined> {
    const [enrollment] = await db.select().from(classEnrollments).where(eq(classEnrollments.id, id));
    return enrollment;
  }

  async getClassEnrollmentsByClass(classId: number): Promise<ClassEnrollment[]> {
    return await db.select().from(classEnrollments).where(
      and(
        eq(classEnrollments.classId, classId),
        isNull(classEnrollments.cancelledAt)
      )
    );
  }

  async getClassEnrollmentsByStudent(studentId: number): Promise<ClassEnrollment[]> {
    return await db.select().from(classEnrollments).where(
      and(
        eq(classEnrollments.studentId, studentId),
        isNull(classEnrollments.cancelledAt)
      )
    );
  }

  async createClassEnrollment(insertEnrollment: InsertClassEnrollment): Promise<ClassEnrollment> {
    const [enrollment] = await db
      .insert(classEnrollments)
      .values(insertEnrollment)
      .returning();
    return enrollment;
  }

  async updateClassEnrollment(id: number, updateData: Partial<InsertClassEnrollment>): Promise<ClassEnrollment> {
    const [enrollment] = await db
      .update(classEnrollments)
      .set(updateData)
      .where(eq(classEnrollments.id, id))
      .returning();
    return enrollment;
  }

  async deleteClassEnrollment(id: number): Promise<void> {
    await db.delete(classEnrollments).where(eq(classEnrollments.id, id));
  }

  async getAvailableClasses(
    studentId: number, 
    filters?: { courseType?: string; instructorId?: number; startDate?: string; endDate?: string }
  ): Promise<Array<Class & { instructorName: string; enrolledCount: number; spotsRemaining: number }>> {
    const result = await db
      .select({
        id: classes.id,
        courseType: classes.courseType,
        classNumber: classes.classNumber,
        date: classes.date,
        time: classes.time,
        duration: classes.duration,
        instructorId: classes.instructorId,
        vehicleId: classes.vehicleId,
        vehicleConfirmed: classes.vehicleConfirmed,
        confirmedAt: classes.confirmedAt,
        room: classes.room,
        maxStudents: classes.maxStudents,
        status: classes.status,
        confirmationStatus: classes.confirmationStatus,
        changeRequestReason: classes.changeRequestReason,
        changeRequestTime: classes.changeRequestTime,
        changeRequestedAt: classes.changeRequestedAt,
        zoomLink: classes.zoomLink,
        hasTest: classes.hasTest,
        instructorName: sql<string>`CONCAT(${instructors.firstName}, ' ', ${instructors.lastName})`,
        enrolledCount: sql<number>`CAST(COALESCE(COUNT(CASE WHEN ${classEnrollments.cancelledAt} IS NULL THEN 1 END), 0) AS INTEGER)`,
      })
      .from(classes)
      .leftJoin(instructors, eq(classes.instructorId, instructors.id))
      .leftJoin(classEnrollments, eq(classes.id, classEnrollments.classId))
      .where(
        and(
          eq(classes.status, 'scheduled'),
          sql`CAST(${classes.date} AS DATE) >= CURRENT_DATE`,
          sql`CAST(${classes.date} AS DATE) <= CURRENT_DATE + INTERVAL '3 months'`,
          sql`${classes.id} NOT IN (
            SELECT ${classEnrollments.classId} 
            FROM ${classEnrollments} 
            WHERE ${classEnrollments.studentId} = ${studentId}
          )`,
          filters?.courseType ? eq(classes.courseType, filters.courseType) : undefined,
          filters?.instructorId ? eq(classes.instructorId, filters.instructorId) : undefined,
          filters?.startDate ? sql`CAST(${classes.date} AS DATE) >= CAST(${filters.startDate} AS DATE)` : undefined,
          filters?.endDate ? sql`CAST(${classes.date} AS DATE) <= CAST(${filters.endDate} AS DATE)` : undefined
        )
      )
      .groupBy(
        classes.id,
        classes.courseType,
        classes.classNumber,
        classes.date,
        classes.time,
        classes.duration,
        classes.instructorId,
        classes.vehicleId,
        classes.vehicleConfirmed,
        classes.confirmedAt,
        classes.room,
        classes.maxStudents,
        classes.status,
        classes.confirmationStatus,
        classes.changeRequestReason,
        classes.changeRequestTime,
        classes.changeRequestedAt,
        classes.zoomLink,
        classes.hasTest,
        instructors.firstName,
        instructors.lastName
      )
      .orderBy(sql`CAST(${classes.date} AS DATE) ASC, ${classes.time} ASC`);

    return result.map(row => ({
      ...row,
      spotsRemaining: row.maxStudents - row.enrolledCount,
    }));
  }

  async bookClass(
    studentId: number, 
    classId: number
  ): Promise<{ success: boolean; message?: string; enrollment?: ClassEnrollment }> {
    const [classData] = await db
      .select()
      .from(classes)
      .where(eq(classes.id, classId));

    if (!classData) {
      return { success: false, message: 'Class not found' };
    }

    if (classData.status !== 'scheduled') {
      return { success: false, message: 'Class is not available for booking' };
    }

    const existingEnrollment = await db
      .select()
      .from(classEnrollments)
      .where(
        and(
          eq(classEnrollments.classId, classId),
          eq(classEnrollments.studentId, studentId),
          isNull(classEnrollments.cancelledAt)
        )
      );

    if (existingEnrollment.length > 0) {
      return { success: false, message: 'You are already enrolled in this class' };
    }

    const enrolledStudents = await db
      .select()
      .from(classEnrollments)
      .where(
        and(
          eq(classEnrollments.classId, classId),
          isNull(classEnrollments.cancelledAt)
        )
      );

    if (enrolledStudents.length >= classData.maxStudents) {
      return { success: false, message: 'Class is full' };
    }

    const studentEnrollments = await db
      .select({
        classId: classEnrollments.classId,
        date: classes.date,
        time: classes.time,
        duration: classes.duration,
      })
      .from(classEnrollments)
      .innerJoin(classes, eq(classEnrollments.classId, classes.id))
      .where(
        and(
          eq(classEnrollments.studentId, studentId),
          isNull(classEnrollments.cancelledAt)
        )
      );

    for (const enrollment of studentEnrollments) {
      if (enrollment.date === classData.date && enrollment.time === classData.time) {
        return { 
          success: false, 
          message: 'You have a time conflict with another class on the same date and time' 
        };
      }
    }

    const [newEnrollment] = await db
      .insert(classEnrollments)
      .values({
        classId,
        studentId,
        attendanceStatus: 'registered',
        testScore: null,
      })
      .returning();

    return { 
      success: true, 
      message: 'Successfully enrolled in class',
      enrollment: newEnrollment 
    };
  }

  // Contract Templates
  async getContractTemplates(): Promise<ContractTemplate[]> {
    return db.select().from(contractTemplates).where(eq(contractTemplates.isActive, true));
  }

  async getContractTemplate(id: number): Promise<ContractTemplate | undefined> {
    const [template] = await db.select().from(contractTemplates).where(eq(contractTemplates.id, id));
    return template;
  }

  async getContractTemplateByType(courseType: string): Promise<ContractTemplate | undefined> {
    const [template] = await db.select().from(contractTemplates)
      .where(and(eq(contractTemplates.courseType, courseType), eq(contractTemplates.isActive, true)));
    return template;
  }

  async createContractTemplate(template: InsertContractTemplate): Promise<ContractTemplate> {
    const [newTemplate] = await db.insert(contractTemplates).values(template).returning();
    return newTemplate;
  }

  async updateContractTemplate(id: number, template: Partial<InsertContractTemplate>): Promise<ContractTemplate> {
    const [updated] = await db.update(contractTemplates).set(template).where(eq(contractTemplates.id, id)).returning();
    return updated;
  }

  // Contracts
  async getContracts(): Promise<Contract[]> {
    return await db.select().from(contracts);
  }

  async getContract(id: number): Promise<Contract | undefined> {
    const [contract] = await db.select().from(contracts).where(eq(contracts.id, id));
    return contract || undefined;
  }

  async getContractsByStudent(studentId: number): Promise<Contract[]> {
    return await db.select().from(contracts).where(eq(contracts.studentId, studentId));
  }

  async createContract(insertContract: InsertContract): Promise<Contract> {
    const [contract] = await db
      .insert(contracts)
      .values(insertContract)
      .returning();
    return contract;
  }

  async updateContract(id: number, updateData: Partial<InsertContract>): Promise<Contract> {
    const [contract] = await db
      .update(contracts)
      .set(updateData)
      .where(eq(contracts.id, id))
      .returning();
    return contract;
  }

  // Evaluations
  async getEvaluations(): Promise<Evaluation[]> {
    return await db.select().from(evaluations);
  }

  async getEvaluation(id: number): Promise<Evaluation | undefined> {
    const [evaluation] = await db.select().from(evaluations).where(eq(evaluations.id, id));
    return evaluation || undefined;
  }

  async getEvaluationsByStudent(studentId: number): Promise<Evaluation[]> {
    return await db.select().from(evaluations).where(eq(evaluations.studentId, studentId));
  }

  async createEvaluation(insertEvaluation: InsertEvaluation): Promise<Evaluation> {
    const [evaluation] = await db
      .insert(evaluations)
      .values(insertEvaluation)
      .returning();
    return evaluation;
  }

  async updateEvaluation(id: number, updateData: Partial<InsertEvaluation>): Promise<Evaluation> {
    const [evaluation] = await db
      .update(evaluations)
      .set(updateData)
      .where(eq(evaluations.id, id))
      .returning();
    return evaluation;
  }

  // Notes
  async getNotes(): Promise<Note[]> {
    return await db.select().from(notes);
  }

  async getNote(id: number): Promise<Note | undefined> {
    const [note] = await db.select().from(notes).where(eq(notes.id, id));
    return note || undefined;
  }

  async getNotesByStudent(studentId: number): Promise<Note[]> {
    return await db.select().from(notes).where(eq(notes.studentId, studentId));
  }

  async createNote(insertNote: InsertNote): Promise<Note> {
    const [note] = await db
      .insert(notes)
      .values(insertNote)
      .returning();
    return note;
  }

  async updateNote(id: number, updateData: Partial<InsertNote>): Promise<Note> {
    const [note] = await db
      .update(notes)
      .set(updateData)
      .where(eq(notes.id, id))
      .returning();
    return note;
  }

  async deleteNote(id: number): Promise<void> {
    await db.delete(notes).where(eq(notes.id, id));
  }

  // Communications
  async getCommunications(): Promise<Communication[]> {
    return await db.select().from(communications);
  }

  async getCommunication(id: number): Promise<Communication | undefined> {
    const [communication] = await db.select().from(communications).where(eq(communications.id, id));
    return communication || undefined;
  }

  async createCommunication(insertCommunication: InsertCommunication): Promise<Communication> {
    const [communication] = await db
      .insert(communications)
      .values(insertCommunication)
      .returning();
    return communication;
  }

  async updateCommunication(id: number, updateData: Partial<InsertCommunication>): Promise<Communication> {
    const [communication] = await db
      .update(communications)
      .set(updateData)
      .where(eq(communications.id, id))
      .returning();
    return communication;
  }

  async getInstructorAvailability(instructorId: number): Promise<InstructorAvailability[]> {
    return await db
      .select()
      .from(instructorAvailability)
      .where(eq(instructorAvailability.instructorId, instructorId));
  }

  async createInstructorAvailability(insertAvailability: InsertInstructorAvailability): Promise<InstructorAvailability> {
    const [availability] = await db
      .insert(instructorAvailability)
      .values(insertAvailability)
      .returning();
    return availability;
  }

  async updateInstructorAvailability(id: number, updateData: Partial<InsertInstructorAvailability>): Promise<InstructorAvailability> {
    const [availability] = await db
      .update(instructorAvailability)
      .set(updateData)
      .where(eq(instructorAvailability.id, id))
      .returning();
    return availability;
  }

  async deleteInstructorAvailability(id: number): Promise<void> {
    await db
      .delete(instructorAvailability)
      .where(eq(instructorAvailability.id, id));
  }

  // Instructor Reminder Settings
  async getInstructorReminderSettings(instructorId: number): Promise<InstructorReminderSettings | undefined> {
    const [settings] = await db
      .select()
      .from(instructorReminderSettings)
      .where(eq(instructorReminderSettings.instructorId, instructorId));
    return settings || undefined;
  }

  async getAllInstructorReminderSettings(): Promise<InstructorReminderSettings[]> {
    return await db
      .select()
      .from(instructorReminderSettings);
  }

  async upsertInstructorReminderSettings(instructorId: number, settings: Partial<InsertInstructorReminderSettings>): Promise<InstructorReminderSettings> {
    const existing = await this.getInstructorReminderSettings(instructorId);
    
    if (existing) {
      const [updated] = await db
        .update(instructorReminderSettings)
        .set({ ...settings, updatedAt: new Date() })
        .where(eq(instructorReminderSettings.instructorId, instructorId))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(instructorReminderSettings)
        .values({ instructorId, ...settings } as any)
        .returning();
      return created;
    }
  }

  async updateInstructorReminderLastSent(instructorId: number): Promise<void> {
    await db
      .update(instructorReminderSettings)
      .set({ lastReminderSentAt: new Date() })
      .where(eq(instructorReminderSettings.instructorId, instructorId));
  }

  // Zoom Meetings
  async getZoomMeeting(id: number): Promise<ZoomMeeting | undefined> {
    const [meeting] = await db
      .select()
      .from(zoomMeetings)
      .where(eq(zoomMeetings.id, id));
    return meeting || undefined;
  }

  async getZoomMeetingByZoomId(zoomMeetingId: string): Promise<ZoomMeeting | undefined> {
    const [meeting] = await db
      .select()
      .from(zoomMeetings)
      .where(eq(zoomMeetings.zoomMeetingId, zoomMeetingId));
    return meeting || undefined;
  }

  async getZoomMeetingsByClass(classId: number): Promise<ZoomMeeting[]> {
    return await db
      .select()
      .from(zoomMeetings)
      .where(eq(zoomMeetings.classId, classId));
  }

  async createZoomMeeting(insertMeeting: InsertZoomMeeting): Promise<ZoomMeeting> {
    const [meeting] = await db
      .insert(zoomMeetings)
      .values(insertMeeting)
      .returning();
    return meeting;
  }

  async updateZoomMeeting(id: number, updateData: Partial<InsertZoomMeeting>): Promise<ZoomMeeting> {
    const [meeting] = await db
      .update(zoomMeetings)
      .set(updateData)
      .where(eq(zoomMeetings.id, id))
      .returning();
    return meeting;
  }

  async deleteZoomMeeting(id: number): Promise<void> {
    await db
      .delete(zoomMeetings)
      .where(eq(zoomMeetings.id, id));
  }

  // Zoom Attendance
  async getZoomAttendance(id: number): Promise<ZoomAttendance | undefined> {
    const [attendance] = await db
      .select()
      .from(zoomAttendance)
      .where(eq(zoomAttendance.id, id));
    return attendance || undefined;
  }

  async getZoomAttendanceByMeeting(zoomMeetingId: number): Promise<ZoomAttendance[]> {
    return await db
      .select()
      .from(zoomAttendance)
      .where(eq(zoomAttendance.zoomMeetingId, zoomMeetingId));
  }

  async getZoomAttendanceByStudent(studentId: number): Promise<ZoomAttendance[]> {
    return await db
      .select()
      .from(zoomAttendance)
      .where(eq(zoomAttendance.studentId, studentId));
  }

  async createZoomAttendance(insertAttendance: InsertZoomAttendance): Promise<ZoomAttendance> {
    const [attendance] = await db
      .insert(zoomAttendance)
      .values(insertAttendance)
      .returning();
    return attendance;
  }

  async updateZoomAttendance(id: number, updateData: Partial<InsertZoomAttendance>): Promise<ZoomAttendance> {
    const [attendance] = await db
      .update(zoomAttendance)
      .set(updateData)
      .where(eq(zoomAttendance.id, id))
      .returning();
    return attendance;
  }

  async deleteZoomAttendance(id: number): Promise<void> {
    await db
      .delete(zoomAttendance)
      .where(eq(zoomAttendance.id, id));
  }

  // Zoom Settings
  async getZoomSettings(): Promise<ZoomSettings> {
    const [settings] = await db.select().from(zoomSettings).limit(1);
    
    if (!settings) {
      // Create default settings if none exist
      const defaultSettings: InsertZoomSettings = {
        minimumAttendanceMinutes: 30,
        minimumAttendancePercentage: 75,
        autoMarkAttendance: true,
        webhookUrl: null,
        apiKey: null,
        apiSecret: null,
      };
      
      const [newSettings] = await db
        .insert(zoomSettings)
        .values(defaultSettings)
        .returning();
      return newSettings;
    }
    
    return settings;
  }

  async updateZoomSettings(updateData: Partial<InsertZoomSettings>): Promise<ZoomSettings> {
    // First try to update existing settings
    const [existing] = await db.select().from(zoomSettings).limit(1);
    
    if (existing) {
      const [updated] = await db
        .update(zoomSettings)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(zoomSettings.id, existing.id))
        .returning();
      return updated;
    } else {
      // Create new settings if none exist
      const [newSettings] = await db
        .insert(zoomSettings)
        .values(updateData)
        .returning();
      return newSettings;
    }
  }

  // School Permits
  async getSchoolPermits(): Promise<SchoolPermit[]> {
    return await db.select().from(schoolPermits);
  }

  async getSchoolPermit(id: number): Promise<SchoolPermit | undefined> {
    const [permit] = await db.select().from(schoolPermits).where(eq(schoolPermits.id, id));
    return permit || undefined;
  }

  async createSchoolPermit(insertPermit: InsertSchoolPermit): Promise<SchoolPermit> {
    const totalNumbers = insertPermit.endNumber - insertPermit.startNumber + 1;
    
    const [permit] = await db
      .insert(schoolPermits)
      .values({
        ...insertPermit,
        totalNumbers,
        availableNumbers: totalNumbers,
      })
      .returning();

    // Create individual permit numbers
    const numbers = [];
    for (let i = insertPermit.startNumber; i <= insertPermit.endNumber; i++) {
      numbers.push({
        permitId: permit.id,
        number: i,
        isAssigned: false,
        assignedToStudentId: null,
        assignedDate: null,
      });
    }

    // Batch insert all numbers
    await db.insert(permitNumbers).values(numbers);

    return permit;
  }

  async updateSchoolPermit(id: number, updateData: Partial<InsertSchoolPermit>): Promise<SchoolPermit> {
    const [permit] = await db
      .update(schoolPermits)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(schoolPermits.id, id))
      .returning();
    return permit;
  }

  async deleteSchoolPermit(id: number): Promise<void> {
    // Delete all associated permit numbers first
    await db.delete(permitNumbers).where(eq(permitNumbers.permitId, id));
    // Then delete the permit
    await db.delete(schoolPermits).where(eq(schoolPermits.id, id));
  }

  // Permit Numbers
  async getPermitNumbers(permitId: number): Promise<PermitNumber[]> {
    return await db.select().from(permitNumbers).where(eq(permitNumbers.permitId, permitId));
  }

  async getAvailablePermitNumber(permitId: number, courseType: string): Promise<PermitNumber | undefined> {
    // Get the permit to check course types
    const [permit] = await db.select().from(schoolPermits).where(eq(schoolPermits.id, permitId));
    if (!permit) return undefined;

    const courseTypes = JSON.parse(permit.courseTypes);
    if (!courseTypes.includes(courseType)) return undefined;

    // Get the first available number
    const [number] = await db
      .select()
      .from(permitNumbers)
      .where(and(
        eq(permitNumbers.permitId, permitId),
        eq(permitNumbers.isAssigned, false)
      ))
      .limit(1);

    return number || undefined;
  }

  async assignPermitNumber(permitNumberId: number, studentId: number): Promise<PermitNumber> {
    const [assignedNumber] = await db
      .update(permitNumbers)
      .set({
        isAssigned: true,
        assignedToStudentId: studentId,
        assignedDate: new Date(),
      })
      .where(eq(permitNumbers.id, permitNumberId))
      .returning();

    // Update the available count
    const permitId = assignedNumber.permitId;
    const [currentPermit] = await db.select().from(schoolPermits).where(eq(schoolPermits.id, permitId));
    await db
      .update(schoolPermits)
      .set({
        availableNumbers: currentPermit.availableNumbers - 1,
        updatedAt: new Date()
      })
      .where(eq(schoolPermits.id, permitId));

    return assignedNumber;
  }

  async getAssignedPermitNumbers(studentId: number): Promise<PermitNumber[]> {
    return await db
      .select()
      .from(permitNumbers)
      .where(eq(permitNumbers.assignedToStudentId, studentId));
  }

  // Student Transactions
  async getStudentTransactions(studentId?: number): Promise<StudentTransaction[]> {
    if (studentId) {
      return await db
        .select()
        .from(studentTransactions)
        .where(eq(studentTransactions.studentId, studentId));
    }
    return await db.select().from(studentTransactions);
  }

  async createStudentTransaction(insertTransaction: InsertStudentTransaction): Promise<StudentTransaction> {
    const [transaction] = await db
      .insert(studentTransactions)
      .values(insertTransaction)
      .returning();
    return transaction;
  }

  // Payment Transactions (legacy migrated data)
  async getPaymentTransactions(studentId?: number): Promise<PaymentTransaction[]> {
    if (studentId) {
      return await db
        .select()
        .from(paymentTransactions)
        .where(eq(paymentTransactions.studentId, studentId));
    }
    return await db.select().from(paymentTransactions);
  }

  // Transfer Credits
  async getTransferCredits(): Promise<TransferCredit[]> {
    return await db.select().from(transferCredits);
  }

  async getTransferCredit(id: number): Promise<TransferCredit | undefined> {
    const [transferCredit] = await db.select().from(transferCredits).where(eq(transferCredits.id, id));
    return transferCredit || undefined;
  }

  async getTransferCreditsByStudent(studentId: number): Promise<TransferCredit[]> {
    return await db.select().from(transferCredits).where(eq(transferCredits.studentId, studentId));
  }

  async createTransferCredit(insertTransferCredit: InsertTransferCredit): Promise<TransferCredit> {
    const [transferCredit] = await db
      .insert(transferCredits)
      .values(insertTransferCredit)
      .returning();
    return transferCredit;
  }

  async updateTransferCredit(id: number, updateData: Partial<InsertTransferCredit>): Promise<TransferCredit> {
    const [transferCredit] = await db
      .update(transferCredits)
      .set(updateData)
      .where(eq(transferCredits.id, id))
      .returning();
    return transferCredit;
  }

  async deleteTransferCredit(id: number): Promise<void> {
    await db.delete(transferCredits).where(eq(transferCredits.id, id));
  }

  // Locations
  async getLocations(): Promise<Location[]> {
    return await db.select().from(locations);
  }

  async getLocation(id: number): Promise<Location | undefined> {
    const [location] = await db.select().from(locations).where(eq(locations.id, id));
    return location || undefined;
  }

  async getActiveLocations(): Promise<Location[]> {
    return await db.select().from(locations).where(eq(locations.isActive, true));
  }

  async createLocation(insertLocation: InsertLocation): Promise<Location> {
    const [location] = await db
      .insert(locations)
      .values(insertLocation)
      .returning();
    return location;
  }

  async updateLocation(id: number, updateData: Partial<InsertLocation>): Promise<Location> {
    const [location] = await db
      .update(locations)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(locations.id, id))
      .returning();
    return location;
  }

  async deleteLocation(id: number): Promise<void> {
    await db.delete(locations).where(eq(locations.id, id));
  }

  // Vehicles
  async getVehicles(): Promise<Vehicle[]> {
    return await db.select().from(vehicles);
  }

  async getVehicle(id: number): Promise<Vehicle | undefined> {
    const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, id));
    return vehicle || undefined;
  }

  async getActiveVehicles(): Promise<Vehicle[]> {
    return await db.select().from(vehicles).where(eq(vehicles.status, 'active'));
  }

  async createVehicle(insertVehicle: InsertVehicle): Promise<Vehicle> {
    const [vehicle] = await db
      .insert(vehicles)
      .values(insertVehicle)
      .returning();
    return vehicle;
  }

  async updateVehicle(id: number, updateData: Partial<InsertVehicle>): Promise<Vehicle> {
    const [vehicle] = await db
      .update(vehicles)
      .set(updateData)
      .where(eq(vehicles.id, id))
      .returning();
    return vehicle;
  }

  async deleteVehicle(id: number): Promise<void> {
    await db.delete(vehicles).where(eq(vehicles.id, id));
  }

  // Settings methods for DatabaseStorage
  async getSettings(): Promise<{ [key: string]: string }> {
    const settings = await db.select().from(appSettings);
    const result: { [key: string]: string } = {};
    settings.forEach(setting => {
      result[setting.key] = setting.value;
    });
    return result;
  }

  async getSetting(key: string): Promise<string | undefined> {
    const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return setting?.value;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await db.insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: new Date() }
      });
  }

  async getNextContractNumber(): Promise<number> {
    const current = await this.getSetting('nextContractNumber');
    return parseInt(current || '1');
  }

  async incrementContractNumber(): Promise<number> {
    const current = await this.getNextContractNumber();
    const next = current + 1;
    await this.setSetting('nextContractNumber', next.toString());
    return current;
  }
  
  // Billing System Implementations
  async getLessonPackages(): Promise<LessonPackage[]> {
    return await db.select().from(lessonPackages);
  }

  async getActiveLessonPackages(courseType?: string): Promise<LessonPackage[]> {
    if (courseType) {
      return await db.select().from(lessonPackages)
        .where(and(eq(lessonPackages.isActive, true), eq(lessonPackages.courseType, courseType)));
    }
    return await db.select().from(lessonPackages)
      .where(eq(lessonPackages.isActive, true));
  }

  async createLessonPackage(pkg: InsertLessonPackage): Promise<LessonPackage> {
    const [created] = await db.insert(lessonPackages).values(pkg).returning();
    return created;
  }

  async updateLessonPackage(id: number, pkg: Partial<InsertLessonPackage>): Promise<LessonPackage> {
    const [updated] = await db.update(lessonPackages)
      .set({ ...pkg, updatedAt: new Date() })
      .where(eq(lessonPackages.id, id))
      .returning();
    return updated;
  }

  async getStudentPaymentMethods(studentId: number): Promise<StudentPaymentMethod[]> {
    return await db.select().from(studentPaymentMethods)
      .where(eq(studentPaymentMethods.studentId, studentId));
  }

  async createStudentPaymentMethod(method: InsertStudentPaymentMethod): Promise<StudentPaymentMethod> {
    const [created] = await db.insert(studentPaymentMethods).values(method).returning();
    return created;
  }

  async setDefaultPaymentMethod(studentId: number, methodId: number): Promise<void> {
    // First, unset all default flags for this student
    await db.update(studentPaymentMethods)
      .set({ isDefault: false })
      .where(eq(studentPaymentMethods.studentId, studentId));
    
    // Then set the selected method as default
    await db.update(studentPaymentMethods)
      .set({ isDefault: true })
      .where(eq(studentPaymentMethods.id, methodId));
  }

  async deleteStudentPaymentMethod(id: number): Promise<void> {
    await db.delete(studentPaymentMethods).where(eq(studentPaymentMethods.id, id));
  }

  async getStudentInvoices(studentId: number): Promise<Invoice[]> {
    return await db.select().from(invoices)
      .where(eq(invoices.studentId, studentId))
      .orderBy(sql`${invoices.createdAt} DESC`);
  }

  async getUnpaidInvoices(studentId: number): Promise<Invoice[]> {
    return await db.select().from(invoices)
      .where(and(
        eq(invoices.studentId, studentId),
        eq(invoices.status, 'unpaid')
      ));
  }

  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const [created] = await db.insert(invoices).values(invoice).returning();
    return created;
  }

  async updateInvoiceStatus(id: number, status: string): Promise<Invoice> {
    const [updated] = await db.update(invoices)
      .set({ status, updatedAt: new Date() })
      .where(eq(invoices.id, id))
      .returning();
    return updated;
  }

  async getStudentCredits(studentId: number): Promise<StudentCredit[]> {
    return await db.select().from(studentCredits)
      .where(eq(studentCredits.studentId, studentId))
      .orderBy(sql`${studentCredits.createdAt} DESC`);
  }

  async getAvailableCredits(studentId: number): Promise<number> {
    const credits = await db.select().from(studentCredits)
      .where(and(
        eq(studentCredits.studentId, studentId),
        eq(studentCredits.isUsed, false)
      ));
    
    return credits.reduce((sum, credit) => sum + parseFloat(credit.amount?.toString() || '0'), 0);
  }

  async createStudentCredit(credit: InsertStudentCredit): Promise<StudentCredit> {
    const [created] = await db.insert(studentCredits).values(credit).returning();
    return created;
  }

  async useStudentCredit(creditId: number): Promise<void> {
    await db.update(studentCredits)
      .set({ isUsed: true, usedDate: new Date() })
      .where(eq(studentCredits.id, creditId));
  }

  async getBillingReceipt(transactionId: number): Promise<BillingReceipt | undefined> {
    const [receipt] = await db.select().from(billingReceipts)
      .where(eq(billingReceipts.transactionId, transactionId));
    return receipt || undefined;
  }

  async createBillingReceipt(receipt: InsertBillingReceipt): Promise<BillingReceipt> {
    const [created] = await db.insert(billingReceipts).values(receipt).returning();
    return created;
  }

  // Lesson Notes (internal instructor notes after lessons)
  async getLessonNotesByInstructor(instructorId: number): Promise<any[]> {
    const notes = await db.select({
      id: lessonRecords.id,
      studentId: lessonRecords.studentId,
      instructorId: lessonRecords.instructorId,
      lessonDate: lessonRecords.lessonDate,
      lessonType: lessonRecords.lessonType,
      duration: lessonRecords.duration,
      status: lessonRecords.status,
      notes: lessonRecords.notes,
      instructorFeedback: lessonRecords.instructorFeedback,
      skillsPracticed: lessonRecords.skillsPracticed,
      createdAt: lessonRecords.createdAt,
      studentFirstName: students.firstName,
      studentLastName: students.lastName,
    })
    .from(lessonRecords)
    .leftJoin(students, eq(lessonRecords.studentId, students.id))
    .where(eq(lessonRecords.instructorId, instructorId))
    .orderBy(sql`${lessonRecords.lessonDate} DESC`);
    
    return notes;
  }

  async getLessonNotesByStudent(studentId: number): Promise<any[]> {
    const notes = await db.select({
      id: lessonRecords.id,
      studentId: lessonRecords.studentId,
      instructorId: lessonRecords.instructorId,
      lessonDate: lessonRecords.lessonDate,
      lessonType: lessonRecords.lessonType,
      duration: lessonRecords.duration,
      status: lessonRecords.status,
      notes: lessonRecords.notes,
      instructorFeedback: lessonRecords.instructorFeedback,
      skillsPracticed: lessonRecords.skillsPracticed,
      createdAt: lessonRecords.createdAt,
      instructorFirstName: instructors.firstName,
      instructorLastName: instructors.lastName,
    })
    .from(lessonRecords)
    .leftJoin(instructors, eq(lessonRecords.instructorId, instructors.id))
    .where(eq(lessonRecords.studentId, studentId))
    .orderBy(sql`${lessonRecords.lessonDate} DESC`);
    
    return notes;
  }

  async getLessonNote(id: number): Promise<any | undefined> {
    const [note] = await db.select().from(lessonRecords)
      .where(eq(lessonRecords.id, id));
    return note || undefined;
  }

  async createLessonNote(note: {
    studentId: number;
    instructorId: number;
    classId?: number;
    lessonDate: string;
    lessonType: string;
    duration: number;
    notes: string;
    instructorFeedback?: string;
    status: string;
  }): Promise<any> {
    const [created] = await db.insert(lessonRecords).values({
      studentId: note.studentId,
      instructorId: note.instructorId,
      lessonDate: note.lessonDate,
      lessonType: note.lessonType,
      duration: note.duration,
      status: note.status,
      notes: note.notes,
      instructorFeedback: note.instructorFeedback || null,
    }).returning();
    return created;
  }

  async updateLessonNote(id: number, note: {
    notes?: string;
    instructorFeedback?: string;
  }): Promise<any> {
    const [updated] = await db.update(lessonRecords)
      .set(note)
      .where(eq(lessonRecords.id, id))
      .returning();
    return updated;
  }

  // Payment Reconciliation Methods
  async getPaymentIntakes(filters?: { status?: string; startDate?: string; endDate?: string; search?: string }): Promise<PaymentIntake[]> {
    let query = db.select().from(paymentIntakes);
    const conditions = [];
    
    if (filters?.status && filters.status !== 'all') {
      conditions.push(eq(paymentIntakes.status, filters.status));
    }
    if (filters?.startDate) {
      conditions.push(gte(paymentIntakes.receivedDate, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(paymentIntakes.receivedDate, filters.endDate));
    }
    if (filters?.search) {
      conditions.push(sql`(${paymentIntakes.payerName} ILIKE ${'%' + filters.search + '%'} OR ${paymentIntakes.referenceNumber} ILIKE ${'%' + filters.search + '%'})`);
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    
    return query.orderBy(sql`${paymentIntakes.receivedDate} DESC`);
  }

  async getPaymentIntake(id: number): Promise<PaymentIntake | undefined> {
    const [intake] = await db.select().from(paymentIntakes).where(eq(paymentIntakes.id, id));
    return intake || undefined;
  }

  async createPaymentIntake(intake: InsertPaymentIntake): Promise<PaymentIntake> {
    const [created] = await db.insert(paymentIntakes).values(intake).returning();
    return created;
  }

  async updatePaymentIntake(id: number, intake: Partial<InsertPaymentIntake>): Promise<PaymentIntake> {
    const [updated] = await db.update(paymentIntakes)
      .set({ ...intake, updatedAt: new Date() })
      .where(eq(paymentIntakes.id, id))
      .returning();
    return updated;
  }

  async getPaymentAllocations(paymentIntakeId: number): Promise<PaymentAllocation[]> {
    return db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentIntakeId, paymentIntakeId));
  }

  async createPaymentAllocation(allocation: InsertPaymentAllocation): Promise<PaymentAllocation> {
    const [created] = await db.insert(paymentAllocations).values(allocation).returning();
    return created;
  }

  async getPaymentAuditLogs(paymentIntakeId: number): Promise<PaymentAuditLog[]> {
    return db.select().from(paymentAuditLogs)
      .where(eq(paymentAuditLogs.paymentIntakeId, paymentIntakeId))
      .orderBy(sql`${paymentAuditLogs.createdAt} DESC`);
  }

  async createPaymentAuditLog(log: InsertPaymentAuditLog): Promise<PaymentAuditLog> {
    const [created] = await db.insert(paymentAuditLogs).values(log).returning();
    return created;
  }

  async createPayrollAccessLog(log: InsertPayrollAccessLog): Promise<PayrollAccessLog> {
    const [created] = await db.insert(payrollAccessLogs).values(log).returning();
    return created;
  }

  async getPayrollAccessLogs(): Promise<PayrollAccessLog[]> {
    return db.select().from(payrollAccessLogs)
      .orderBy(sql`${payrollAccessLogs.createdAt} DESC`);
  }

  async getPayerProfiles(filters?: { search?: string; studentId?: number }): Promise<PayerProfile[]> {
    let query = db.select().from(payerProfiles).where(eq(payerProfiles.isActive, true));
    
    if (filters?.studentId) {
      query = db.select().from(payerProfiles).where(
        and(eq(payerProfiles.isActive, true), eq(payerProfiles.studentId, filters.studentId))
      ) as any;
    }
    if (filters?.search) {
      query = db.select().from(payerProfiles).where(
        and(
          eq(payerProfiles.isActive, true),
          sql`${payerProfiles.name} ILIKE ${'%' + filters.search + '%'}`
        )
      ) as any;
    }
    
    return query;
  }

  async getPayerProfile(id: number): Promise<PayerProfile | undefined> {
    const [payer] = await db.select().from(payerProfiles).where(eq(payerProfiles.id, id));
    return payer || undefined;
  }

  async createPayerProfile(payer: InsertPayerProfile): Promise<PayerProfile> {
    const [created] = await db.insert(payerProfiles).values(payer).returning();
    return created;
  }

  async updatePayerProfile(id: number, payer: Partial<InsertPayerProfile>): Promise<PayerProfile> {
    const [updated] = await db.update(payerProfiles)
      .set({ ...payer, updatedAt: new Date() })
      .where(eq(payerProfiles.id, id))
      .returning();
    return updated;
  }

  async searchStudents(params: {
    searchTerm?: string;
    courseType?: string;
    status?: string;
    locationId?: number;
    phoneNumber?: string;
    attestationNumber?: string;
    contractNumber?: string;
    dateOfBirth?: string;
    enrollmentDate?: string;
    isTransfer?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ students: Student[]; total: number }> {
    const conditions: any[] = [];

    if (params.searchTerm) {
      const searchTerm = '%' + params.searchTerm.toLowerCase() + '%';
      conditions.push(sql`(
        LOWER(${students.firstName}) LIKE ${searchTerm} OR
        LOWER(${students.lastName}) LIKE ${searchTerm} OR
        LOWER(${students.email}) LIKE ${searchTerm} OR
        ${students.phone} LIKE ${searchTerm} OR
        LOWER(${students.attestationNumber}) LIKE ${searchTerm} OR
        ${students.legacyId} LIKE ${searchTerm}
      )`);
    }

    if (params.courseType) {
      conditions.push(eq(students.courseType, params.courseType));
    }

    if (params.status) {
      conditions.push(eq(students.status, params.status));
    }

    if (params.locationId) {
      conditions.push(eq(students.locationId, params.locationId));
    }

    if (params.phoneNumber) {
      const phoneTerm = '%' + params.phoneNumber + '%';
      conditions.push(sql`${students.phone} LIKE ${phoneTerm}`);
    }

    if (params.attestationNumber) {
      const attestTerm = '%' + params.attestationNumber + '%';
      conditions.push(sql`${students.attestationNumber} LIKE ${attestTerm}`);
    }

    if (params.contractNumber) {
      const contractTerm = '%' + params.contractNumber + '%';
      conditions.push(sql`EXISTS (
        SELECT 1 FROM contracts 
        WHERE contracts.student_id = ${students.id} 
        AND LOWER(contracts.contract_number) LIKE LOWER(${contractTerm})
      )`);
    }

    if (params.dateOfBirth) {
      conditions.push(eq(students.dateOfBirth, params.dateOfBirth));
    }

    if (params.enrollmentDate) {
      conditions.push(eq(students.enrollmentDate, params.enrollmentDate));
    }

    if (params.isTransfer === true) {
      conditions.push(sql`${students.transferredFrom} IS NOT NULL AND ${students.transferredFrom} != ''`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const limit = params.limit || 50;
    const offset = params.offset || 0;

    const [totalResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(students)
      .where(whereClause);

    const studentList = await db.select()
      .from(students)
      .where(whereClause)
      .orderBy(students.lastName, students.firstName)
      .limit(limit)
      .offset(offset);

    return {
      students: studentList,
      total: totalResult?.count || 0,
    };
  }

  // Payer-Student linking methods
  async getPayerProfileStudents(payerProfileId: number): Promise<PayerProfileStudent[]> {
    return db.select().from(payerProfileStudents).where(eq(payerProfileStudents.payerProfileId, payerProfileId));
  }

  async addPayerProfileStudent(link: InsertPayerProfileStudent): Promise<PayerProfileStudent> {
    const [created] = await db.insert(payerProfileStudents).values(link).returning();
    return created;
  }

  async removePayerProfileStudent(payerProfileId: number, studentId: number): Promise<void> {
    await db.delete(payerProfileStudents).where(
      and(
        eq(payerProfileStudents.payerProfileId, payerProfileId),
        eq(payerProfileStudents.studentId, studentId)
      )
    );
  }

  async getPayerProfilesWithStudents(): Promise<(PayerProfile & { linkedStudents: Student[] })[]> {
    const allPayers = await db.select().from(payerProfiles).where(eq(payerProfiles.isActive, true));
    const result: (PayerProfile & { linkedStudents: Student[] })[] = [];
    
    for (const payer of allPayers) {
      const links = await db.select({
        studentId: payerProfileStudents.studentId,
      }).from(payerProfileStudents).where(eq(payerProfileStudents.payerProfileId, payer.id));
      
      const linkedStudents: Student[] = [];
      for (const link of links) {
        const [student] = await db.select().from(students).where(eq(students.id, link.studentId));
        if (student) linkedStudents.push(student);
      }
      
      // Also include legacy studentId if set
      if (payer.studentId && !linkedStudents.find(s => s.id === payer.studentId)) {
        const [legacyStudent] = await db.select().from(students).where(eq(students.id, payer.studentId));
        if (legacyStudent) linkedStudents.push(legacyStudent);
      }
      
      result.push({ ...payer, linkedStudents });
    }
    
    return result;
  }

  // Parent selected student context
  async updateParentSelectedStudent(parentId: number, studentId: number | null): Promise<Parent> {
    const [updated] = await db.update(parents)
      .set({ selectedStudentId: studentId })
      .where(eq(parents.id, parentId))
      .returning();
    return updated;
  }

  // Student Notes
  async getStudentNotes(studentId: number, noteType?: string): Promise<StudentNote[]> {
    const conditions = [eq(studentNotes.studentId, studentId)];
    if (noteType) {
      conditions.push(eq(studentNotes.noteType, noteType));
    }
    return await db.select().from(studentNotes)
      .where(and(...conditions))
      .orderBy(sql`${studentNotes.createdAt} DESC`);
  }

  async createStudentNote(note: InsertStudentNote): Promise<StudentNote> {
    const [created] = await db.insert(studentNotes).values(note).returning();
    return created;
  }

  async deleteStudentNote(id: number): Promise<void> {
    await db.delete(studentNotes).where(eq(studentNotes.id, id));
  }
}

export const storage = new DatabaseStorage();
