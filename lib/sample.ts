import { createHash } from "node:crypto";
import { toJsonl } from "./jsonl";
import type { Contract, MemoryRecord } from "./types";

export const ENGAGEMENT_REPO = "northwind-dusk";
export const PROFILE_BUDGET = 900;

export const IDS = {
  msgFold: "msg_001",
  msgLead: "msg_002",
  msgHarbor: "msg_003",
  msgNoCut: "msg_004",
  msgSources: "msg_005",
  msgKeep: "msg_006",
  srcHarbor: "src_harbor_sheet",
  srcMargin: "src_margin_memo",
  recSrcHarbor: "rec_src_harbor_sheet",
  recSrcMargin: "rec_src_margin_memo",
  recEvHarbor: "rec_ev_harbor_sheet",
  recInsPage: "rec_ins_one_page",
  recInsNoCut: "rec_ins_no_price_cut",
  recPrefLead: "rec_pref_lead_with_decision",
  recClaimDusk: "rec_claim_harbor_dusk",
  recClaimPrice: "rec_claim_harbor_price",
  recClaimCut: "rec_claim_price_cut",
  recEvtIntake: "rec_evt_intake",
  recSrcWeekly: "rec_src_lantern_weekly",
  recEvDemand: "rec_ev_sensor_demand",
  recClaimDemand: "rec_claim_sensor_demand",
  recClaimPriceEcho: "rec_claim_harbor_price_echo",
  recSrcPriceCard: "rec_src_harbor_price_card",
  recEvPriceCard: "rec_ev_harbor_price_card",
  recClaimPrice86: "rec_claim_harbor_price_86",
  recClaimDuskEcho: "rec_claim_harbor_dusk_echo",
  recEvtDecision: "rec_evt_decision_drafted",
  recClaimCutRecommended: "rec_claim_price_cut_recommended",
} as const;

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const HARBOR_EXCERPT =
  "Harbor & Co. spring market sheet (synthetic). Dusk lantern with a sensor. Price to be announced.";
const MARGIN_EXCERPT =
  "Northwind margin note, March 2026 (synthetic). The spring price cut on the core lantern is unresolved. No reading supports a dusk-line cut.";

export function engagementContract(): Contract {
  return {
    contract_version: "1",
    kind: "engagement-pyramid",
    purpose:
      "Governed memory for one client engagement. Agents read through the navigator and write only the layers named here. The reconciler merges records, not lines.",
    client: {
      name: "Northwind Lanterns",
      engagement: "dusk-sensor-brief",
      note: "Synthetic client invented for this demo. No real customer data.",
    },
    layers: {
      L0: {
        path: "raw/",
        append_only: true,
        description: "Intake, call transcripts, and source refs addressed by hash.",
      },
      L1: {
        path: "records/",
        format: "jsonl",
        types: ["claim", "source", "evidence", "instruction", "preference", "event"],
      },
      L2: { path: "tracks/", format: "markdown" },
      L3: { path: "profile.md", format: "markdown", max_chars: PROFILE_BUDGET },
    },
    agents: [
      {
        id: "intake",
        label: "Intake",
        may_write: ["raw/", "records/", "tracks/", "profile.md", "contract.json"],
        may_promote: ["raw/", "records/", "tracks/", "profile.md"],
      },
      {
        id: "evidence",
        label: "Evidence lane",
        may_write: [
          "records/source.jsonl",
          "records/evidence.jsonl",
          "records/claim.jsonl",
          "records/event.jsonl",
        ],
        may_promote: [
          "records/source.jsonl",
          "records/evidence.jsonl",
          "records/claim.jsonl",
          "records/event.jsonl",
        ],
      },
      {
        id: "competitor",
        label: "Competitor lane",
        may_write: [
          "records/source.jsonl",
          "records/evidence.jsonl",
          "records/claim.jsonl",
          "records/event.jsonl",
        ],
        may_promote: [
          "records/source.jsonl",
          "records/evidence.jsonl",
          "records/claim.jsonl",
          "records/event.jsonl",
        ],
      },
      {
        id: "section-writer",
        label: "Decision section",
        may_write: ["tracks/decision.md", "records/event.jsonl"],
        may_promote: ["tracks/decision.md", "records/event.jsonl"],
      },
      {
        id: "what-if",
        label: "What-if: price cut",
        compare_only: true,
        may_write: ["records/claim.jsonl", "records/event.jsonl"],
        may_promote: [],
      },
      {
        id: "reconciler",
        label: "Record reconciler",
        may_write: ["records/", "tracks/", "profile.md", "reconcile/"],
        may_promote: ["records/", "tracks/", "profile.md", "reconcile/"],
      },
    ],
    rules: [
      "A path is writable only when it matches an agent's may_write rule.",
      "raw/ is append-only. Existing bytes cannot change and files cannot be removed.",
      "profile.md body must stay within layers.L3.max_chars.",
      "Agents marked compare_only are never promoted into the engagement.",
      "Claims that share a claim_key and differ in stance are both kept and flagged for review.",
      "Claims that share a claim_key and a stance fold together. Source ids are unioned.",
    ],
  };
}

