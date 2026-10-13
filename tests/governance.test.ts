import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { commitAsAgent } from "../lib/governance";
import { seedEngagement } from "../lib/demo";
import { pathAllowed } from "../lib/contract";
import { ENGAGEMENT_REPO } from "../lib/sample";
import { LocalStore } from "../lib/store/local";
import { StrataError } from "../lib/store/types";

test("path rules are prefixes or exact paths", () => {
  assert.equal(pathAllowed(["records/"], "records/claim.jsonl"), true);
  assert.equal(pathAllowed(["tracks/decision.md"], "tracks/decision.md"), true);
  assert.equal(pathAllowed(["tracks/decision.md"], "tracks/competitors.md"), false);
  assert.equal(pathAllowed(["records/claim.jsonl"], "records/instruction.jsonl"), false);
  assert.equal(pathAllowed([], "profile.md"), false);
});

test("commit enforcement refuses profile, raw edits, and instruction rewrites", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "strata-gov-"));
  try {
    const store = new LocalStore(root);
    const created = await store.create(ENGAGEMENT_REPO, { description: "governance" });
    await seedEngagement(store, created.name, created.token);
    const call = await store.readFile(created.name, { ref: "main", path: "raw/calls/call-001.json" }, created.token);
    assert.ok(call);
    const result = await commitAsAgent({
      store,
      repo: created.name,
      token: created.token,
      agentId: "section-writer",
      writes: [
        { path: "tracks/decision.md", content: "---\nid: decision\ntitle: Decision\nrecord_ids:\n---\n\nHeld.\n" },
        { path: "profile.md", content: `---\ntitle: P\n---\n\n${"x".repeat(2000)}\n` },
        {
          path: "raw/calls/call-001.json",
          content: new TextDecoder().decode(call.bytes).replace("Scannable", "Optional"),
        },
        { path: "records/instruction.jsonl", content: "{\"id\":\"rec_x\"}\n" },
      ],
      message: "Section attempt",
      author: { name: "Ren Sato", email: "ren.sato@northwind.example", date: "2026-09-19T16:00:00Z" },
    });
    assert.ok(result.commit);
    assert.deepEqual(result.committed.map((file) => file.path), ["tracks/decision.md"]);
    assert.deepEqual(
      result.violations.map((violation) => violation.path).sort(),
      ["profile.md", "raw/calls/call-001.json", "records/instruction.jsonl"],
    );
    const profile = await store.readFile(created.name, { ref: "main", path: "profile.md" }, created.token);
    assert.match(new TextDecoder().decode(profile?.bytes ?? new Uint8Array()), /Northwind Lanterns/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("append-only raw rejects a writer who is otherwise allowed to touch raw", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "strata-raw-"));
  try {
    const store = new LocalStore(root);
    const created = await store.create(ENGAGEMENT_REPO);
    await seedEngagement(store, created.name, created.token);
    const call = await store.readFile(created.name, { ref: "main", path: "raw/calls/call-001.json" }, created.token);
    const result = await commitAsAgent({
      store,
      repo: created.name,
      token: created.token,
      agentId: "intake",
      writes: [
        {
          path: "raw/calls/call-001.json",
          content: new TextDecoder().decode(call?.bytes ?? new Uint8Array()).replace("Scannable", "Optional"),
        },
      ],
      message: "Rewrite the call",
      author: { name: "Iona Blake", email: "iona.blake@northwind.example", date: "2026-09-19T16:00:00Z" },
    });
    assert.equal(result.commit, null);
    assert.equal(result.violations[0].rule, "append_only");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("profile budget binds the reconciler", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "strata-budget-"));
  try {
    const store = new LocalStore(root);
    const created = await store.create(ENGAGEMENT_REPO);
    await seedEngagement(store, created.name, created.token);
    const result = await commitAsAgent({
      store,
      repo: created.name,
      token: created.token,
      agentId: "reconciler",
      writes: [{ path: "profile.md", content: `---\ntitle: P\n---\n\n${"word ".repeat(400)}\n` }],
      message: "Profile too long",
      author: { name: "Strata Reconciler", email: "reconciler@strata.localhost", date: "2026-09-19T17:00:00Z" },
    });
    assert.equal(result.commit, null);
    assert.equal(result.violations[0].rule, "profile_budget");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tokens are repo scoped and a read token cannot commit", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "strata-token-"));
  try {
    const store = new LocalStore(root);
    const created = await store.create(ENGAGEMENT_REPO);
    await seedEngagement(store, created.name, created.token);
    const other = await store.create("other-repo");
    const read = await store.createToken(created.name, "read", 3600);
    const file = await store.readFile(created.name, { ref: "main", path: "contract.json" }, read.plaintext);
    assert.ok(file && file.bytes.byteLength > 0);
    await assert.rejects(
      () =>
        store.commit(created.name, read.plaintext, {
          message: "nope",
          author: { name: "X", email: "x@example.com", date: "2026-09-19T16:00:00Z" },
          files: [{ path: "note.txt", content: "no\n" }],
        }),
      (error: unknown) => error instanceof StrataError && error.code === "insufficient_permissions",
    );
    await assert.rejects(
      () => store.readFile(other.name, { ref: "main", path: "contract.json" }, read.plaintext),
      (error: unknown) => error instanceof StrataError && error.code === "wrong_repo",
    );
    await store.revokeToken(created.name, read.id);
    await assert.rejects(
      () => store.readFile(created.name, { ref: "main", path: "contract.json" }, read.plaintext),
      (error: unknown) => error instanceof StrataError && error.code === "token_revoked",
    );
    const expired = await store.createToken(created.name, "read", -10);
    await assert.rejects(
      () => store.readFile(created.name, { ref: "main", path: "contract.json" }, expired.plaintext),
      (error: unknown) => error instanceof StrataError && error.code === "token_expired",
    );
    const history = await store.log(created.name, { limit: 10 }, created.token);
    assert.equal(history.length, 5);
    assert.equal(history[0].parents.length, 1);
    assert.equal(history[4].parents.length, 0);
    const tree = await store.readTree(created.name, history[0].tree, created.token);
    assert.ok(tree?.some((entry) => entry.name === "profile.md" && entry.type === "blob"));
    const fork = await store.fork(created.name, "northwind-dusk--evidence");
    const forkLog = await store.log(fork.name, { limit: 10 }, fork.token);
    assert.equal(forkLog.length, 5);
    assert.notEqual(fork.name, created.name);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
