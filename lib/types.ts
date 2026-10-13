/** Record types on L1. `evidence` is a sourced excerpt, not a scoring model. */
export const RECORD_TYPES = [
  "claim",
  "source",
  "evidence",
  "instruction",
  "preference",
  "event",
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];

export type RecordStatus = "active" | "contested";

/**
 * One typed memory record. `source_ids` link downward to other records,
 * raw message ids, or source-ref ids. `claim_key` + `stance` are how the
 * reconciler decides "same claim" versus "these two disagree".
 */
export interface MemoryRecord {
  id: string;
  type: RecordType;
  content: string;
  time: string;
  source_ids: string[];
  message_ids?: string[];
  track?: string;
  claim_key?: string;
  stance?: string;
  agent: string;
  status?: RecordStatus;
  merged_from?: string[];
  folded_content?: string[];
  content_sha256?: string;
  locator?: string;
  title?: string;
}

export interface ConversationMessage {
  id: string;
  call_id: string;
  call_title: string;
  speaker: string;
  role: "client" | "analyst";
  kind: "look" | "say" | "fact" | "decision" | "preference" | "note";
  time: string;
  text: string;
}

export interface SourceRef {
  id: string;
  title: string;
  sha256: string;
  locator: string;
  excerpt: string;
  time: string;
}

export interface TrackFile {
  path: string;
  id: string;
  title: string;
  record_ids: string[];
  body: string;
  raw: string;
}

export interface ProfileFile {
  path: "profile.md";
  raw: string;
  body: string;
  chars: number;
  record_ids: string[];
  title: string;
}

export interface ContractAgent {
  id: string;
  label: string;
  /** When true, the fork is compared and never promoted. */
  compare_only?: boolean;
  /** Paths this agent may commit on its own fork. Prefixes end with `/`. */
  may_write: string[];
  /** Paths the reconciler may promote from this agent's fork into the engagement. */
  may_promote: string[];
}

export interface Contract {
  contract_version: string;
  kind: string;
  purpose: string;
  client: {
    name: string;
    engagement: string;
    note: string;
  };
  layers: {
    L0: { path: string; append_only: boolean; description: string };
    L1: { path: string; format: string; types: string[] };
    L2: { path: string; format: string };
    L3: { path: string; format: string; max_chars: number };
  };
  agents: ContractAgent[];
  rules: string[];
}

export interface Pyramid {
  contract: Contract;
  profile: ProfileFile;
  tracks: TrackFile[];
  records: MemoryRecord[];
  messages: ConversationMessage[];
  calls: CallFile[];
  sources: SourceRef[];
  files: Map<string, string>;
}

export interface CallFile {
  id: string;
  title: string;
  time: string;
  messages: Array<{
    id: string;
    speaker: string;
    role: "client" | "analyst";
    kind: ConversationMessage["kind"];
    time: string;
    text: string;
  }>;
}

export interface Violation {
  agent: string;
  path: string;
  rule: string;
  detail: string;
}

export interface Fold {
  kept_id: string;
  folded_id: string;
  agent: string;
  claim_key?: string;
  stance?: string;
  source_ids: string[];
}

export interface Conflict {
  id: string;
  claim_key: string;
  reason: "conflicting_stance" | "divergent_record";
  review: "open";
  records: MemoryRecord[];
}

export interface Comparison {
  agent: string;
  repo: string;
  claim_key: string;
  reason: "conflicting_stance" | "withheld";
  detail: string;
  records: MemoryRecord[];
}

export interface FileChange {
  path: string;
  content: string;
}

export interface IncomingBatch {
  agent: string;
  repo: string;
  commit: string | null;
  compareOnly: boolean;
  records: MemoryRecord[];
  files: FileChange[];
}

export interface Promotion {
  path: string;
  agent: string;
  repo: string;
}

export interface ReconcileOutput {
  records: MemoryRecord[];
  conflicts: Conflict[];
  folds: Fold[];
  comparisons: Comparison[];
  added: MemoryRecord[];
  files: FileChange[];
  promotions: Promotion[];
  refusals: Violation[];
  profileAction: "unchanged" | "promoted" | "refused";
}

export interface CommitMeta {
  hash: string;
  message: string;
  authorName: string;
  authorEmail: string;
  date: string;
  parents: string[];
  tree: string;
}

export interface TokenResult {
  id: string;
  plaintext: string;
  scope: "read" | "write";
  expiresAt: string;
  repo: string;
}

export interface RepoInfo {
  id: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  readOnly: boolean;
  remote: string;
  forkedFrom: string | null;
}

export interface CreatedRepo extends RepoInfo {
  token: string;
}

export interface TrailStep {
  kind: "record" | "message" | "snapshot" | "commit" | "fold";
  id: string;
  title: string;
  detail: string;
  meta: string;
}

export interface ProvenanceTrail {
  record_id: string;
  steps: TrailStep[];
}

export interface ToolTrace {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}

export interface QuestionResult {
  id: string;
  route: "top-down" | "bottom-up" | "cross-track";
  question: string;
  answer: string;
  citations: string[];
  trace: ToolTrace[];
}

export interface AgentReport {
  id: string;
  label: string;
  person: string;
  repo: string;
  compareOnly: boolean;
  start: number;
  end: number;
  commit: string | null;
  commitMessage: string | null;
  addedRecordIds: string[];
  committedPaths: string[];
  violations: Violation[];
  trace: ToolTrace[];
  note: string;
}

export interface LayerCommit {
  hash: string;
  message: string;
  layer: string;
}

export interface DemoSnapshot {
  generated_at: string;
  driver: "local" | "cloudflare";
  mocked: boolean;
  repo_path: string;
  engagement: {
    repo: string;
    client: string;
    title: string;
    note: string;
  };
  contract: Contract;
  layer_commits: LayerCommit[];
  history: CommitMeta[];
  questions: QuestionResult[];
  narration: string | null;
  agents: AgentReport[];
  concurrency: {
    overlap: boolean;
    agents: number;
    window_start: number;
    window_end: number;
  };
  governance_receipt: {
    read_token_id: string;
    read_ok: boolean;
    read_commit_refused: boolean;
    refusal_message: string;
  };
  reconcile: {
    folds: Fold[];
    conflicts: Conflict[];
    comparisons: Comparison[];
    added: string[];
    promotions: Promotion[];
    refusals: Violation[];
    profile_action: ReconcileOutput["profileAction"];
    profile_chars: number;
    profile_budget: number;
    commit: string | null;
  };
  pyramid: {
    profile_body: string;
    profile_chars: number;
    tracks: TrackFile[];
    records: MemoryRecord[];
    messages: ConversationMessage[];
    sources: SourceRef[];
    raw_files: string[];
    counts: { L0: number; L1: number; L2: number; L3: number };
  };
  provenance: ProvenanceTrail[];
}