function md(front: string, body: string): string {
  return `---\n${front.trim()}\n---\n\n${body.trim()}\n`;
}

export interface LayerFiles {
  layer: "contract" | "L0" | "L1" | "L2" | "L3";
  message: string;
  files: Record<string, string>;
}

export function seedLayers(): LayerFiles[] {
  const harborHash = sha256(HARBOR_EXCERPT);
  const marginHash = sha256(MARGIN_EXCERPT);

  const contract = `${JSON.stringify(engagementContract(), null, 2)}\n`;

  const call = {
    id: "call_001",
    title: "Intake call, Northwind Lanterns",
    time: "2026-09-18T15:00:00Z",
    messages: [
      {
        id: IDS.msgFold,
        speaker: "Mara Ellison",
        role: "client",
        kind: "look",
        time: "2026-09-18T15:01:00Z",
        text: "One page. Scannable. The board will not read past the fold.",
      },
      {
        id: IDS.msgLead,
        speaker: "Mara Ellison",
        role: "client",
        kind: "say",
        time: "2026-09-18T15:02:00Z",
        text: "Tell us whether to build the dusk-sensor line this season. Lead with the decision.",
      },
      {
        id: IDS.msgHarbor,
        speaker: "Mara Ellison",
        role: "client",
        kind: "fact",
        time: "2026-09-18T15:04:00Z",
        text: "Harbor and Co. showed a dusk lantern at the spring market. I do not know the price.",
      },
      {
        id: IDS.msgNoCut,
        speaker: "Mara Ellison",
        role: "client",
        kind: "decision",
        time: "2026-09-18T15:06:00Z",
        text: "Do not recommend a price cut. We cut the core lantern in the spring and the margin note is still open.",
      },
      {
        id: IDS.msgSources,
        speaker: "Mara Ellison",
        role: "client",
        kind: "preference",
        time: "2026-09-18T15:07:00Z",
        text: "Name the source on every number. No category jargon in the brief.",
      },
      {
        id: IDS.msgKeep,
        speaker: "Iona Blake",
        role: "analyst",
        kind: "note",
        time: "2026-09-18T15:09:00Z",
        text: "We will keep the instruction on the record, so a later draft cannot drop it.",
      },
    ],
  };

  const brief = {
    id: "brief_001",
    client: "Northwind Lanterns",
    engagement: "dusk-sensor-brief",
    time: "2026-09-18T15:00:00Z",
    goal: "One scannable page on whether to build a dusk-sensor lantern this season.",
    synthetic: true,
  };

  const records: MemoryRecord[] = [
    {
      id: IDS.recSrcHarbor,
      type: "source",
      title: "Harbor & Co. spring market sheet",
      content: HARBOR_EXCERPT,
      time: "2026-03-12",
      source_ids: [IDS.srcHarbor],
      agent: "intake",
      status: "active",
      content_sha256: harborHash,
      locator: "synthetic://northwind/2026-03-12/src_harbor_sheet.txt",
      track: "competitors",
    },
    {
      id: IDS.recSrcMargin,
      type: "source",
      title: "Northwind margin note",
      content: MARGIN_EXCERPT,
      time: "2026-03-20",
      source_ids: [IDS.srcMargin],
      agent: "intake",
      status: "active",
      content_sha256: marginHash,
      locator: "synthetic://northwind/2026-03-20/src_margin_memo.txt",
      track: "decision",
    },
    {
      id: IDS.recEvHarbor,
      type: "evidence",
      content: "The spring market sheet names a dusk lantern and does not list a price.",
      time: "2026-09-18T15:20:00Z",
      source_ids: [IDS.recSrcHarbor, IDS.msgHarbor],
      message_ids: [IDS.msgHarbor],
      agent: "intake",
      status: "active",
      track: "competitors",
    },
    {
      id: IDS.recInsPage,
      type: "instruction",
      content: "The report is one scannable page. The board will not read past the fold.",
      time: "2026-09-18T15:21:00Z",
      source_ids: [IDS.msgFold],
      message_ids: [IDS.msgFold],
      agent: "intake",
      status: "active",
      track: "decision",
    },
    {
      id: IDS.recInsNoCut,
      type: "instruction",
      content: "The report must not recommend a price cut.",
      time: "2026-09-18T15:22:00Z",
      source_ids: [IDS.msgNoCut],
      message_ids: [IDS.msgNoCut],
      agent: "intake",
      status: "active",
      track: "decision",
    },
    {
      id: IDS.recPrefLead,
      type: "preference",
      content: "Lead with the decision, and name the source on every number.",
      time: "2026-09-18T15:23:00Z",
      source_ids: [IDS.msgLead, IDS.msgSources],
      message_ids: [IDS.msgLead, IDS.msgSources],
      agent: "intake",
      status: "active",
      track: "decision",
    },
    {
      id: IDS.recClaimDusk,
      type: "claim",
      content: "Harbor & Co. exhibited a dusk lantern at the spring market.",
      time: "2026-09-18T15:24:00Z",
      source_ids: [IDS.recSrcHarbor, IDS.msgHarbor],
      message_ids: [IDS.msgHarbor],
      claim_key: "competitor.harbor.dusk",
      stance: "exhibited",
      agent: "intake",
      status: "active",
      track: "competitors",
    },
    {
      id: IDS.recClaimPrice,
      type: "claim",
      content: "Harbor & Co.'s price for the dusk lantern is not established.",
      time: "2026-09-18T15:25:00Z",
      source_ids: [IDS.recSrcHarbor, IDS.msgHarbor],
      message_ids: [IDS.msgHarbor],
      claim_key: "competitor.harbor.price",
      stance: "unknown",
      agent: "intake",
      status: "active",
      track: "competitors",
    },
    {
      id: IDS.recClaimCut,
      type: "claim",
      content: "A price cut is out of scope while the spring margin note is open.",
      time: "2026-09-18T15:26:00Z",
      source_ids: [IDS.recInsNoCut, IDS.recSrcMargin, IDS.msgNoCut],
      message_ids: [IDS.msgNoCut],
      claim_key: "decision.price_cut",
      stance: "out_of_scope",
      agent: "intake",
      status: "active",
      track: "decision",
    },
    {
      id: IDS.recEvtIntake,
      type: "event",
      content: "Intake call recorded and split into instruction, preference, source, and claim records.",
      time: "2026-09-18T15:30:00Z",
      source_ids: [IDS.msgKeep],
      message_ids: [IDS.msgKeep],
      agent: "intake",
      status: "active",
      track: "decision",
    },
  ];

  const byType = (type: MemoryRecord["type"]) => records.filter((record) => record.type === type);

  const decisionIds = [
    IDS.recInsPage,
    IDS.recInsNoCut,
    IDS.recPrefLead,
    IDS.recClaimCut,
    IDS.recSrcMargin,
    IDS.recEvtIntake,
  ];
  const competitorIds = [IDS.recSrcHarbor, IDS.recEvHarbor, IDS.recClaimDusk, IDS.recClaimPrice];
  const categoryIds: string[] = [];

  const profile = md(
    `okf_version: "0.1"
layer: L3
id: profile
title: Northwind Lanterns
client: Northwind Lanterns
engagement: dusk-sensor-brief
updated: 2026-09-18
length_budget: ${PROFILE_BUDGET}
record_ids:
${[IDS.recInsPage, IDS.recInsNoCut, IDS.recPrefLead].map((id) => `  - ${id}`).join("\n")}`,
    `Northwind Lanterns makes outdoor lanterns. Mara Ellison wants one decision on a dusk-sensor line for this season.

The brief is one scannable page. It leads with the decision and names a source on every number. A price cut is out of scope while the spring margin note is open.

Harbor & Co. showed a dusk lantern at the spring market. No price is established yet.`,
  );

  return [
    {
      layer: "contract",
      message: "Contract: who may write which layer",
      files: { "contract.json": contract },
    },
    {
      layer: "L0",
      message: "L0 raw: intake, call, source refs",
      files: {
        "raw/intake/brief.json": `${JSON.stringify(brief, null, 2)}\n`,
        "raw/calls/call-001.json": `${JSON.stringify(call, null, 2)}\n`,
        "raw/sources/src_harbor_sheet.json": `${JSON.stringify(
          {
            id: IDS.srcHarbor,
            title: "Harbor & Co. spring market sheet",
            sha256: harborHash,
            locator: "synthetic://northwind/2026-03-12/src_harbor_sheet.txt",
            excerpt: HARBOR_EXCERPT,
            time: "2026-03-12",
          },
          null,
          2,
        )}\n`,
        "raw/sources/src_margin_memo.json": `${JSON.stringify(
          {
            id: IDS.srcMargin,
            title: "Northwind margin note",
            sha256: marginHash,
            locator: "synthetic://northwind/2026-03-20/src_margin_memo.txt",
            excerpt: MARGIN_EXCERPT,
            time: "2026-03-20",
          },
          null,
          2,
        )}\n`,
      },
    },
    {
      layer: "L1",
      message: "L1 records: claims, sources, evidence, instructions, preferences",
      files: {
        "records/source.jsonl": toJsonl(byType("source")),
        "records/evidence.jsonl": toJsonl(byType("evidence")),
        "records/instruction.jsonl": toJsonl(byType("instruction")),
        "records/preference.jsonl": toJsonl(byType("preference")),
        "records/claim.jsonl": toJsonl(byType("claim")),
        "records/event.jsonl": toJsonl(byType("event")),
      },
    },
    {
      layer: "L2",
      message: "L2 tracks: decision, competitors, category",
      files: {
        "tracks/decision.md": md(
          `okf_version: "0.1"
layer: L2
id: decision
title: Decision
updated: 2026-09-18
record_ids:
${decisionIds.map((id) => `  - ${id}`).join("\n")}`,
          `The decision is whether to build a dusk-sensor lantern this season. The page is one screen. A price cut is out of scope until the spring margin note is closed.

Harbor & Co. exhibited a dusk lantern. Its price is not established from the sources intake brought in.`,
        ),
        "tracks/competitors.md": md(
          `okf_version: "0.1"
layer: L2
id: competitors
title: Competitors
updated: 2026-09-18
record_ids:
${competitorIds.map((id) => `  - ${id}`).join("\n")}`,
          `Harbor & Co. is the only competitor named on the intake call. The spring market sheet records a dusk lantern and does not list a price.`,
        ),
        "tracks/category.md": md(
          `okf_version: "0.1"
layer: L2
id: category
title: Category
updated: 2026-09-18
record_ids:`,
          `No category numbers were in the intake. A research lane may add a source. Until then this track states no growth figure.`,
        ),
      },
    },
    {
      layer: "L3",
      message: "L3 profile: Northwind Lanterns",
      files: { "profile.md": profile },
    },
  ];
}

export function weeklyExcerpt(): string {
  return "Lantern Weekly, September 2026 (synthetic). In a five-shop sample, sensor lanterns were the only outdoor category the shops called rising. No Harbor price was printed.";
}

export function priceCardExcerpt(): string {
  return "Harbor & Co. spring price card (synthetic). Dusk lantern, sensor, 86 dollars.";
}
