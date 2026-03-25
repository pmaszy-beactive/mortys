import { db } from "./db";
import { schoolPermits, permitNumbers } from "@shared/schema";

const permitData = [
  {
    permitCode: "L-020",
    location: "Montreal: Automobile",
    courseTypes: JSON.stringify(["auto"]),
    startNumber: 100001,
    endNumber: 100050,
    totalNumbers: 50,
    availableNumbers: 50,
    isActive: true,
  },
  {
    permitCode: "M-015",
    location: "Montreal: Motorcycle",
    courseTypes: JSON.stringify(["moto"]),
    startNumber: 200001,
    endNumber: 200025,
    totalNumbers: 25,
    availableNumbers: 25,
    isActive: true,
  },
  {
    permitCode: "S-008",
    location: "Montreal: Scooter",
    courseTypes: JSON.stringify(["scooter"]),
    startNumber: 300001,
    endNumber: 300020,
    totalNumbers: 20,
    availableNumbers: 20,
    isActive: true,
  },
];

export async function seedPermits() {
  console.log("Seeding school permits...");
  
  try {
    // Create permits
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
      
      await db.insert(permitNumbers).values(numbers);
      console.log(`Created ${numbers.length} permit numbers for ${permit.permitCode}`);
    }
    
    console.log("School permits seeded successfully!");
  } catch (error) {
    console.error("Error seeding school permits:", error);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedPermits().then(() => process.exit(0));
}