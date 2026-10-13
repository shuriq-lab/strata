import assert from "node:assert/strict";
import test from "node:test";
import { engagementContract } from "../lib/sample";
import { reconcile } from "../lib/reconcile";
import { setFrontmatterList } from "../lib/text";
import type { IncomingBatch, MemoryRecord } from "../lib/types";

function claim(partial: Partial<MemoryRecord> & Pick<MemoryRecord, "id" | "content" | "stance">): MemoryRecord {
  return {
    type: "claim",
    time: "2026-09-19T16:00:00Z",
    source_ids: [],
    agent: "evidence",
    status: "active",
    claim_key: "competitor.harbor.price",
    ...partial,
  };
}

function batch(partial: Partial<IncomingBatch> & Pick<IncomingBatch, "agent" | "records">): IncomingBatch {
  return {
    repo: `${partial.agent}-fork`,
    commit: "abc",
    compareOnly: false,
    files: [],
    ...partial,
  };
}

test("identical stance folds and unions source ids", () => {
  const base = [
    claim({
      id: "rec_base",
      content: "The price is not established.",
      stance: "unknown",
      agent: "intake",
      source_ids: ["src_a"],
    }),
  ];
  const output = reconcile({
    contract: engagementContract(),
    baseRecords: base,
    baseFiles: new Map(),
    batches: [
      batch({
        agent: "evidence",
        records: [
          claim({
            id: "rec_echo",
            content: "Still no printed price.",
            stance: "unknown",
            source_ids: ["src_b"],
          }),
        ],
      }),
    ],
  });
  assert.equal(output.records.length, 1);
  assert.equal(output.records[0].id, "rec_base");
  assert.deepEqual(output.records[0].source_ids, ["src_a", "src_b"]);
  assert.deepEqual(output.records[0].merged_from, ["rec_echo"]);
  assert.equal(output.folds.length, 1);
  assert.equal(output.conflicts.length, 0);
  assert.equal(output.records.some((record) => record.id === "rec_echo"), false);
});

test("a different stance is kept and flagged with both provenances", () => {
  const base = [
    claim({
      id: "rec_unknown",
      content: "The price is not established.",
      stance: "unknown",
      agent: "intake",
      source_ids: ["msg_003"],
    }),
  ];
  const incoming = claim({
    id: "rec_listed",
    content: "Listed at 86 dollars.",
    stance: "listed_86",
    agent: "competitor",
    source_ids: ["rec_src_price_card"],
  });
  const output = reconcile({
    contract: engagementContract(),
    baseRecords: base,
    baseFiles: new Map(),
    batches: [batch({ agent: "competitor", records: [incoming] })],
  });
  assert.equal(output.records.length, 2);
  assert.equal(output.conflicts.length, 1);
  assert.equal(output.conflicts[0].claim_key, "competitor.harbor.price");
  assert.equal(output.conflicts[0].review, "open");
  const stances = output.conflicts[0].records.map((record) => record.stance).sort();
  assert.deepEqual(stances, ["listed_86", "unknown"]);
  assert.ok(output.records.every((record) => record.status === "contested"));
});

test("a divergent rewrite of the same id does not replace the base record", () => {
  const base = [claim({ id: "rec_same", content: "Original.", stance: "unknown", agent: "intake" })];
  const output = reconcile({
    contract: engagementContract(),
    baseRecords: base,
    baseFiles: new Map(),
    batches: [
      batch({
        agent: "competitor",
        records: [claim({ id: "rec_same", content: "Rewritten.", stance: "unknown", agent: "competitor" })],
      }),
    ],
  });
  assert.equal(output.records[0].content, "Original.");
  assert.equal(output.conflicts[0].reason, "divergent_record");
  assert.equal(output.conflicts[0].records[1].content, "Rewritten.");
});

test("a compare-only fork is reported and not merged", () => {
  const base = [
    claim({
      id: "rec_cut",
      content: "A price cut is out of scope.",
      stance: "out_of_scope",
      claim_key: "decision.price_cut",
      agent: "intake",
    }),
  ];
  const output = reconcile({
    contract: engagementContract(),
    baseRecords: base,
    baseFiles: new Map([["profile.md", "short\n"]]),
    batches: [
      batch({
        agent: "what-if",
        compareOnly: true,
        records: [
          claim({
            id: "rec_cut_yes",
            content: "Assume a cut.",
            stance: "recommended",
            claim_key: "decision.price_cut",
            agent: "what-if",
          }),
        ],
        files: [{ path: "profile.md", content: "taken over\n" }],
      }),
    ],
  });
  assert.equal(output.records.length, 1);
  assert.equal(output.records[0].status, "active");
  assert.equal(output.comparisons.length, 1);
  assert.equal(output.comparisons[0].reason, "conflicting_stance");
  assert.equal(output.files.some((file) => file.path === "profile.md"), false);
  assert.ok(output.refusals.some((refusal) => refusal.rule === "compare_only"));
});

test("two agents editing one track keep the previous prose", () => {
  const contract = engagementContract();
  const base = "---\nid: decision\ntitle: Decision\nrecord_ids:\n  - rec_a\n---\n\nOriginal prose.\n";
  const output = reconcile({
    contract,
    baseRecords: [],
    baseFiles: new Map([["tracks/decision.md", base]]),
    batches: [
      batch({
        agent: "section-writer",
        records: [],
        files: [{ path: "tracks/decision.md", content: base.replace("Original", "Ren") }],
      }),
      batch({
        agent: "intake",
        records: [],
        files: [{ path: "tracks/decision.md", content: base.replace("Original", "Iona") }],
      }),
    ],
  });
  assert.ok(output.refusals.some((refusal) => refusal.rule === "track_conflict"));
  const decision = output.files.find((file) => file.path === "tracks/decision.md");
  const prose = decision?.content ?? base;
  assert.match(prose, /Original prose/);
  assert.doesNotMatch(prose, /Ren|Iona/);
});

test("evidence may not promote the profile", () => {
  const output = reconcile({
    contract: engagementContract(),
    baseRecords: [],
    baseFiles: new Map([["profile.md", "---\ntitle: P\n---\n\nShort.\n"]]),
    batches: [
      batch({
        agent: "evidence",
        records: [],
        files: [{ path: "profile.md", content: "---\ntitle: P\n---\n\nReplaced.\n" }],
      }),
    ],
  });
  assert.equal(output.profileAction, "refused");
  assert.ok(output.refusals.some((refusal) => refusal.rule === "may_promote" && refusal.path === "profile.md"));
});

test("frontmatter record ids are replaced in place", () => {
  const input = "---\nid: category\ntitle: Category\nrecord_ids:\n  - old\n---\n\nBody stays.\n";
  const next = setFrontmatterList(input, "record_ids", ["rec_b", "rec_a"]);
  assert.match(next, /Body stays\./);
  assert.doesNotMatch(next, /old/);
  assert.match(next, /rec_a/);
  assert.match(next, /rec_b/);
});
