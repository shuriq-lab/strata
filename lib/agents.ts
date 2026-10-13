import { parseJsonl, toJsonl } from "./jsonl";
import { Navigator } from "./navigator";
import { IDS, priceCardExcerpt, sha256, weeklyExcerpt } from "./sample";
import type { MemoryRecord, ToolTrace } from "./types";

export interface AgentSpec {
  id: "evidence" | "competitor" | "section-writer" | "what-if";
  label: string;
  person: string;
  email: string;
  compareOnly: boolean;
  message: string;
  note: string;
}

export interface PlannedWrite {
  path: string;
  content: string;
}

export interface AgentPlan {
  writes: PlannedWrite[];
  addedRecordIds: string[];
  trace: ToolTrace[];
}

export const AGENT_SPECS: AgentSpec[] = [
  {
    id: "evidence",
    label: "Evidence lane",
    person: "Ada Voss",
    email: "ada.voss@northwind.example",
    compareOnly: false,
    message: "Evidence lane: Lantern Weekly sample and a demand claim",
    note: "Adds a category source. Restates the unknown Harbor price, which folds into the intake claim.",
  },
  {
    id: "competitor",
    label: "Competitor lane",
    person: "Jules Park",
    email: "jules.park@northwind.example",
    compareOnly: false,
    message: "Competitor lane: Harbor price card at 86 dollars",
    note: "A second Harbor source names a price. That claim conflicts with intake and stays open for review.",
  },
  {
    id: "section-writer",
    label: "Decision section",
    person: "Ren Sato",
    email: "ren.sato@northwind.example",
    compareOnly: false,
    message: "Decision section: track updated from the instruction records",
    note: "May write the decision track. The contract refuses a profile rewrite, a raw edit, and an instruction edit.",
  },
  {
    id: "what-if",
    label: "What-if: price cut",
    person: "Nia Cole",
    email: "nia.cole@northwind.example",
    compareOnly: true,
    message: "What-if fork: assume a 12 percent price cut",
    note: "Compared with the engagement and not merged. The price-cut instruction stays the record.",
  },
];

const WHEN = "2026-09-19T16:00:00Z";

export function planAgent(id: AgentSpec["id"], nav: Navigator, files: Map<string, string>): AgentPlan {
  switch (id) {
    case "evidence":
      return planEvidence(nav, files);
    case "competitor":
      return planCompetitor(nav, files);
    case "section-writer":
      return planSection(nav, files);
    case "what-if":
      return planWhatIf(nav, files);
  }
}

function planEvidence(nav: Navigator, files: Map<string, string>): AgentPlan {
  const trace: ToolTrace[] = [];
  const category = nav.readFiles({ paths: ["tracks/category.md"] });
  trace.push({
    tool: "read_files",
    args: { paths: ["tracks/category.md"] },
    summary: Array.isArray(category) ? "Category track has no growth figure yet." : category.error,
  });
  const harbor = nav.searchRecords({ query: "Harbor price", type: "claim", limit: 5 });
  trace.push({
    tool: "search_records",
    args: { query: "Harbor price", type: "claim" },
    summary: harbor.records.map((record) => record.id).join(", ") || "none",
  });
  const calls = nav.searchConversations({ query: "price", limit: 5 });
  trace.push({
    tool: "search_conversations",
    args: { query: "price" },
    summary: calls.messages.map((message) => message.id).join(", "),
  });

  const excerpt = weeklyExcerpt();
  const records: MemoryRecord[] = [
    {
      id: IDS.recSrcWeekly,
      type: "source",
      title: "Lantern Weekly, September 2026",
      content: excerpt,
      time: "2026-09-12",
      source_ids: [],
      agent: "evidence",
      status: "active",
      track: "category",
      content_sha256: sha256(excerpt),
      locator: "synthetic://northwind/2026-09-12/lantern-weekly.txt",
    },
    {
      id: IDS.recEvDemand,
      type: "evidence",
      content: "Five shops in the Lantern Weekly sample called sensor lanterns the category that was rising.",
      time: WHEN,
      source_ids: [IDS.recSrcWeekly],
      agent: "evidence",
      status: "active",
      track: "category",
    },
    {
      id: IDS.recClaimDemand,
      type: "claim",
      content: "Sensor lanterns are a rising category in the Lantern Weekly five-shop sample.",
      time: WHEN,
      source_ids: [IDS.recSrcWeekly, IDS.recEvDemand],
      claim_key: "category.sensor_demand",
      stance: "rising",
      agent: "evidence",
      status: "active",
      track: "category",
    },
    {
      id: IDS.recClaimPriceEcho,
      type: "claim",
      content: "Harbor & Co.'s dusk lantern still has no printed price in the Lantern Weekly sample.",
      time: WHEN,
      source_ids: [IDS.recSrcWeekly],
      claim_key: "competitor.harbor.price",
      stance: "unknown",
      agent: "evidence",
      status: "active",
      track: "competitors",
    },
  ];
  return {
    writes: writesFor(files, records),
    addedRecordIds: records.map((record) => record.id),
    trace,
  };
}

