import { db } from "./db";
import { 
  students, 
  instructors, 
  classes, 
  classEnrollments
} from "@shared/schema";
import { eq, and, gte, lte, isNull } from "drizzle-orm";

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
const rooms = ["Room A", "Room B", "Room C", "Main Hall", "Training Room 1"];

async function addMoreDemoData() {
  console.log("Adding more demo data for testing...");

  try {
    const allStudents = await db.select().from(students);
    const allInstructors = await db.select().from(instructors);
    const allClasses = await db.select().from(classes);
    const allEnrollments = await db.select().from(classEnrollments);
    
    console.log(`Current: ${allStudents.length} students, ${allInstructors.length} instructors, ${allClasses.length} classes, ${allEnrollments.length} enrollments`);

    const autoStudents = allStudents.filter(s => s.courseType === 'auto' && s.status === 'active');
    const activeInstructors = allInstructors.filter(i => i.status === 'active').slice(0, 5);
    
    if (activeInstructors.length === 0) {
      console.log("No active instructors found!");
      return;
    }
    if (autoStudents.length === 0) {
      console.log("No active auto students found!");
      return;
    }

    console.log(`Using ${activeInstructors.length} instructors and ${autoStudents.length} auto students`);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = addDays(today, -14);
    const endDate = addDays(today, 180);

    console.log(`Creating classes from ${formatDate(startDate)} to ${formatDate(endDate)}...`);

    let currentDate = new Date(startDate);
    let newClassCount = 0;
    const newClasses: any[] = [];

    while (currentDate <= endDate) {
      const dayOfWeek = currentDate.getDay();
      const dateStr = formatDate(currentDate);
      
      const existingClassesForDate = allClasses.filter(c => c.date === dateStr);
      
      if (dayOfWeek !== 0 && existingClassesForDate.length < 10) {
        for (let instIdx = 0; instIdx < Math.min(3, activeInstructors.length); instIdx++) {
          const instructor = activeInstructors[instIdx];
          
          if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
            const theoryTime = theoryTimes[instIdx % theoryTimes.length];
            const classNumber = instIdx % 2 === 0 ? 1 : 5;
            
            const [theoryClass] = await db.insert(classes).values({
              courseType: 'auto',
              classNumber,
              date: dateStr,
              time: theoryTime,
              duration: 180,
              instructorId: instructor.id,
              vehicleId: null,
              room: rooms[instIdx % rooms.length],
              maxStudents: 15,
              status: 'scheduled',
              confirmationStatus: 'confirmed',
              zoomLink: `https://zoom.us/j/demo-${newClassCount}`
            }).returning();
            
            newClasses.push(theoryClass);
            newClassCount++;
          }

          for (let slot = 0; slot < 2; slot++) {
            const drivingTime = drivingTimes[(instIdx * 2 + slot) % drivingTimes.length];
            const drivingClassNumber = [2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15][(newClassCount + slot) % 13];
            
            const [drivingClass] = await db.insert(classes).values({
              courseType: 'auto',
              classNumber: drivingClassNumber,
              date: dateStr,
              time: drivingTime,
              duration: 55,
              instructorId: instructor.id,
              vehicleId: null,
              vehicleConfirmed: false,
              room: null,
              maxStudents: 1,
              status: 'scheduled',
              confirmationStatus: 'confirmed'
            }).returning();
            
            newClasses.push(drivingClass);
            newClassCount++;
          }
        }
      }
      
      currentDate = addDays(currentDate, 1);
    }

    console.log(`Created ${newClassCount} new classes.`);

    console.log("Adding enrollments to theory classes...");
    const theoryClasses = newClasses.filter(c => c.classNumber === 1 || c.classNumber === 5);
    const drivingClasses = newClasses.filter(c => c.classNumber !== 1 && c.classNumber !== 5);
    
    let enrollmentCount = 0;

    for (let i = 0; i < theoryClasses.length; i++) {
      const theoryClass = theoryClasses[i];
      const numStudents = 4 + (i % 6);
      
      for (let j = 0; j < numStudents && j < autoStudents.length; j++) {
        const studentIdx = (i * 5 + j) % autoStudents.length;
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
      
      if (i % 2 === 0) {
        const studentIdx = i % autoStudents.length;
        const student = autoStudents[studentIdx];
        
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

    console.log(`Created ${enrollmentCount} new enrollments.`);

    const finalClasses = await db.select().from(classes);
    const finalEnrollments = await db.select().from(classEnrollments);
    
    console.log("✅ Demo data addition completed!");
    console.log(`Final totals:`);
    console.log(`  - ${finalClasses.length} total classes`);
    console.log(`  - ${finalEnrollments.length} total enrollments`);
    
    const theoryTotal = finalClasses.filter(c => c.classNumber === 1 || c.classNumber === 5).length;
    const drivingTotal = finalClasses.filter(c => c.classNumber !== 1 && c.classNumber !== 5).length;
    console.log(`  - ${theoryTotal} theory classes (class 1 & 5)`);
    console.log(`  - ${drivingTotal} driving classes`);

  } catch (error) {
    console.error("Error adding demo data:", error);
    throw error;
  }
}

addMoreDemoData()
  .then(() => {
    console.log("Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed:", error);
    process.exit(1);
  });
