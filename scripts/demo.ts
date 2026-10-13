import { defaultRoot, driverFromEnv, runDemo } from "../lib/demo";
import { formatReport } from "../lib/report";

const llm = process.argv.includes("--llm");
if (llm && !process.env.OPENAI_API_KEY) {
  console.log("LLM mode requested, but OPENAI_API_KEY is unset. Scripted answers stand.");
}

const snapshot = await runDemo({
  root: defaultRoot(),
  driver: driverFromEnv(),
  llm,
});

if (llm && process.env.OPENAI_API_KEY && !snapshot.narration) {
  console.log("LLM narration did not return text. Scripted answers stand.");
}

console.log(formatReport(snapshot));
console.log("");
console.log("Snapshot  .demo/snapshot.json");
console.log("Next      npm run dev   →  http://127.0.0.1:43123");
