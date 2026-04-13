import { storage } from "./storage";
import { db } from "./db";
import { users, schoolPermits, permitNumbers, instructors, students, classes, contractTemplates } from "@shared/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

export async function initializeDatabase() {
  try {
    console.log("Starting database initialization...");
    console.log("Environment:", process.env.NODE_ENV || "development");
    console.log("Database URL present:", !!process.env.DATABASE_URL);
    
    // Test database connection
    try {
      const testQuery = await db.select().from(users).limit(1);
      console.log("Database connection successful");
    } catch (dbError) {
      console.error("Database connection failed:", dbError);
      throw dbError;
    }
    
    const defaultPassword = await bcrypt.hash("Leader12345", 10);

    const seedAdmins = [
      { id: "admin-default",  email: "admin@mortys.com",               firstName: "Admin",    lastName: "User",     role: "owner" },
      { id: "admin-morty",    email: "morty@mortysdriving.com",         firstName: "Morty",    lastName: "Owner",    role: "owner" },
      { id: "admin-paul",     email: "paul@beactive.ai",                firstName: "Paul",     lastName: "Maszewski", role: "owner" },
      { id: "admin-daniel",   email: "daniel@beactive.ai",              firstName: "Daniel",   lastName: "Beactive", role: "admin" },
      { id: "admin-manju",    email: "manju@beactive.ai",               firstName: "Manju",    lastName: "Beactive", role: "admin" },
      { id: "admin-pasindu",  email: "pasindu@empowerdigitaldata.com",  firstName: "Pasindu",  lastName: "Empowered", role: "admin" },
      { id: "admin-demo",     email: "demo@mortysdriving.com",          firstName: "Demo",     lastName: "Admin",    role: "staff" },
    ];

    for (const admin of seedAdmins) {
      try {
        const [existing] = await db.select().from(users).where(eq(users.email, admin.email));
        if (!existing) {
          await db.insert(users).values({
            id: admin.id,
            email: admin.email,
            firstName: admin.firstName,
            lastName: admin.lastName,
            role: admin.role,
            password: defaultPassword,
            profileImageUrl: null,
          });
          console.log(`Admin user created: ${admin.email}`);
        } else {
          console.log(`Admin user already exists: ${admin.email}`);
        }
      } catch (err: any) {
        console.error(`Failed to create admin ${admin.email}:`, err.message);
      }
    }
    
    // Initialize sample locations if they don't exist
    const locations = await storage.getLocations();
    if (locations.length === 0) {
      console.log("Creating sample locations...");
      
      const sampleLocations = [
        {
          name: "Montreal Downtown",
          address: "1234 Rue Sainte-Catherine O, Montreal, QC H3G 1M8",
          city: "Montreal",
          province: "Quebec",
          postalCode: "H3G 1M8",
          phone: "(514) 555-0101",
          email: "montreal@mortys.com",
          facilities: ["Classroom A", "Classroom B", "Computer Lab", "Reception Area"]
        },
        {
          name: "Dollard-des-Ormeaux Branch", 
          address: "4000 Sources Blvd, Dollard-Des-Ormeaux, QC H9B 2C8",
          city: "Dollard-des-Ormeaux",
          province: "Quebec", 
          postalCode: "H9B 2C8",
          phone: "(514) 555-0102",
          email: "ddo@mortys.com",
          facilities: ["Main Classroom", "Testing Center", "Student Lounge"]
        },
        {
          name: "Laval Branch",
          address: "1500 Blvd. Chomedey, Laval, QC H7V 2X2",
          city: "Laval",
          province: "Quebec",
          postalCode: "H7V 2X2", 
          phone: "(450) 555-0103",
          email: "laval@mortys.com",
          facilities: ["Theory Classroom", "Practice Room", "Administrative Office"]
        }
      ];
      
      for (const location of sampleLocations) {
        await storage.createLocation(location);
      }
      console.log("Sample locations created successfully");
    } else {
      console.log("Locations already exist");
    }

    // Initialize school permits if they don't exist
    const existingPermits = await db.select().from(schoolPermits).limit(1);
    if (existingPermits.length === 0) {
      console.log("Creating school permits...");
      
      const permitData = [
        {
          permitCode: "L-020",
          location: "Montreal Downtown",
          courseTypes: JSON.stringify(["auto"]),
          startNumber: 3276842,
          endNumber: 3277041,
          totalNumbers: 200,
          availableNumbers: 180,
          isActive: true,
        },
        {
          permitCode: "L-390",
          location: "Montreal Downtown",
          courseTypes: JSON.stringify(["moto", "scooter"]),
          startNumber: 4150001,
          endNumber: 4150100,
          totalNumbers: 100,
          availableNumbers: 95,
          isActive: true,
        },
        {
          permitCode: "L-021",
          location: "Dollard-des-Ormeaux",
          courseTypes: JSON.stringify(["auto"]),
          startNumber: 3277042,
          endNumber: 3277241,
          totalNumbers: 200,
          availableNumbers: 175,
          isActive: true,
        },
        {
          permitCode: "L-391",
          location: "Dollard-des-Ormeaux",
          courseTypes: JSON.stringify(["moto"]),
          startNumber: 4150101,
          endNumber: 4150150,
          totalNumbers: 50,
          availableNumbers: 48,
          isActive: true,
        },
        {
          permitCode: "L-022",
          location: "Laval Branch",
          courseTypes: JSON.stringify(["auto"]),
          startNumber: 3277242,
          endNumber: 3277441,
          totalNumbers: 200,
          availableNumbers: 165,
          isActive: true,
        },
        {
          permitCode: "L-392",
          location: "Laval Branch",
          courseTypes: JSON.stringify(["scooter"]),
          startNumber: 4150151,
          endNumber: 4150200,
          totalNumbers: 50,
          availableNumbers: 45,
          isActive: true,
        }
      ];

      for (const permit of permitData) {
        const [createdPermit] = await db
          .insert(schoolPermits)
          .values(permit)
          .returning();
        
        console.log(`Created permit: ${permit.permitCode}`);
        
        // Create individual permit numbers
        const numbers = [];
        for (let i = permit.startNumber; i <= permit.endNumber; i++) {
          numbers.push({
            permitId: createdPermit.id,
            number: i,
            isAssigned: false,
          });
        }
        
        if (numbers.length > 0) {
          await db.insert(permitNumbers).values(numbers);
          console.log(`Created ${numbers.length} permit numbers for ${permit.permitCode}`);
        }
      }
      console.log("School permits created successfully");
    } else {
      console.log("School permits already exist");
    }

    // Create demo instructor if it doesn't exist
    try {
      const [existingDemoInstructor] = await db.select().from(instructors).where(eq(instructors.email, "demo.instructor@example.com"));
      
      if (!existingDemoInstructor) {
        console.log("Creating demo instructor account...");
        const hashedPassword = await bcrypt.hash("instructor123", 10);
        
        await db.insert(instructors).values({
          firstName: "Demo",
          lastName: "Instructor",
          email: "demo.instructor@example.com",
          phone: "(514) 555-1234",
          instructorLicenseNumber: "DEMO-INST-001",
          permitNumber: "L-020-DEMO",
          hireDate: new Date().toISOString(),
          certificationExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          status: "active",
          accountStatus: "active",
          password: hashedPassword,
          emergencyContact: "Demo Emergency Contact",
          emergencyPhone: "(514) 555-5678",
          specializations: JSON.stringify(["auto", "moto"]),
        });
        console.log("Demo instructor account created successfully");
      } else {
        console.log("Demo instructor account already exists");
      }
    } catch (error) {
      console.error("Error creating demo instructor:", error);
    }

    // Create demo student if it doesn't exist
    try {
      const [existingDemoStudent] = await db.select().from(students).where(eq(students.email, "demo.student@example.com"));
      
      if (!existingDemoStudent) {
        console.log("Creating demo student account...");
        const hashedPassword = await bcrypt.hash("demo123", 10);
        
        await db.insert(students).values({
          firstName: "Demo",
          lastName: "Student",
          email: "demo.student@example.com",
          phone: "(514) 555-9999",
          dateOfBirth: "2000-01-01",
          address: "123 Demo Street, Montreal, QC H1H 1H1",
          emergencyContact: "Demo Parent",
          emergencyPhone: "(514) 555-0000",
          courseType: "auto",
          status: "active",
          accountStatus: "active",
          password: hashedPassword,
          enrollmentDate: new Date().toISOString(),
        });
        console.log("Demo student account created successfully");
      } else {
        console.log("Demo student account already exists");
      }
    } catch (error) {
      console.error("Error creating demo student:", error);
    }

    // Create demo classes with future dates if they don't exist
    try {
      const existingClasses = await db.select().from(classes).limit(1);
      
      if (existingClasses.length === 0) {
        console.log("Creating demo classes with future dates...");
        
        // Get the demo instructor ID
        const [demoInstructor] = await db.select().from(instructors).where(eq(instructors.email, "demo.instructor@example.com"));
        
        if (demoInstructor) {
          const today = new Date();
          const demoClasses = [];
          
          // Create classes for the next 4 weeks
          for (let week = 0; week < 4; week++) {
            // Auto theory class - Mondays at 9:00 AM
            const mondayDate = new Date(today);
            mondayDate.setDate(today.getDate() + (week * 7) + (1 - today.getDay() + 7) % 7);
            demoClasses.push({
              courseType: "auto",
              classNumber: week + 1,
              date: mondayDate.toISOString().split('T')[0],
              time: "09:00",
              duration: 180,
              instructorId: demoInstructor.id,
              maxStudents: 15,
              status: "scheduled",
              hasTest: week === 3,
              zoomLink: `https://zoom.us/j/demo-auto-${week + 1}`,
            });
            
            // Auto theory class - Wednesdays at 2:00 PM
            const wednesdayDate = new Date(today);
            wednesdayDate.setDate(today.getDate() + (week * 7) + (3 - today.getDay() + 7) % 7);
            demoClasses.push({
              courseType: "auto",
              classNumber: week + 5,
              date: wednesdayDate.toISOString().split('T')[0],
              time: "14:00",
              duration: 180,
              instructorId: demoInstructor.id,
              maxStudents: 15,
              status: "scheduled",
              hasTest: false,
              zoomLink: `https://zoom.us/j/demo-auto-${week + 5}`,
            });
            
            // Moto theory class - Saturdays at 10:00 AM
            if (week % 2 === 0) {
              const saturdayDate = new Date(today);
              saturdayDate.setDate(today.getDate() + (week * 7) + (6 - today.getDay() + 7) % 7);
              demoClasses.push({
                courseType: "moto",
                classNumber: (week / 2) + 1,
                date: saturdayDate.toISOString().split('T')[0],
                time: "10:00",
                duration: 180,
                instructorId: demoInstructor.id,
                maxStudents: 8,
                status: "scheduled",
                hasTest: week === 2,
                zoomLink: `https://zoom.us/j/demo-moto-${(week / 2) + 1}`,
              });
            }
          }
          
          await db.insert(classes).values(demoClasses);
          console.log(`Demo classes created successfully: ${demoClasses.length} classes`);
        } else {
          console.log("Demo instructor not found, skipping demo classes creation");
        }
      } else {
        console.log("Demo classes already exist");
      }
    } catch (error) {
      console.error("Error creating demo classes:", error);
    }

    // Initialize policy settings
    try {
      const { appSettings } = await import("@shared/schema");
      
      // Check if policy settings already exist
      const existingSettings = await db.select().from(appSettings).where(eq(appSettings.key, "rescheduleWindowHours"));
      
      if (existingSettings.length === 0) {
        console.log("Initializing policy settings...");
        
        await db.insert(appSettings).values([
          { key: "rescheduleWindowHours", value: "24" },
          { key: "rescheduleFee", value: "25.00" },
          { key: "cancelWindowHours", value: "24" },
          { key: "cancelFee", value: "25.00" },
        ]);
        
        console.log("Policy settings initialized successfully");
      } else {
        console.log("Policy settings already exist");
      }
    } catch (error) {
      console.error("Error initializing policy settings:", error);
    }

    // Initialize contract templates
    try {
      const existingTemplates = await db.select().from(contractTemplates).limit(1);
      if (existingTemplates.length === 0) {
        console.log("Initializing contract templates...");
        
        await db.insert(contractTemplates).values([
          {
            name: "Car Driving Course",
            courseType: "auto",
            baseAmount: "1500.00",
            description: "Standard car driving course package",
            defaultPaymentMethod: "installment",
            isActive: true,
          },
          {
            name: "Motorcycle Course",
            courseType: "moto",
            baseAmount: "1200.00",
            description: "Standard motorcycle riding course package",
            defaultPaymentMethod: "installment",
            isActive: true,
          },
          {
            name: "Scooter Course",
            courseType: "scooter",
            baseAmount: "800.00",
            description: "Standard scooter riding course package",
            defaultPaymentMethod: "full",
            isActive: true,
          },
        ]);
        
        console.log("Contract templates initialized successfully");
      } else {
        console.log("Contract templates already exist");
      }
    } catch (error) {
      console.error("Error initializing contract templates:", error);
    }
    
    console.log("Database initialization completed");
  } catch (error) {
    console.error("Database initialization failed:", error);
    throw error;
  }
}