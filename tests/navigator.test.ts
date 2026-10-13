import assert from "node:assert/strict";
import test from "node:test";
import { handleMcp, TOOLS } from "../lib/mcp";
import { Navigator } from "../lib/navigator";
import { parsePyramid } from "../lib/pyramid";
import { answerQuestions } from "../lib/questions";
import { IDS, seedLayers } from "../lib/sample";
import { listFilesFromBinding, type ArtifactsRepoHandle } from "../lib/store/binding";
import { artifactTokenSecret, artifactsBaseUrl } from "../lib/store/cloudflare";

function seededPyramid() {
  const files = new Map<string, string>();
  for (const layer of seedLayers()) {
    for (const [filePath, content] of Object.entries(layer.files)) files.set(filePath, content);
  }
  return parsePyramid(files);
}

test("three navigation routes answer with citations", () => {
  const nav = new Navigator(seededPyramid());
  const questions = answerQuestions(nav);
  assert.equal(questions.length, 3);
  assert.equal(questions[0].route, "top-down");
  assert.match(questions[0].answer, /must not recommend a price cut/);
  assert.ok(questions[0].citations.includes(IDS.recInsNoCut));
  assert.ok(questions[0].citations.includes(IDS.msgNoCut));
  assert.match(questions[1].answer, /Scannable/);
  assert.deepEqual(questions[1].citations, [IDS.msgFold]);
  assert.ok(questions[2].citations.includes(IDS.recClaimDusk));
  assert.ok(questions[2].citations.includes(IDS.recClaimPrice));
});

test("read_files refuses record files and search stays at the top five", () => {
  const nav = new Navigator(seededPyramid());
  const refused = nav.readFiles({ paths: ["records/claim.jsonl"] });
  assert.ok("error" in refused);
  const found = nav.searchRecords({ query: "Harbor", limit: 5 });
  assert.ok(found.records.length <= 5);
  assert.ok(found.records.every((record) => /harbor/i.test(`${record.content} ${record.title ?? ""}`)));
  const exact = nav.getRecords({ ids: [IDS.recInsPage, "missing"] });
  assert.equal(exact.records.length, 1);
  assert.deepEqual(exact.missing, ["missing"]);
});

test("MCP lists the five NapMem tools and calls search_records", () => {
  assert.deepEqual(
    TOOLS.map((tool) => tool.name),
    ["read_files", "get_records", "search_records", "get_conversations", "search_conversations"],
  );
  const nav = new Navigator(seededPyramid());
  const listed = handleMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, nav) as {
    result: { tools: { name: string }[] };
  };
  assert.equal(listed.result.tools.length, 5);
  const called = handleMcp(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "search_records", arguments: { query: "must not", type: "instruction" } },
    },
    nav,
  ) as { result: { content: { text: string }[]; isError: boolean } };
  assert.equal(called.result.isError, false);
  assert.match(called.result.content[0].text, /rec_ins_no_price_cut/);
  assert.equal(handleMcp({ method: "notifications/initialized" }, nav), null);
});

test("binding walker reads a tree the way the Workers binding does", async () => {
  const files = new Map<string, string>([
    ["profile.md", "---\ntitle: P\n---\n\nHi\n"],
    ["records/claim.jsonl", "{\"id\":\"rec_a\",\"type\":\"claim\",\"content\":\"C\",\"time\":\"t\",\"source_ids\":[],\"agent\":\"intake\"}\n"],
  ]);
  // The walker needs a full pyramid, so include the contract and a track.
  files.set("contract.json", JSON.stringify(seededPyramid().contract));
  files.set("tracks/decision.md", "---\nid: decision\ntitle: Decision\nrecord_ids:\n---\n\nD\n");
  const repo = fakeRepo(files);
  const loaded = await listFilesFromBinding(repo, "main");
  assert.equal(loaded.get("profile.md")?.includes("Hi"), true);
  assert.equal(loaded.get("records/claim.jsonl")?.includes("rec_a"), true);
});

test("Cloudflare adapter URL and token secret match the docs", () => {
  assert.equal(
    artifactsBaseUrl("account", "default"),
    "https://api.cloudflare.com/client/v4/accounts/account/artifacts/namespaces/default",
  );
  assert.equal(
    artifactTokenSecret("art_v1_0123456789abcdef?expires=1760000000"),
    "art_v1_0123456789abcdef",
  );
});

function fakeRepo(files: Map<string, string>): ArtifactsRepoHandle {
  return {
    async info() {
      return {};
    },
    async createToken() {
      return {};
    },
    async listTokens() {
      return { tokens: [] };
    },
    async revokeToken() {
      return {};
    },
    async fork() {
      return {};
    },
    async log() {
      return [{ hash: "c1", tree: "t-root", message: "tip" }];
    },
    async readCommit() {
      return { hash: "c1", tree: "t-root" };
    },
    async readTree(hash: string) {
      if (hash === "t-root") {
        return [
          { name: "profile.md", type: "blob", hash: "b-profile" },
          { name: "contract.json", type: "blob", hash: "b-contract" },
          { name: "tracks", type: "tree", hash: "t-tracks" },
          { name: "records", type: "tree", hash: "t-records" },
        ];
      }
      if (hash === "t-tracks") return [{ name: "decision.md", type: "blob", hash: "b-decision" }];
      if (hash === "t-records") return [{ name: "claim.jsonl", type: "blob", hash: "b-claim" }];
      return null;
    },
    async readBlob() {
      return null;
    },
    async readFile(args: { path: string }) {
      const text = files.get(args.path);
      return text === undefined ? null : new Blob([text]);
    },
  };
}
