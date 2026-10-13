import type { CommitMeta, CreatedRepo, RepoInfo, TokenResult } from "../types";

export type TokenScope = "read" | "write";

export interface TreeEntry {
  mode: string;
  type: "blob" | "tree";
  hash: string;
  name: string;
}

export interface FileBlob {
  bytes: Uint8Array;
  contentType: string;
}

export interface CommitRequest {
  message: string;
  author: { name: string; email: string; date: string };
  files: { path: string; content: string }[];
}

/**
 * The subset of Cloudflare Artifacts the demo needs, plus commit.
 * On Cloudflare, commit is `git push` with a repo-scoped write token.
 * Reads map to the Workers binding and the REST file routes.
 */
export interface RepoStore {
  readonly kind: "local" | "cloudflare";
  create(
    name: string,
    opts?: { description?: string; readOnly?: boolean; defaultBranch?: string },
  ): Promise<CreatedRepo>;
  list(): Promise<RepoInfo[]>;
  info(name: string): Promise<RepoInfo>;
  delete(name: string): Promise<void>;
  fork(
    source: string,
    name: string,
    opts?: { description?: string; readOnly?: boolean; defaultBranchOnly?: boolean },
  ): Promise<CreatedRepo>;
  createToken(repo: string, scope?: TokenScope, ttlSeconds?: number): Promise<TokenResult>;
  listTokens(repo: string): Promise<Array<Omit<TokenResult, "plaintext"> & { state: string }>>;
  revokeToken(repo: string, tokenOrId: string): Promise<void>;
  log(repo: string, opts: { ref?: string; limit?: number; offset?: number } | undefined, token: string): Promise<CommitMeta[]>;
  readCommit(repo: string, hash: string, token: string): Promise<CommitMeta | null>;
  readTree(repo: string, hash: string, token: string): Promise<TreeEntry[] | null>;
  readBlob(repo: string, hash: string, token: string): Promise<Uint8Array | null>;
  readFile(repo: string, args: { ref: string; path: string }, token: string): Promise<FileBlob | null>;
  listFiles(repo: string, ref: string, token: string): Promise<string[]>;
  commit(repo: string, token: string, request: CommitRequest): Promise<CommitMeta>;
}

export class StrataError extends Error {
  constructor(
    message: string,
    readonly code:
      | "insufficient_permissions"
      | "token_revoked"
      | "token_expired"
      | "wrong_repo"
      | "not_found"
      | "invalid_token",
  ) {
    super(message);
    this.name = "StrataError";
  }
}
