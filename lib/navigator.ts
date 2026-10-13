import type {
  ConversationMessage,
  MemoryRecord,
  Pyramid,
  RecordType,
  TrackFile,
} from "./types";
import { keywords, scoreText } from "./text";

export interface SearchRecordsArgs {
  query?: string;
  type?: RecordType | string;
  limit?: number;
}

export interface GetRecordsArgs {
  ids?: string[];
  record_ids?: string[];
}

export interface SearchConversationsArgs {
  query?: string;
  limit?: number;
}

export interface GetConversationsArgs {
  ids?: string[];
  message_ids?: string[];
}

export interface ReadFilesArgs {
  paths?: string[];
  path?: string;
}

const HIGH_LEVEL = /^(profile\.md|tracks\/[^/]+\.md|contract\.json)$/;

/**
 * NapMem's five tools, over one engagement pyramid.
 * Search is keyword overlap. The default limit is five, matching the paper.
 */
export class Navigator {
  constructor(private readonly pyramid: Pyramid) {}

  readFiles(args: ReadFilesArgs): { path: string; content: string }[] | { error: string } {
    const paths = args.paths ?? (args.path ? [args.path] : []);
    if (paths.length === 0) return { error: "read_files requires paths" };
    const out: { path: string; content: string }[] = [];
    for (const path of paths) {
      if (!HIGH_LEVEL.test(path)) {
        return {
          error: `${path} is not a profile or topic track. Use get_records or get_conversations.`,
        };
      }
      const content = this.pyramid.files.get(path);
      if (content === undefined) return { error: `${path} is not in this engagement` };
      out.push({ path, content });
    }
    return out;
  }

  getRecords(args: GetRecordsArgs): { records: MemoryRecord[]; missing: string[] } {
    const ids = args.ids ?? args.record_ids ?? [];
    const records: MemoryRecord[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const record = this.pyramid.records.find((item) => item.id === id);
      if (record) records.push(record);
      else missing.push(id);
    }
    return { records, missing };
  }

  searchRecords(args: SearchRecordsArgs): { records: MemoryRecord[] } {
    const limit = args.limit ?? 5;
    const terms = keywords(args.query ?? "");
    const pool = this.pyramid.records.filter((record) => !args.type || record.type === args.type);
    const ranked = pool
      .map((record) => ({
        record,
        score: scoreText(
          [record.content, record.title, record.claim_key, record.stance, record.track, record.type]
            .filter(Boolean)
            .join(" "),
          terms,
        ),
      }))
      .filter((item) => (terms.length === 0 ? true : item.score > 0))
      .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id))
      .slice(0, limit)
      .map((item) => item.record);
    return { records: ranked };
  }

  getConversations(args: GetConversationsArgs): {
    messages: ConversationMessage[];
    missing: string[];
  } {
    const ids = args.ids ?? args.message_ids ?? [];
    const messages: ConversationMessage[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const message = this.pyramid.messages.find((item) => item.id === id);
      if (message) messages.push(message);
      else missing.push(id);
    }
    return { messages, missing };
  }

  searchConversations(args: SearchConversationsArgs): { messages: ConversationMessage[] } {
    const limit = args.limit ?? 5;
    const terms = keywords(args.query ?? "");
    return {
      messages: this.pyramid.messages
        .map((message) => ({
          message,
          score: scoreText(`${message.text} ${message.speaker} ${message.kind}`, terms),
        }))
        .filter((item) => (terms.length === 0 ? true : item.score > 0))
        .sort((a, b) => b.score - a.score || a.message.id.localeCompare(b.message.id))
        .slice(0, limit)
        .map((item) => item.message),
    };
  }

  tracks(): TrackFile[] {
    return this.pyramid.tracks;
  }
}
