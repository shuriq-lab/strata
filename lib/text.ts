import type { MemoryRecord, RecordType } from "./types";

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "was", "were"]);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function keywords(query: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of query.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

export function scoreText(text: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const hay = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (hay.includes(term)) score += 1;
  }
  return score;
}

const RECORD_KEYS: (keyof MemoryRecord)[] = [
  "id",
  "type",
  "title",
  "content",
  "time",
  "track",
  "claim_key",
  "stance",
  "agent",
  "status",
  "source_ids",
  "message_ids",
  "merged_from",
  "folded_content",
  "content_sha256",
  "locator",
];

export function orderRecord(record: MemoryRecord): MemoryRecord {
  const ordered: Record<string, unknown> = {};
  for (const key of RECORD_KEYS) {
    const value = record[key];
    if (value === undefined) continue;
    ordered[key] = value;
  }
  return ordered as unknown as MemoryRecord;
}

export function parseFrontmatter(markdown: string): {
  data: Record<string, string | string[]>;
  body: string;
} {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: markdown.trim() };
  const data: Record<string, string | string[]> = {};
  const lines = match[1].split(/\r?\n/);
  let listKey: string | null = null;
  for (const line of lines) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      const current = data[listKey];
      const list = Array.isArray(current) ? current : [];
      list.push(unquote(item[1].trim()));
      data[listKey] = list;
      continue;
    }
    const field = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!field) continue;
    const key = field[1];
    const raw = field[2].trim();
    if (raw === "") {
      listKey = key;
      if (!Array.isArray(data[key])) data[key] = [];
    } else {
      listKey = null;
      data[key] = unquote(raw);
    }
  }
  return { data, body: markdown.slice(match[0].length).trim() };
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function setFrontmatterList(markdown: string, key: string, ids: string[]): string {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    const list = ids.map((id) => `  - ${id}`).join("\n");
    return `---\n${key}:\n${list}\n---\n\n${markdown.trim()}\n`;
  }
  const lines = match[1].split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  let found = false;
  for (const line of lines) {
    const field = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (field) {
      skipping = false;
      if (field[1] === key) {
        found = true;
        skipping = field[2].trim() === "";
        continue;
      }
    } else if (skipping && /^\s+-\s+/.test(line)) {
      continue;
    } else {
      skipping = false;
    }
    kept.push(line);
  }
  const block = [`${key}:`, ...ids.map((id) => `  - ${id}`)];
  const next = found ? [...kept, ...block] : [...kept, ...block];
  const body = markdown.slice(match[0].length).replace(/^\n/, "");
  return `---\n${next.join("\n")}\n---\n${body.endsWith("\n") ? body : `${body}\n`}`;
}

export function isRecordType(value: string): value is RecordType {
  return (
    value === "claim" ||
    value === "source" ||
    value === "evidence" ||
    value === "instruction" ||
    value === "preference" ||
    value === "event"
  );
}

export function shortHash(hash: string, size = 8): string {
  return hash.slice(0, size);
}
