import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runDemo } from "../lib/demo";
import { IDS } from "../lib/sample";

test("four agents fork concurrently and reconcile at the record layer", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "strata-demo-"));
  try {
    const snapshot = await runDemo({ root, driver: "local" });
    assert.equal(snapshot.mocked, true);
    assert.equal(snapshot.agents.length, 4);
    assert.equal(snapshot.concurrency.overlap, true);
    assert.equal(snapshot.pyramid.records.some((record) => record.id === IDS.recClaimPrice86), true);
    assert.equal(snapshot.pyramid.records.some((record) => record.id === IDS.recClaimCutRecommended), false);
    assert.ok(snapshot.provenance.some((trail) => trail.record_id === IDS.recClaimPrice86));
    const unknown = snapshot.pyramid.records.find((record) => record.id === IDS.recClaimPrice);
    assert.ok(unknown?.merged_from?.includes(IDS.recClaimPriceEcho));
    assert.ok(unknown?.source_ids.includes(IDS.recSrcWeekly));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