function planCompetitor(nav: Navigator, files: Map<string, string>): AgentPlan {
  const trace: ToolTrace[] = [];
  const harbor = nav.searchRecords({ query: "Harbor", limit: 5 });
  trace.push({
    tool: "search_records",
    args: { query: "Harbor" },
    summary: harbor.records.map((record) => `${record.id} (${record.type})`).join(", "),
  });
  const messages = nav.getConversations({ ids: [IDS.msgHarbor] });
  trace.push({
    tool: "get_conversations",
    args: { ids: [IDS.msgHarbor] },
    summary: messages.messages[0]?.text ?? "missing",
  });
  const source = nav.getRecords({ ids: [IDS.recSrcHarbor] });
  trace.push({
    tool: "get_records",
    args: { ids: [IDS.recSrcHarbor] },
    summary: source.records[0]?.content ?? "missing",
  });

  const excerpt = priceCardExcerpt();
  const records: MemoryRecord[] = [
    {
      id: IDS.recSrcPriceCard,
      type: "source",
      title: "Harbor & Co. spring price card",
      content: excerpt,
      time: "2026-03-12",
      source_ids: [],
      agent: "competitor",
      status: "active",
      track: "competitors",
      content_sha256: sha256(excerpt),
      locator: "synthetic://northwind/2026-03-12/harbor-price-card.txt",
    },
    {
      id: IDS.recEvPriceCard,
      type: "evidence",
      content: "The spring price card lists the dusk lantern at 86 dollars. The market sheet still says the price is to be announced.",
      time: WHEN,
      source_ids: [IDS.recSrcPriceCard, IDS.recSrcHarbor],
      agent: "competitor",
      status: "active",
      track: "competitors",
    },
    {
      id: IDS.recClaimPrice86,
      type: "claim",
      content: "Harbor & Co. listed the dusk lantern at 86 dollars on its spring price card.",
      time: WHEN,
      source_ids: [IDS.recSrcPriceCard, IDS.recEvPriceCard],
      claim_key: "competitor.harbor.price",
      stance: "listed_86",
      agent: "competitor",
      status: "active",
      track: "competitors",
    },
    {
      id: IDS.recClaimDuskEcho,
      type: "claim",
      content: "Harbor & Co. showed a sensor lantern at the spring market.",
      time: WHEN,
      source_ids: [IDS.recSrcHarbor, IDS.msgHarbor],
      message_ids: [IDS.msgHarbor],
      claim_key: "competitor.harbor.dusk",
      stance: "exhibited",
      agent: "competitor",
      status: "active",
      track: "competitors",
    },
  ];
  return {
    writes: writesFor(files, records),
    addedRecordIds: records.map((record) => record.id),
    trace,
  };
}

