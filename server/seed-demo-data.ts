import { db } from "./db";
import { 
  students, 
  instructors, 
  vehicles, 
  classes, 
  classEnrollments,
  contracts,
  locations,
  schoolPermits
} from "@shared/schema";
import bcrypt from "bcryptjs";

const formatDate = (date: Date) => {
  return date.toISOString().split('T')[0];
};

const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const theoryTimes = ['09:00:00', '13:00:00', '18:00:00'];
const drivingTimes = ['08:00:00', '10:00:00', '12:00:00', '14:00:00', '16:00:00'];

const firstNames = [
  "James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda",
  "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
  "Thomas", "Sarah", "Christopher", "Karen", "Charles", "Nancy", "Daniel", "Lisa",
  "Matthew", "Betty", "Anthony", "Margaret", "Mark", "Sandra", "Donald", "Ashley",
  "Steven", "Kimberly", "Paul", "Emily", "Andrew", "Donna", "Joshua", "Michelle",
  "Kenneth", "Carol", "Kevin", "Amanda", "Brian", "Dorothy", "George", "Melissa",
  "Timothy", "Deborah", "Ronald", "Stephanie", "Edward", "Rebecca", "Jason", "Sharon",
  "Jeffrey", "Laura", "Ryan", "Cynthia", "Jacob", "Kathleen", "Sophie", "Emma",
  "Liam", "Olivia", "Noah", "Ava", "Ethan", "Isabella", "Mason", "Mia",
  "Lucas", "Charlotte", "Oliver", "Amelia", "Aiden", "Harper", "Elijah", "Evelyn"
];

const lastNames = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas",
  "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White",
  "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker", "Young",
  "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
  "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell",
  "Carter", "Roberts", "Tremblay", "Gagnon", "Roy", "Bouchard", "Gauthier", "Morin"
];

const streets = [
  "Main St", "Oak Ave", "Maple Dr", "Pine Rd", "Cedar Ln", "Elm St", "Park Ave",
  "Washington St", "Lake Rd", "Hill Dr", "Forest Ave", "River Rd", "Valley Dr",
  "Mountain View", "Sunset Blvd", "Spring St", "Summer Ave", "Winter Rd"
];

const cities = ["Montreal", "Laval", "Longueuil", "Quebec City", "Gatineau", "Sherbrooke"];

const vehicleMakes = {
  auto: ["Toyota", "Honda", "Ford", "Chevrolet", "Nissan", "Mazda", "Hyundai", "Kia"],
  moto: ["Honda", "Yamaha", "Kawasaki", "Suzuki", "Harley-Davidson"],
  scooter: ["Vespa", "Honda", "Yamaha", "Kymco", "Piaggio"]
};

const vehicleModels = {
  auto: ["Corolla", "Civic", "Focus", "Cruze", "Sentra", "Mazda3", "Elantra", "Forte"],
  moto: ["CBR600", "YZF-R6", "Ninja 650", "GSX-R750", "Street 750"],
  scooter: ["Primavera", "PCX150", "NMAX", "Like 150", "Liberty"]
};

const rooms = ["Room A", "Room B", "Room C", "Main Hall", "Training Room 1", "Training Room 2"];

