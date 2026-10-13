import { Navigator } from "./navigator";
import { IDS } from "./sample";
import type { QuestionResult, ToolTrace } from "./types";

/** Three fixed questions: top-down, bottom-up, and across tracks. */
export function answerQuestions(nav: Navigator): QuestionResult[] {
  return [topDown(nav), bottomUp(nav), crossTrack(nav)];
}

function topDown(nav: Navigator): QuestionResult {
  const trace: ToolTrace[] = [];
  const profile = nav.readFiles({ paths: ["profile.md"] });
  trace.push({
    tool: "read_files",
    args: { paths: ["profile.md"] },
    summary: Array.isArray(profile) ? "Profile says a price cut is out of scope." : profile.error,
  });
  const found = nav.searchRecords({ query: "must not recommend", type: "instruction", limit: 5 });
  trace.push({
    tool: "search_records",
    args: { query: "must not recommend", type: "instruction" },
    summary: found.records.map((record) => record.id).join(", "),
  });
  const record = found.records.find((item) => item.id === IDS.recInsNoCut) ?? found.records[0];
  const messages = nav.getConversations({ ids: record?.message_ids ?? [] });
  trace.push({
    tool: "get_conversations",
    args: { ids: record?.message_ids ?? [] },
    summary: messages.messages.map((message) => message.id).join(", "),
  });
  return {
    id: "q-top-down",
    route: "top-down",
    question: "What must the report not do?",
    answer: record
      ? `${record.content} Mara Ellison said so on the intake call.`
      : "No instruction record matched.",
    citations: [record?.id, ...(record?.message_ids ?? [])].filter((id): id is string => Boolean(id)),
    trace,
  };
}

function bottomUp(nav: Navigator): QuestionResult {
  const trace: ToolTrace[] = [];
  const found = nav.searchConversations({ query: "scannable", limit: 5 });
  trace.push({
    tool: "search_conversations",
    args: { query: "scannable" },
    summary: found.messages.map((message) => message.id).join(", "),
  });
  const message = found.messages.find((item) => item.id === IDS.msgFold) ?? found.messages[0];
  const fetched = nav.getConversations({ ids: message ? [message.id] : [] });
  trace.push({
    tool: "get_conversations",
    args: { ids: message ? [message.id] : [] },
    summary: fetched.messages[0]?.text ?? "missing",
  });
  return {
    id: "q-bottom-up",
    route: "bottom-up",
    question: "What did Mara say about the page?",
    answer: message ? `${message.speaker}: “${message.text}”` : "No matching line.",
    citations: message ? [message.id] : [],
    trace,
  };
}

function crossTrack(nav: Navigator): QuestionResult {
  const trace: ToolTrace[] = [];
  const found = nav.searchRecords({ query: "Harbor", limit: 5 });
  trace.push({
    tool: "search_records",
    args: { query: "Harbor" },
    summary: found.records.map((record) => `${record.id} → ${record.track ?? "no track"}`).join(", "),
  });
  const decision = nav.readFiles({ paths: ["tracks/decision.md", "tracks/competitors.md"] });
  trace.push({
    tool: "read_files",
    args: { paths: ["tracks/decision.md", "tracks/competitors.md"] },
    summary: Array.isArray(decision) ? "Harbor is named on both the decision track and the competitor track." : decision.error,
  });
  const ids = found.records.map((record) => record.id);
  return {
    id: "q-cross-track",
    route: "cross-track",
    question: "Where does Harbor show up?",
    answer:
      "Harbor & Co. is a competitor claim (a dusk lantern was exhibited; the price is not established) and the decision track repeats that exhibition. The records sit on the competitor track and are cited from the decision track.",
    citations: ids,
    trace,
  };
}
