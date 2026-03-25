import { db } from "./db";
import {
  users,
  students,
  instructors,
  classes,
  classEnrollments,
  contracts,
  evaluations,
  communications
} from "@shared/schema";

async function seedDatabase() {
  console.log("Seeding database...");

  try {
    // Clear existing data
    console.log("Clearing existing data...");
    await db.delete(communications);
    await db.delete(evaluations);
    await db.delete(contracts);
    await db.delete(classEnrollments);
    await db.delete(classes);
    await db.delete(students);
    await db.delete(instructors);
    await db.delete(users);
    console.log("Existing data cleared.");

    console.log("Creating new data...");
    // Create admin user
    const [adminUser] = await db.insert(users).values({
      username: "admin",
      password: "DriveSchool2025!", // Demo credentials for testing
      name: "Admin User",
      email: "admin@mortys.com",
      role: "admin",
    }).returning();

    // Create instructors
    const [instructor1] = await db.insert(instructors).values({
      userId: null,
      firstName: "Mike",
      lastName: "Johnson",
      email: "mike@mortysdriving.com",
      phone: "555-0101",
      licenseNumber: "INS001",
      specializations: JSON.stringify(["auto", "moto"]),
      hireDate: "2023-01-15",
      status: "active"
    }).returning();

    const [instructor2] = await db.insert(instructors).values({
      userId: null,
      firstName: "Sarah",
      lastName: "Williams",
      email: "sarah@mortysdriving.com",
      phone: "555-0102",
      licenseNumber: "INS002",
      specializations: JSON.stringify(["auto", "scooter"]),
      hireDate: "2023-03-20",
      status: "active"
    }).returning();

    const [instructor3] = await db.insert(instructors).values({
      userId: null,
      firstName: "David",
      lastName: "Brown",
      email: "david@mortysdriving.com",
      phone: "555-0103",
      licenseNumber: "INS003",
      specializations: JSON.stringify(["moto"]),
      hireDate: "2023-06-10",
      status: "active"
    }).returning();

    // Create students
    const [student1] = await db.insert(students).values({
      userId: null,
      firstName: "John",
      lastName: "Smith",
      email: "john.smith@email.com",
      phone: "555-1001",
      dateOfBirth: "1995-05-15",
      address: "123 Main St, Springfield, IL 62701",
      courseType: "auto",
      enrollmentDate: "2024-12-01",
      status: "active",
      progress: 65,
      instructorId: instructor1.id,
      emergencyContact: "Jane Smith",
      emergencyPhone: "555-1002"
    }).returning();

    const [student2] = await db.insert(students).values({
      userId: null,
      firstName: "Emma",
      lastName: "Davis",
      email: "emma.davis@email.com",
      phone: "555-1003",
      dateOfBirth: "1998-08-22",
      address: "456 Oak Ave, Springfield, IL 62702",
      courseType: "moto",
      enrollmentDate: "2024-11-15",
      status: "active",
      progress: 45,
      instructorId: instructor2.id,
      emergencyContact: "Robert Davis",
      emergencyPhone: "555-1004"
    }).returning();

    // Create classes
    const [class1] = await db.insert(classes).values({
      courseType: "auto",
      classNumber: 5,
      date: "2024-12-23",
      time: "10:00",
      duration: 120,
      instructorId: instructor1.id,
      room: "Room A",
      maxStudents: 15,
      status: "scheduled",
      hasTest: true
    }).returning();

    const [class2] = await db.insert(classes).values({
      courseType: "moto",
      classNumber: 3,
      date: "2024-12-24",
      time: "14:00",
      duration: 90,
      instructorId: instructor3.id,
      room: "Training Area B",
      maxStudents: 8,
      status: "scheduled",
      hasTest: false
    }).returning();

    // Create contracts
    const [contract1] = await db.insert(contracts).values({
      studentId: student1.id,
      courseType: "auto",
      contractDate: "2024-12-01",
      amount: "1200.00",
      paymentMethod: "bank-transfer",
      status: "active",
      attestationGenerated: false,
      attestationNumber: null
    }).returning();

    // Create evaluations
    await db.insert(evaluations).values({
      studentId: student1.id,
      instructorId: instructor1.id,
      evaluationDate: "2024-12-20",
      sessionType: "in-car",
      durationMinutes: 60,
      skillsAssessed: ["parking", "highway-driving", "city-navigation"],
      overallRating: 4,
      strengths: "Good control, confident on highways",
      areasForImprovement: "Needs work on parallel parking",
      signedOff: true,
      notes: "Student is progressing well, ready for advanced techniques"
    });

    // Create communications
    await db.insert(communications).values({
      authorId: adminUser.id,
      subject: "Holiday Schedule Update",
      message: "Please note that classes on December 25th will be rescheduled. We'll contact you with new times.",
      recipients: [student1.id, student2.id],
      messageType: "announcement",
      sendDate: "2024-12-20T10:00:00Z",
      status: "sent",
      openRate: 85,
      clickRate: 12
    });

    console.log("Database seeded successfully!");
  } catch (error) {
    console.error("Error seeding database:", error);
    throw error;
  }
}

// Run seed if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabase().then(() => {
    console.log("Seeding completed");
    process.exit(0);
  }).catch((error) => {
    console.error("Seeding failed:", error);
    process.exit(1);
  });
}

export { seedDatabase };