function planSection(nav: Navigator, files: Map<string, string>): AgentPlan {
  const trace: ToolTrace[] = [];
  const profile = nav.readFiles({ paths: ["profile.md"] });
  trace.push({
    tool: "read_files",
    args: { paths: ["profile.md"] },
    summary: Array.isArray(profile) ? `${profile[0].content.length} chars of profile` : profile.error,
  });
  const instructions = nav.searchRecords({ query: "must not recommend", type: "instruction", limit: 5 });
  trace.push({
    tool: "search_records",
    args: { query: "must not recommend", type: "instruction" },
    summary: instructions.records.map((record) => record.id).join(", "),
  });
  const ids = instructions.records.map((record) => record.id);
  const fetched = nav.getRecords({ ids });
  const messageIds = fetched.records.flatMap((record) => record.message_ids ?? []);
  const messages = nav.getConversations({ ids: messageIds });
  trace.push({
    tool: "get_conversations",
    args: { ids: messageIds },
    summary: messages.messages.map((message) => message.id).join(", "),
  });

  const event: MemoryRecord = {
    id: IDS.recEvtDecision,
    type: "event",
    content: "Decision track rewritten from the instruction records. The no-price-cut instruction was left in place.",
    time: WHEN,
    source_ids: [IDS.recInsNoCut, IDS.recInsPage],
    agent: "section-writer",
    status: "active",
    track: "decision",
  };

  const call = files.get("raw/calls/call-001.json") ?? "";
  const softened = call.replace("Do not recommend a price cut.", "A small price cut could be mentioned.");
  const bloatedProfile = `${files.get("profile.md") ?? ""}\n${"The board packet repeats the category background. ".repeat(40)}`;

  return {
    writes: [
      ...writesFor(files, [event]),
      { path: "tracks/decision.md", content: decisionTrack() },
      { path: "profile.md", content: bloatedProfile },
      { path: "raw/calls/call-001.json", content: softened },
      {
        path: "records/instruction.jsonl",
        content: toJsonl([
          ...parseJsonl(files.get("records/instruction.jsonl") ?? "", "records/instruction.jsonl").map((record) =>
            record.id === IDS.recInsNoCut
              ? { ...record, content: "A price cut may be recommended if the margin looks fine." }
              : record,
          ),
        ]),
      },
    ],
    addedRecordIds: [event.id],
    trace,
  };
}

function planWhatIf(nav: Navigator, files: Map<string, string>): AgentPlan {
  const trace: ToolTrace[] = [];
  const found = nav.searchRecords({ query: "price cut", type: "claim", limit: 5 });
  trace.push({
    tool: "search_records",
    args: { query: "price cut", type: "claim" },
    summary: found.records.map((record) => `${record.id} ${record.stance ?? ""}`).join(", "),
  });
  const messages = nav.getConversations({ ids: [IDS.msgNoCut] });
  trace.push({
    tool: "get_conversations",
    args: { ids: [IDS.msgNoCut] },
    summary: messages.messages[0]?.text ?? "missing",
  });
  const record: MemoryRecord = {
    id: IDS.recClaimCutRecommended,
    type: "claim",
    content: "Assumption, not a sourced finding: a 12 percent price cut on the dusk lantern still clears a margin floor.",
    time: WHEN,
    source_ids: [],
    claim_key: "decision.price_cut",
    stance: "recommended",
    agent: "what-if",
    status: "active",
    track: "decision",
  };
  return {
    writes: writesFor(files, [record]),
    addedRecordIds: [record.id],
    trace,
  };
}

function writesFor(files: Map<string, string>, records: MemoryRecord[]): PlannedWrite[] {
  const grouped = new Map<string, MemoryRecord[]>();
  for (const record of records) {
    const path = `records/${record.type}.jsonl`;
    const list = grouped.get(path) ?? parseJsonl(files.get(path) ?? "", path);
    list.push(record);
    grouped.set(path, list);
  }
  return [...grouped.entries()].map(([filePath, list]) => ({ path: filePath, content: toJsonl(list) }));
}

function decisionTrack(): string {
  return `---
okf_version: "0.1"
layer: L2
id: decision
title: Decision
updated: 2026-09-19
record_ids:
  - ${IDS.recInsPage}
  - ${IDS.recInsNoCut}
  - ${IDS.recPrefLead}
  - ${IDS.recClaimCut}
---

Build decision, held to the intake instructions.

The page stays one screen (${IDS.recInsPage}). It leads with the decision and names a source on every number (${IDS.recPrefLead}). It must not recommend a price cut (${IDS.recInsNoCut}). That instruction stays on the record. This section does not rewrite it.

A price cut stays out of scope while the spring margin note is open (${IDS.recClaimCut}).
`;
}
