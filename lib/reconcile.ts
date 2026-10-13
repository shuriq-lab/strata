import { agentById, pathAllowed, profileBodyLength } from "./contract";
import { recordsByType, toJsonl } from "./jsonl";
import { setFrontmatterList, normalize } from "./text";
import type {
  Comparison,
  Conflict,
  Contract,
  FileChange,
  Fold,
  IncomingBatch,
  MemoryRecord,
  Promotion,
  ReconcileOutput,
  TrackFile,
  Violation,
} from "./types";

export interface ReconcileInput {
  contract: Contract;
  baseRecords: MemoryRecord[];
  baseFiles: Map<string, string>;
  batches: IncomingBatch[];
}

/**
 * Merge forks at the record layer.
 * Same claim_key and stance fold together. Same claim_key and a different
 * stance are both kept and flagged. Compare-only forks never enter the file.
 */
export function reconcile(input: ReconcileInput): ReconcileOutput {
  const records = input.baseRecords.map(cloneRecord);
  const byId = new Map(records.map((record) => [record.id, record]));
  const byStance = new Map<string, MemoryRecord>();
  const byContent = new Map<string, MemoryRecord>();
  for (const record of records) indexRecord(record, byStance, byContent);

  const conflicts = new Map<string, Conflict>();
  const folds: Fold[] = [];
  const comparisons: Comparison[] = [];
  const added: MemoryRecord[] = [];
  const refusals: Violation[] = [];
  const promotions: Promotion[] = [];
  const acceptedFiles: FileChange[] = [];
  let profileAction: ReconcileOutput["profileAction"] = "unchanged";

  for (const batch of input.batches) {
    const agent = agentById(input.contract, batch.agent);
    if (batch.compareOnly || agent.compare_only) {
      for (const record of batch.records) {
        comparisons.push(compareRecord(batch, record, records));
      }
      for (const file of batch.files) {
        refusals.push({
          agent: batch.agent,
          path: file.path,
          rule: "compare_only",
          detail: `${agent.label} is a what-if fork. ${file.path} is compared and not promoted.`,
        });
      }
      continue;
    }

    for (const original of batch.records) {
      const record = cloneRecord(original);
      const existing = byId.get(record.id);
      if (existing) {
        if (normalize(existing.content) !== normalize(record.content)) {
          conflicts.set(`divergent:${record.id}`, {
            id: `conflict:${record.id}`,
            claim_key: record.claim_key ?? record.id,
            reason: "divergent_record",
            review: "open",
            records: [cloneRecord(existing), record],
          });
          existing.status = "contested";
        }
        continue;
      }

      if (record.type === "claim" && record.claim_key && record.stance) {
        const twin = byStance.get(`${record.claim_key}@@${record.stance}`);
        if (twin) {
          foldInto(twin, record, batch.agent, folds);
          continue;
        }
        const rivals = records.filter(
          (item) =>
            item.type === "claim" &&
            item.claim_key === record.claim_key &&
            item.stance !== record.stance,
        );
        insertRecord(record, records, byId, byStance, byContent);
        added.push(record);
        if (rivals.length > 0) openConflict(conflicts, record, rivals);
        continue;
      }

      const contentTwin = byContent.get(contentKey(record));
      if (contentTwin) {
        foldInto(contentTwin, record, batch.agent, folds);
        continue;
      }
      insertRecord(record, records, byId, byStance, byContent);
      added.push(record);
    }

    for (const file of batch.files) {
      if (!pathAllowed(agent.may_promote, file.path)) {
        refusals.push({
          agent: batch.agent,
          path: file.path,
          rule: "may_promote",
          detail: `${agent.label} may not promote ${file.path}.`,
        });
        if (file.path === "profile.md") profileAction = "refused";
        continue;
      }
      if (file.path.startsWith("raw/")) {
        const prior = input.baseFiles.get(file.path);
        if (prior !== undefined && prior !== file.content) {
          refusals.push({
            agent: batch.agent,
            path: file.path,
            rule: "append_only",
            detail: "raw/ is append-only. Existing bytes cannot change.",
          });
          continue;
        }
      }
      if (file.path === "profile.md") {
        const budget = input.contract.layers.L3.max_chars;
        const chars = profileBodyLength(file.content);
        if (chars > budget) {
          refusals.push({
            agent: batch.agent,
            path: file.path,
            rule: "profile_budget",
            detail: `Profile body is ${chars} characters. The contract budget is ${budget}.`,
          });
          profileAction = "refused";
          continue;
        }
        profileAction = "promoted";
      }
      const already = acceptedFiles.find((item) => item.path === file.path);
      if (already && already.content !== file.content) {
        refusals.push({
          agent: batch.agent,
          path: file.path,
          rule: "track_conflict",
          detail: `More than one agent changed ${file.path}. The engagement keeps the previous prose.`,
        });
        acceptedFiles.splice(acceptedFiles.indexOf(already), 1);
        promotions.splice(
          promotions.findIndex((item) => item.path === file.path),
          1,
        );
        continue;
      }
      acceptedFiles.push(file);
      promotions.push({ path: file.path, agent: batch.agent, repo: batch.repo });
    }
  }

  for (const conflict of conflicts.values()) {
    conflict.records = conflict.records.map((record, index) => {
      if (conflict.reason === "divergent_record" && index > 0) return record;
      const live = byId.get(record.id);
      return live ? cloneRecord(live) : record;
    });
  }

  const files = materialize(input, records, acceptedFiles);
  return {
    records: sortRecords(records),
    conflicts: [...conflicts.values()].sort((a, b) => a.id.localeCompare(b.id)),
    folds,
    comparisons,
    added,
    files,
    promotions,
    refusals,
    profileAction,
  };
}