export async function seedDemoData() {
  console.log("Starting comprehensive demo data seeding...");

  try {
    const existingLocations = await db.select().from(locations);
    const existingInstructors = await db.select().from(instructors);
    const existingVehicles = await db.select().from(vehicles);
    const existingStudents = await db.select().from(students);
    const existingClasses = await db.select().from(classes);

    if (existingLocations.length === 0) {
      console.log("Creating locations...");
      await db.insert(locations).values([
        { name: "Downtown Montreal", address: "123 Main St, Montreal, QC H1A 1A1", city: "Montreal", phone: "(514) 555-1000" },
        { name: "Laval Branch", address: "456 Oak Ave, Laval, QC H7A 2B2", city: "Laval", phone: "(450) 555-2000" },
        { name: "West Island", address: "789 Pine Rd, Pointe-Claire, QC H9R 3C3", city: "Pointe-Claire", phone: "(514) 555-3000" }
      ]);
    }

    const allLocations = await db.select().from(locations);
    let createdVehicles = existingVehicles;
    let createdInstructors = existingInstructors;
    let createdStudents = existingStudents;

    if (existingVehicles.length < 10) {
      console.log("Creating vehicles...");
      const vehicleTypes: ('auto' | 'moto' | 'scooter')[] = ['auto', 'auto', 'auto', 'auto', 'auto', 'moto', 'moto', 'scooter'];
      const newVehicles = [];

      for (let i = 0; i < 20; i++) {
        const vehicleType = vehicleTypes[i % vehicleTypes.length];
        const make = vehicleMakes[vehicleType][i % vehicleMakes[vehicleType].length];
        const model = vehicleModels[vehicleType][i % vehicleModels[vehicleType].length];
        const year = 2019 + (i % 6);
        const colors = ["White", "Black", "Silver", "Red", "Blue", "Gray"];
        const color = colors[i % colors.length];
        
        const [vehicle] = await db.insert(vehicles).values({
          licensePlate: `VEH-${(1000 + existingVehicles.length + i).toString()}`,
          make,
          model,
          year,
          vehicleType,
          color,
          status: "active"
        }).returning();
        
        newVehicles.push(vehicle);
      }
      createdVehicles = [...existingVehicles, ...newVehicles];
    }

    if (existingInstructors.length < 5) {
      console.log("Creating instructors...");
      const hashedPassword = await bcrypt.hash("Instructor2025!", 10);
      const newInstructors = [];

      for (let i = 0; i < 8; i++) {
        const firstName = firstNames[i + 20];
        const lastName = lastNames[i + 20];
        const uniqueId = Date.now() + i;
        const email = `instructor.${uniqueId}@mortys.com`;
        
        const specs: any = { auto: { theory: true, practical: true } };
        if (i < 3) specs.moto = { theory: true, practical: true };
        if (i < 2) specs.scooter = { theory: true, practical: true };

        const vehicle = createdVehicles[i % createdVehicles.length];

        const [instructor] = await db.insert(instructors).values({
          firstName,
          lastName,
          email,
          phone: `(514) 555-${(5000 + i).toString().padStart(4, '0')}`,
          specializations: specs,
          instructorLicenseNumber: `INS-${(20000 + i).toString()}`,
          permitNumber: `QC-AUTO-2024-001`,
          locationAssignment: allLocations[i % allLocations.length]?.name || "Downtown Montreal",
          vehicleId: vehicle?.id,
          status: "active",
          accountStatus: "active",
          password: hashedPassword,
          hireDate: "2023-06-01"
        }).returning();

        newInstructors.push(instructor);
      }
      createdInstructors = [...existingInstructors, ...newInstructors];
    }

    if (existingStudents.length < 50) {
      console.log("Creating students...");
      const studentHashedPassword = await bcrypt.hash("Student2025!", 10);
      const newStudents = [];

      for (let i = 0; i < 80; i++) {
        const firstName = firstNames[(i + 5) % firstNames.length];
        const lastName = lastNames[(i + 15) % lastNames.length];
        const uniqueId = Date.now() + i;
        const email = `student.${uniqueId}@example.com`;
        const courseTypes: ('auto' | 'moto' | 'scooter')[] = ['auto', 'auto', 'auto', 'auto', 'auto', 'moto', 'scooter'];
        const courseType = courseTypes[i % courseTypes.length];
        const city = cities[i % cities.length];
        const street = streets[i % streets.length];
        const streetNumber = 100 + (i * 7) % 9900;

        const [student] = await db.insert(students).values({
          firstName,
          lastName,
          email,
          phone: `(514) 555-${(6000 + i).toString().padStart(4, '0')}`,
          address: `${streetNumber} ${street}, ${city}, QC`,
          city,
          postalCode: `H${1 + (i % 9)}A ${1 + ((i * 3) % 9)}B${1 + ((i * 7) % 9)}`,
          province: "QC",
          country: "Canada",
          courseType,
          status: "active",
          progress: (i * 5) % 100,
          phase: ["1", "2", "3", "4"][i % 4],
          instructorId: createdInstructors[i % createdInstructors.length]?.id,
          locationId: allLocations[i % allLocations.length]?.id,
          dateOfBirth: `${1995 + (i % 10)}-${(1 + (i % 12)).toString().padStart(2, '0')}-${(1 + (i % 28)).toString().padStart(2, '0')}`,
          primaryLanguage: i % 3 === 0 ? "French" : "English",
          emergencyContact: `Emergency Contact ${i}`,
          emergencyPhone: `(514) 555-${(8000 + i).toString().padStart(4, '0')}`,
          enrollmentDate: new Date(Date.now() - (i * 2) * 24 * 60 * 60 * 1000).toISOString(),
          password: studentHashedPassword,
          accountStatus: "active",
          totalAmountDue: 500 + (i * 10) % 1500,
          amountPaid: (i * 5) % 1000
        }).returning();

        newStudents.push(student);
      }
      createdStudents = [...existingStudents, ...newStudents];
    }

    if (existingClasses.length < 200) {
      console.log("Creating classes for 6 months...");
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const startDate = addDays(today, -14);
      const endDate = addDays(today, 180);

      let currentDate = new Date(startDate);
      let classCount = 0;
      const createdClasses = [];

      while (currentDate <= endDate) {
        const dayOfWeek = currentDate.getDay();
        
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          for (let instIdx = 0; instIdx < Math.min(3, createdInstructors.length); instIdx++) {
            const instructor = createdInstructors[instIdx];
            
            if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
              const theoryTime = theoryTimes[instIdx % theoryTimes.length];
              const classNumber = instIdx % 2 === 0 ? 1 : 5;
              
              const [theoryClass] = await db.insert(classes).values({
                courseType: 'auto',
                classNumber,
                date: formatDate(currentDate),
                time: theoryTime,
                duration: 180,
                instructorId: instructor.id,
                vehicleId: null,
                room: rooms[instIdx % rooms.length],
                maxStudents: 15,
                status: 'scheduled',
                confirmationStatus: 'confirmed',
                zoomLink: `https://zoom.us/j/demo-theory-${classCount}`
              }).returning();
              
              createdClasses.push(theoryClass);
              classCount++;
            }

            for (let slot = 0; slot < 2; slot++) {
              const drivingTime = drivingTimes[(instIdx * 2 + slot) % drivingTimes.length];
              const drivingClassNumber = [2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15][(classCount + slot) % 13];
              const vehicle = createdVehicles.find(v => v.vehicleType === 'auto') || createdVehicles[0];
              
              const [drivingClass] = await db.insert(classes).values({
                courseType: 'auto',
                classNumber: drivingClassNumber,
                date: formatDate(currentDate),
                time: drivingTime,
                duration: 55,
                instructorId: instructor.id,
                vehicleId: vehicle?.id,
                vehicleConfirmed: true,
                room: null,
                maxStudents: 1,
                status: 'scheduled',
                confirmationStatus: 'confirmed'
              }).returning();
              
              createdClasses.push(drivingClass);
              classCount++;
            }
          }
        }
        
        currentDate = addDays(currentDate, 1);
      }

      console.log(`Created ${classCount} classes. Now creating enrollments...`);

      let enrollmentCount = 0;
      const theoryClasses = createdClasses.filter(c => c.classNumber === 1 || c.classNumber === 5);
      const drivingClasses = createdClasses.filter(c => c.classNumber !== 1 && c.classNumber !== 5);
      const autoStudents = createdStudents.filter(s => s.courseType === 'auto');

      for (let i = 0; i < theoryClasses.length; i++) {
        const theoryClass = theoryClasses[i];
        const numStudents = 3 + (i % 8);
        
        for (let j = 0; j < numStudents && j < autoStudents.length; j++) {
          const studentIdx = (i * 3 + j) % autoStudents.length;
          const student = autoStudents[studentIdx];
          
          try {
            await db.insert(classEnrollments).values({
              classId: theoryClass.id,
              studentId: student.id,
              attendanceStatus: 'registered'
            });
            enrollmentCount++;
          } catch (e) {
          }
        }
      }

      for (let i = 0; i < drivingClasses.length; i++) {
        const drivingClass = drivingClasses[i];
        const studentIdx = i % autoStudents.length;
        const student = autoStudents[studentIdx];
        
        if (i % 3 !== 0) {
          try {
            await db.insert(classEnrollments).values({
              classId: drivingClass.id,
              studentId: student.id,
              attendanceStatus: 'registered'
            });
            enrollmentCount++;
          } catch (e) {
          }
        }
      }

      console.log(`Created ${enrollmentCount} enrollments.`);
    } else {
      console.log("Sufficient classes already exist, skipping class creation.");
    }

    console.log("✅ Demo data seeding completed!");
    console.log(`Current data:`);
    console.log(`  - ${createdVehicles.length} vehicles`);
    console.log(`  - ${createdInstructors.length} instructors`);
    console.log(`  - ${createdStudents.length} students`);
    const finalClasses = await db.select().from(classes);
    const finalEnrollments = await db.select().from(classEnrollments);
    console.log(`  - ${finalClasses.length} total classes`);
    console.log(`  - ${finalEnrollments.length} total enrollments`);

  } catch (error) {
    console.error("Error seeding demo data:", error);
    throw error;
  }
}

seedDemoData()
  .then(() => {
    console.log("Seeding complete!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exit(1);
  });
