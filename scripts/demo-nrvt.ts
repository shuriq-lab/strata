import path from "node:path";
import { formatNrvt, runNrvt } from "../lib/nrvt";
import { driverFromEnv } from "../lib/store/open";

const snapshot = await runNrvt({ root: path.join(process.cwd(), ".demo-nrvt"), driver: driverFromEnv() });
console.log(formatNrvt(snapshot));
console.log("");
console.log("Snapshot  .demo-nrvt/nrvt-snapshot.json");
