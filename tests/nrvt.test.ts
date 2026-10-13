import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { formatNrvt, runNrvt } from "../lib/nrvt";

test("nrvt-storm-week runs end to end on the local driver", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "strata-nrvt-"));
  try {
    const s = await runNrvt({ root, driver: "local" });
    assert.equal(s.forks.length, 6);
    assert.ok(s.overlap);
    const r4 = s.conflicts.find((c) => c.id === "cf-R4");
    assert.deepEqual(r4?.claims.map((c) => c.id).sort(), ["clm-rdg-r4-flooded", "clm-rfd-r4-passable"]);
    assert.ok(s.agents.find((a) => a.id === "wilton")?.violations.some((v) => v.path === "records/redding/claims.jsonl"));
    assert.equal(s.comparison.merged, false);
    assert.ok(!s.promoted.some((p) => p.startsWith("whatif/")));
    assert.ok(s.receipt.read_ok && s.receipt.refused);
    assert.ok(s.decision.cites.includes("clm-nwk-hours-2100"));
    assert.ok(s.decision.allocations.reduce((n, a) => n + a.usd, 0) <= s.decision.budget_usd);
    assert.ok(s.provenance.every((p) => p.sha256.length === 64));
    assert.match(s.summary, /dec-storm-0918-01/);
    assert.match(formatNrvt(s), /Illustrative/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
