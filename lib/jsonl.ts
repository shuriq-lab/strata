import type { MemoryRecord } from "./types";
import { isRecordType, orderRecord } from "./text";

export function parseJsonl(text: string, file = "records"): MemoryRecord[] {
  const records: MemoryRecord[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`${file}:${i + 1} is not valid JSON`);
    }
    records.push(asRecord(value, `${file}:${i + 1}`));
  }
  return records;
}

export function toJsonl(records: MemoryRecord[]): string {
  if (records.length === 0) return "";
  return `${records.map((record) => JSON.stringify(orderRecord(record))).join("\n")}\n`;
}

function asRecord(value: unknown, where: string): MemoryRecord {
  if (!value || typeof value !== "object") {
    throw new Error(`${where} is not a record`);
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id) throw new Error(`${where} is missing id`);
  if (typeof row.type !== "string" || !isRecordType(row.type)) {
    throw new Error(`${where} has an unknown type`);
  }
  if (typeof row.content !== "string") throw new Error(`${where} is missing content`);
  if (typeof row.time !== "string") throw new Error(`${where} is missing time`);
  if (typeof row.agent !== "string") throw new Error(`${where} is missing agent`);
  if (!Array.isArray(row.source_ids) || row.source_ids.some((id) => typeof id !== "string")) {
    throw new Error(`${where} is missing source_ids`);
  }
  return row as unknown as MemoryRecord;
}

export function recordsByType(records: MemoryRecord[]): Map<string, MemoryRecord[]> {
  const grouped = new Map<string, MemoryRecord[]>();
  for (const record of records) {
    const list = grouped.get(record.type) ?? [];
    list.push(record);
    grouped.set(record.type, list);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.id.localeCompare(b.id));
  }
  return grouped;
}
