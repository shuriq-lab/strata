import readline from "node:readline";
import { loadPyramid } from "../lib/load";
import { handleMcp } from "../lib/mcp";
import { Navigator } from "../lib/navigator";
import { ENGAGEMENT_REPO } from "../lib/sample";
import { driverFromEnv, openStore } from "../lib/store/open";
import path from "node:path";

const root = path.join(process.cwd(), ".demo");
const repo = process.env.STRATA_REPO ?? ENGAGEMENT_REPO;
const store = openStore(driverFromEnv(), root);
const token = process.env.STRATA_READ_TOKEN ?? (await store.createToken(repo, "read", 3600)).plaintext;
const pyramid = await loadPyramid(store, repo, token);
const navigator = new Navigator(pyramid);

const lines = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
for await (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  const response = handleMcp(JSON.parse(trimmed), navigator);
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
}
