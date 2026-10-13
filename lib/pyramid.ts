import { parseContract, profileBodyLength } from "./contract";
import { parseJsonl } from "./jsonl";
import { parseFrontmatter } from "./text";
import type {
  CallFile,
  ConversationMessage,
  ProfileFile,
  Pyramid,
  SourceRef,
  TrackFile,
} from "./types";

export function parsePyramid(files: Map<string, string>): Pyramid {
  const contractText = files.get("contract.json");
  if (!contractText) throw new Error("engagement repo has no contract.json");
  const contract = parseContract(contractText);

  const profileRaw = files.get("profile.md") ?? "";
  const profileFm = parseFrontmatter(profileRaw);
  const profile: ProfileFile = {
    path: "profile.md",
    raw: profileRaw,
    body: profileFm.body,
    chars: profileBodyLength(profileRaw),
    record_ids: asList(profileFm.data.record_ids),
    title: asString(profileFm.data.title, "Profile"),
  };

  const tracks: TrackFile[] = [];
  const records = [];
  const calls: CallFile[] = [];
  const sources: SourceRef[] = [];

  for (const [path, content] of [...files.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (path.startsWith("tracks/") && path.endsWith(".md")) {
      const fm = parseFrontmatter(content);
      tracks.push({
        path,
        id: asString(fm.data.id, path.replace(/^tracks\//, "").replace(/\.md$/, "")),
        title: asString(fm.data.title, path),
        record_ids: asList(fm.data.record_ids),
        body: fm.body,
        raw: content,
      });
    } else if (path.startsWith("records/") && path.endsWith(".jsonl")) {
      records.push(...parseJsonl(content, path));
    } else if (path.startsWith("raw/calls/") && path.endsWith(".json")) {
      calls.push(JSON.parse(content) as CallFile);
    } else if (path.startsWith("raw/sources/") && path.endsWith(".json")) {
      sources.push(JSON.parse(content) as SourceRef);
    }
  }

  const messages: ConversationMessage[] = [];
  for (const call of calls) {
    for (const message of call.messages) {
      messages.push({
        ...message,
        call_id: call.id,
        call_title: call.title,
      });
    }
  }

  records.sort((a, b) => a.id.localeCompare(b.id));
  tracks.sort((a, b) => a.id.localeCompare(b.id));

  return { contract, profile, tracks, records, messages, calls, sources, files };
}

function asString(value: string | string[] | undefined, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return [];
}

export function fileMap(files: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(files));
}
