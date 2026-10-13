import { rm } from "node:fs/promises";
import { seedEngagement } from "../lib/demo";
import { ENGAGEMENT_REPO } from "../lib/sample";
import { driverFromEnv, openStore } from "../lib/store/open";
import path from "node:path";

const driver = driverFromEnv();
const root = path.join(process.cwd(), ".demo");
if (driver === "local") await rm(root, { recursive: true, force: true });
const store = openStore(driver, root);
if (driver === "cloudflare") {
  try {
    await store.delete(ENGAGEMENT_REPO);
  } catch {
    // A missing repo is fine.
  }
}
const created = await store.create(ENGAGEMENT_REPO, {
  description: "Northwind Lanterns dusk-sensor engagement (synthetic)",
});
const commits = await seedEngagement(store, created.name, created.token);
console.log(`Seeded ${created.name} (${driver})`);
console.log(created.remote);
for (const commit of commits) console.log(`${commit.layer}\t${commit.hash.slice(0, 8)}\t${commit.message}`);
console.log("The create token was a write token. It is not printed.");
