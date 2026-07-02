import { seedDemoAccounts } from "../seed-demo-accounts";

/**
 * Standalone demo-account seeder run by docker-entrypoint.sh on every deploy.
 * Ensures the demo instructor and demo student logins always exist in the
 * production database, independent of the main initializeDatabase() flow.
 */
async function main() {
  console.log("[seed-demo] Seeding demo accounts...");
  await seedDemoAccounts();
  console.log("[seed-demo] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-demo] Fatal error:", err);
  process.exit(1);
});
