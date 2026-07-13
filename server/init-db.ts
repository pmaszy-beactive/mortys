import { storage } from "./storage";
import { db } from "./db";
import { users, schoolPermits, permitNumbers, instructors, classes, contractTemplates, vehicles } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { seedDemoAccounts } from "./seed-demo-accounts";

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

    // Idempotent schema migrations — add new columns if they don't exist yet
    try {
      await db.execute(sql`ALTER TABLE student_transactions ADD COLUMN IF NOT EXISTS refund_status text DEFAULT 'none'`);
      await db.execute(sql`ALTER TABLE student_transactions ADD COLUMN IF NOT EXISTS refund_request_note text`);
      await db.execute(sql`ALTER TABLE student_transactions ADD COLUMN IF NOT EXISTS refund_admin_note text`);
      await db.execute(sql`ALTER TABLE student_transactions ADD COLUMN IF NOT EXISTS stripe_refund_id text`);
      await db.execute(sql`ALTER TABLE student_transactions ADD COLUMN IF NOT EXISTS refund_amount numeric(10,2)`);
      await db.execute(sql`ALTER TABLE student_transactions ADD COLUMN IF NOT EXISTS refunded_at timestamptz`);
    } catch (migrationError) {
      console.error("Non-critical migration error (columns may already exist):", migrationError);
    }
    
    const defaultPassword = await bcrypt.hash("Leader12345", 10);

    const seedAdmins = [
      { id: "admin-default",  email: "admin@mortys.com",               firstName: "Admin",    lastName: "User",     role: "owner" },
      { id: "admin-morty",    email: "morty@mortysdriving.com",         firstName: "Morty",    lastName: "Owner",    role: "owner" },
      { id: "admin-paul",     email: "paul@beactive.ai",                firstName: "Paul",     lastName: "Maszewski", role: "owner" },
      { id: "admin-alice",    email: "alice@beactive.ai",               firstName: "Alice",    lastName: "Beactive",  role: "owner" },
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

    // Create demo instructor + demo student (idempotent, shared with the
    // dedicated docker deploy seed step in dist/seed-demo.js).
    await seedDemoAccounts();

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
    
    // Seed real vehicle fleet (idempotent — inserts only plates not already present)
    try {
      const realFleet = [
        { licensePlate: 'FSV9293', make: 'Toyota',    model: 'Prius',         year: 2019, vehicleType: 'auto', vin: 'JTDKDTB39K1628397', status: 'active', registrationExpiry: '2026-06-30', fuelType: 'hybrid',   transmission: 'automatic', notes: 'Assigned: Erik' },
        { licensePlate: 'FTD7511', make: 'Toyota',    model: 'RAV4',          year: 2015, vehicleType: 'auto', vin: '2T3DFREV5FW263338', status: 'active', registrationExpiry: '2026-08-31', fuelType: 'gasoline', transmission: 'automatic', notes: 'Assigned: Anatol' },
        { licensePlate: 'FVC2129', make: 'Hyundai',   model: 'Ioniq',         year: 2020, vehicleType: 'auto', vin: 'KMHC75LJ3LU076539', status: 'active', registrationExpiry: '2026-04-30', fuelType: 'hybrid',   transmission: 'automatic', notes: 'Assigned: Tze' },
        { licensePlate: 'FMN6370', make: 'Toyota',    model: 'Corolla',       year: 2013, vehicleType: 'auto', vin: '2T1BU4EE6DC116632', status: 'active', registrationExpiry: '2026-10-31', fuelType: 'gasoline', transmission: 'automatic', notes: 'Standard', vehicleNumber: 1 },
        { licensePlate: 'FVB1468', make: 'Ford',      model: 'Mustang',       year: 2021, vehicleType: 'auto', vin: '3FMTK1SS8MMA24900', status: 'active', registrationExpiry: '2026-07-31', fuelType: 'electric', transmission: 'automatic', notes: 'Assigned: Oren' },
        { licensePlate: 'FVC2183', make: 'Chevrolet', model: 'Bolt',          year: 2020, vehicleType: 'auto', vin: '1G1FY6S07L4134836', status: 'active', registrationExpiry: '2026-06-30', fuelType: 'electric', transmission: 'automatic', notes: 'Assigned: Richard' },
        { licensePlate: 'FSV9530', make: 'Toyota',    model: 'Corolla',       year: 2018, vehicleType: 'auto', vin: '2T1BURHE3JC970871', status: 'active', registrationExpiry: '2026-06-30', fuelType: 'gasoline', transmission: 'automatic', notes: 'Gary / Spare' },
        { licensePlate: 'FRJ5516', make: 'Toyota',    model: 'Corolla iM',    year: 2018, vehicleType: 'auto', vin: 'JTNKARJE8JJ572395',  status: 'active', registrationExpiry: '2026-08-31', fuelType: 'gasoline', transmission: 'automatic', notes: 'Assigned: Guy' },
        { licensePlate: 'FVC2463', make: 'Hyundai',   model: 'Kona',          year: 2023, vehicleType: 'auto', vin: 'KM8K23AG9PU189407',  status: 'active', registrationExpiry: '2026-07-31', fuelType: 'gasoline', transmission: 'automatic', notes: 'Assigned: Sean' },
        { licensePlate: 'FNY6575', make: 'Toyota',    model: 'Corolla',       year: 2015, vehicleType: 'auto', vin: '2T1BURHE7FC368305',  status: 'active', registrationExpiry: '2026-06-30', fuelType: 'gasoline', transmission: 'automatic', notes: 'Assigned: Eli' },
        { licensePlate: 'FLV7082', make: 'Toyota',    model: 'Prius',         year: 2015, vehicleType: 'auto', vin: 'JTDKDTB30F1577264',  status: 'active', registrationExpiry: '2026-06-30', fuelType: 'hybrid',   transmission: 'automatic', notes: 'Assigned: Earl' },
        { licensePlate: 'FMY7714', make: 'Toyota',    model: 'Prius',         year: 2016, vehicleType: 'auto', vin: 'JTDKDTB36G1119441',  status: 'active', registrationExpiry: '2026-08-31', fuelType: 'hybrid',   transmission: 'automatic', notes: 'Assigned: Marcel' },
        { licensePlate: 'FSY4930', make: 'Lexus',     model: 'CT200h',        year: 2014, vehicleType: 'auto', vin: 'JTHKD5BH3E2186415',  status: 'active', registrationExpiry: '2026-08-31', fuelType: 'hybrid',   transmission: 'automatic', notes: 'Assigned: Andrew' },
        { licensePlate: 'FRF5269', make: 'Toyota',    model: 'Corolla iM',    year: 2017, vehicleType: 'auto', vin: 'JTNKARJE7HJ528396',  status: 'active', registrationExpiry: '2026-07-31', fuelType: 'gasoline', transmission: 'automatic', notes: 'Assigned: Andre' },
        { licensePlate: 'FJJ3639', make: 'Toyota',    model: 'Prius',         year: 2018, vehicleType: 'auto', vin: 'JTDKDTB38J1618071',  status: 'active', registrationExpiry: '2026-07-31', fuelType: 'hybrid',   transmission: 'automatic', notes: 'Assigned: Aqib' },
        { licensePlate: 'FSF1308', make: 'Toyota',    model: 'Corolla',       year: 2015, vehicleType: 'auto', vin: '2T1BURHE4FC309020',  status: 'active', registrationExpiry: '2026-04-30', fuelType: 'gasoline', transmission: 'automatic', notes: 'Assigned: Uli' },
        { licensePlate: 'FME5174', make: 'Toyota',    model: 'Prius',         year: 2018, vehicleType: 'auto', vin: 'JTDKDTB38J1604445',  status: 'active', registrationExpiry: '2026-07-31', fuelType: 'hybrid',   transmission: 'automatic', notes: 'Assigned: Humi' },
        { licensePlate: 'FTK5601', make: 'Toyota',    model: 'Corolla Hatch', year: 2022, vehicleType: 'auto', vin: 'JTNK4MBE9N3167133',  status: 'active', registrationExpiry: '2026-06-01', fuelType: 'gasoline', transmission: 'automatic', notes: 'Assigned: Jack' },
        { licensePlate: 'FTM5544', make: 'Toyota',    model: 'Corolla Hatch', year: 2021, vehicleType: 'auto', vin: 'JTNK4MBE5M3129686',  status: 'active', registrationExpiry: '2026-08-31', fuelType: 'gasoline', transmission: 'automatic', notes: 'Assigned: Peter' },
        { licensePlate: 'FTS8145', make: 'Toyota',    model: 'Corolla Hatch', year: 2021, vehicleType: 'auto', vin: 'JTNK4MBE5M3131275',  status: 'active', registrationExpiry: '2026-05-01', fuelType: 'gasoline', transmission: 'automatic', notes: 'Assigned: Michael (No Mags)' },
        { licensePlate: 'FTL1961', make: 'Toyota',    model: 'RAV4',          year: 2014, vehicleType: 'auto', vin: '2T3RFREV5EW180657',  status: 'active', registrationExpiry: '2026-04-30', fuelType: 'gasoline', transmission: 'automatic', notes: 'Phil / Peter (Moto)', vehicleNumber: 2 },
        { licensePlate: 'FWA9081', make: 'Toyota',    model: 'Corolla Hatch', year: 2023, vehicleType: 'auto', vin: 'JTNK4MBE5P3204357',  status: 'active', registrationExpiry: '2026-10-31', fuelType: 'gasoline', transmission: 'automatic', notes: 'Assigned: Shahid' },
        { licensePlate: 'FWC3497', make: 'Toyota',    model: 'Corolla Hatch', year: 2021, vehicleType: 'auto', vin: 'JTNK4MBE9M3115841',  status: 'active', registrationExpiry: '2026-12-31', fuelType: 'gasoline', transmission: 'automatic', notes: 'Spare', vehicleNumber: 23 },
      ];

      const existingPlates = new Set(
        (await db.select({ lp: vehicles.licensePlate }).from(vehicles)).map(v => v.lp)
      );
      const toInsert = realFleet.filter(v => !existingPlates.has(v.licensePlate));
      if (toInsert.length > 0) {
        await db.insert(vehicles).values(toInsert);
        console.log(`Fleet vehicles inserted: ${toInsert.length}`);
      } else {
        console.log("Fleet vehicles already exist");
      }
    } catch (error) {
      console.error("Error seeding fleet vehicles:", error);
    }

    console.log("Database initialization completed");
  } catch (error) {
    console.error("Database initialization failed:", error);
    throw error;
  }
}