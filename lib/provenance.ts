import type {
  CommitMeta,
  MemoryRecord,
  ProvenanceTrail,
  Pyramid,
  TrailStep,
} from "./types";

export interface Origin {
  agent: string;
  repo: string;
  commit: string;
  message: string;
}

export function buildTrail(
  pyramid: Pyramid,
  record: MemoryRecord,
  origins: Map<string, Origin>,
  promoted: { repo: string; commit: string; message: string } | null,
): ProvenanceTrail {
  const steps: TrailStep[] = [];
  const seen = new Set<string>();

  const walkRecord = (current: MemoryRecord, depth: number) => {
    if (seen.has(current.id)) return;
    seen.add(current.id);
    steps.push({
      kind: "record",
      id: current.id,
      title: current.type === "claim" ? current.stance ?? current.type : current.type,
      detail: current.content,
      meta: [current.agent, current.claim_key, current.track].filter(Boolean).join(" · "),
    });
    if (current.merged_from && current.merged_from.length > 0) {
      steps.push({
        kind: "fold",
        id: current.merged_from.join(","),
        title: "Folded duplicates",
        detail: (current.folded_content ?? []).join(" ") || "Same stance, so the wording was folded in.",
        meta: `Kept ${current.id}. Folded ${current.merged_from.join(", ")}.`,
      });
    }
    if (depth >= 3) return;
    for (const sourceId of linkIds(current)) walkId(sourceId, depth + 1);
    if (
      current.content_sha256 &&
      !steps.some((step) => step.kind === "snapshot" && step.meta.includes(current.content_sha256 ?? ""))
    ) {
      steps.push({
        kind: "snapshot",
        id: current.locator ?? current.id,
        title: current.title ?? "Content hash",
        detail: current.content,
        meta: `${current.content_sha256} · ${current.locator ?? "record hash"}`,
      });
    }
  };

  const walkId = (id: string, depth: number) => {
    if (seen.has(id)) return;
    const linked = pyramid.records.find((item) => item.id === id);
    if (linked) {
      walkRecord(linked, depth);
      return;
    }
    const message = pyramid.messages.find((item) => item.id === id);
    if (message) {
      seen.add(id);
      steps.push({
        kind: "message",
        id: message.id,
        title: `${message.speaker} · ${message.kind}`,
        detail: message.text,
        meta: message.time,
      });
      return;
    }
    const source = pyramid.sources.find((item) => item.id === id);
    if (source) {
      seen.add(id);
      steps.push({
        kind: "snapshot",
        id: source.id,
        title: source.title,
        detail: source.excerpt,
        meta: `${source.sha256} · ${source.locator}`,
      });
      return;
    }
    if (linked === undefined && record.content_sha256 && id === record.id) return;
  };

  walkRecord(record, 0);

  const origin = origins.get(record.id);
  if (origin) {
    steps.push({
      kind: "commit",
      id: origin.commit,
      title: `Authored by ${origin.agent}`,
      detail: origin.message,
      meta: `${origin.repo} · ${origin.commit}`,
    });
  }
  if (promoted && origin && promoted.commit !== origin.commit) {
    steps.push({
      kind: "commit",
      id: promoted.commit,
      title: "Promoted by reconciler",
      detail: promoted.message,
      meta: `${promoted.repo} · ${promoted.commit}`,
    });
  }

  return { record_id: record.id, steps };
}

function linkIds(record: MemoryRecord): string[] {
  return [...record.source_ids, ...(record.message_ids ?? [])];
}

export function commitMessage(history: CommitMeta[], hash: string): string {
  return history.find((commit) => commit.hash === hash)?.message ?? "";
}