function compareRecord(batch: IncomingBatch, record: MemoryRecord, records: MemoryRecord[]): Comparison {
  const rivals = records.filter(
    (item) =>
      record.type === "claim" &&
      item.type === "claim" &&
      item.claim_key &&
      item.claim_key === record.claim_key &&
      item.stance !== record.stance,
  );
  if (rivals.length > 0) {
    return {
      agent: batch.agent,
      repo: batch.repo,
      claim_key: record.claim_key ?? record.id,
      reason: "conflicting_stance",
      detail: `${batch.agent} disagrees on ${record.claim_key}. The fork stays unmerged.`,
      records: [...rivals.map(cloneRecord), cloneRecord(record)],
    };
  }
  return {
    agent: batch.agent,
    repo: batch.repo,
    claim_key: record.claim_key ?? record.id,
    reason: "withheld",
    detail: `${batch.agent} wrote ${record.id}. Compare-only forks are not promoted.`,
    records: [cloneRecord(record)],
  };
}

function openConflict(conflicts: Map<string, Conflict>, incoming: MemoryRecord, rivals: MemoryRecord[]) {
  const key = incoming.claim_key ?? incoming.id;
  const current = conflicts.get(key);
  const members = current ? current.records : rivals.map(cloneRecord);
  if (!members.some((item) => item.id === incoming.id)) members.push(cloneRecord(incoming));
  for (const rival of rivals) rival.status = "contested";
  incoming.status = "contested";
  const stored = members.map((item) => {
    const live = item.id === incoming.id ? incoming : rivals.find((rival) => rival.id === item.id);
    return cloneRecord(live ?? item);
  });
  conflicts.set(key, {
    id: `conflict:${key}`,
    claim_key: key,
    reason: "conflicting_stance",
    review: "open",
    records: stored,
  });
}

function foldInto(kept: MemoryRecord, incoming: MemoryRecord, agent: string, folds: Fold[]) {
  kept.source_ids = union(kept.source_ids, incoming.source_ids);
  kept.message_ids = union(kept.message_ids, incoming.message_ids);
  kept.merged_from = union(kept.merged_from, [incoming.id]);
  if (normalize(kept.content) !== normalize(incoming.content)) {
    kept.folded_content = union(kept.folded_content, [incoming.content]);
  }
  folds.push({
    kept_id: kept.id,
    folded_id: incoming.id,
    agent,
    claim_key: incoming.claim_key,
    stance: incoming.stance,
    source_ids: kept.source_ids,
  });
}

function materialize(
  input: ReconcileInput,
  records: MemoryRecord[],
  acceptedFiles: FileChange[],
): FileChange[] {
  const files: FileChange[] = [];
  const grouped = recordsByType(sortRecords(records));
  for (const type of ["claim", "source", "evidence", "instruction", "preference", "event"]) {
    const path = `records/${type}.jsonl`;
    const next = toJsonl(grouped.get(type) ?? []);
    if ((input.baseFiles.get(path) ?? "") !== next) files.push({ path, content: next });
  }

  const replacements = new Map(acceptedFiles.map((file) => [file.path, file.content]));
  const trackIds = new Map<string, string[]>();
  for (const record of records) {
    if (!record.track) continue;
    const list = trackIds.get(record.track) ?? [];
    list.push(record.id);
    trackIds.set(record.track, list);
  }

  for (const [path, base] of input.baseFiles) {
    if (!path.startsWith("tracks/") || !path.endsWith(".md")) continue;
    const id = path.replace(/^tracks\//, "").replace(/\.md$/, "");
    const prose = replacements.get(path) ?? base;
    const ids = [...new Set(trackIds.get(id) ?? [])].sort();
    const next = setFrontmatterList(prose, "record_ids", ids);
    if (next !== base) files.push({ path, content: next });
    replacements.delete(path);
  }

  for (const [path, content] of replacements) {
    if (path.startsWith("records/")) continue;
    if ((input.baseFiles.get(path) ?? "") !== content) files.push({ path, content });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

export function syncTrackPreview(track: TrackFile, records: MemoryRecord[]): string[] {
  return records.filter((record) => record.track === track.id).map((record) => record.id).sort();
}

function insertRecord(
  record: MemoryRecord,
  records: MemoryRecord[],
  byId: Map<string, MemoryRecord>,
  byStance: Map<string, MemoryRecord>,
  byContent: Map<string, MemoryRecord>,
) {
  records.push(record);
  byId.set(record.id, record);
  indexRecord(record, byStance, byContent);
}

function indexRecord(
  record: MemoryRecord,
  byStance: Map<string, MemoryRecord>,
  byContent: Map<string, MemoryRecord>,
) {
  const stance = stanceKey(record);
  if (stance && !byStance.has(stance)) byStance.set(stance, record);
  const content = contentKey(record);
  if (!byContent.has(content)) byContent.set(content, record);
}

function stanceKey(record: MemoryRecord): string | null {
  if (record.type !== "claim" || !record.claim_key || !record.stance) return null;
  return `${record.claim_key}@@${record.stance}`;
}

function contentKey(record: MemoryRecord): string {
  return `${record.type}@@${normalize(record.content)}`;
}

function union(left: string[] | undefined, right: string[] | undefined): string[] {
  return [...new Set([...(left ?? []), ...(right ?? [])])].sort();
}

function cloneRecord(record: MemoryRecord): MemoryRecord {
  return {
    ...record,
    source_ids: [...record.source_ids],
    message_ids: record.message_ids ? [...record.message_ids] : undefined,
    merged_from: record.merged_from ? [...record.merged_from] : undefined,
    folded_content: record.folded_content ? [...record.folded_content] : undefined,
  };
}

function sortRecords(records: MemoryRecord[]): MemoryRecord[] {
  return [...records].sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
}
