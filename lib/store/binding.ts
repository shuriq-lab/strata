import type { CommitMeta } from "../types";

/**
 * Structural view of the Artifacts Workers binding, as documented at
 * https://developers.cloudflare.com/artifacts/api/workers-binding/
 * `npx wrangler types` replaces the generated names in a real account.
 * Field readers accept the documented shape plus the aliases the REST log uses.
 */
export interface ArtifactsRepoHandle {
  info(): Promise<Record<string, unknown>>;
  createToken(scope?: "read" | "write", ttl?: number): Promise<Record<string, unknown>>;
  listTokens(): Promise<{ total?: number; tokens?: unknown[] }>;
  revokeToken(tokenOrId: string): Promise<unknown>;
  fork(name: string, opts?: { description?: string; readOnly?: boolean; defaultBranchOnly?: boolean }): Promise<Record<string, unknown>>;
  log(opts?: { ref?: string; limit?: number; offset?: number }): Promise<unknown[]>;
  readCommit(hash: string): Promise<unknown | null>;
  readTree(hash: string): Promise<unknown[] | null>;
  readBlob(hash: string): Promise<Blob | null>;
  readFile(args: { ref: string; path: string }): Promise<Blob | null>;
}

export interface ArtifactsBinding {
  get(name: string): Promise<ArtifactsRepoHandle>;
  create?(name: string, opts?: { description?: string; readOnly?: boolean; setDefaultBranch?: string }): Promise<Record<string, unknown>>;
  list?(opts?: { limit?: number; cursor?: string }): Promise<{ repos?: unknown[]; cursor?: string }>;
  delete?(name: string): Promise<unknown>;
}

export async function listFilesFromBinding(repo: ArtifactsRepoHandle, ref = "main"): Promise<Map<string, string>> {
  const history = await repo.log({ ref, limit: 1 });
  if (!history?.length) return new Map();
  const tip = asCommit(history[0]);
  let tree = tip.tree;
  if (!tree) {
    const commit = await repo.readCommit(tip.hash);
    tree = commit ? asCommit(commit).tree : "";
  }
  if (!tree) throw new Error("Artifacts commit has no tree hash");
  const files = new Map<string, string>();
  await walk(repo, tree, "", files, ref);
  return files;
}

async function walk(
  repo: ArtifactsRepoHandle,
  hash: string,
  prefix: string,
  files: Map<string, string>,
  ref: string,
) {
  const entries = await repo.readTree(hash);
  if (!entries) return;
  for (const entry of entries) {
    const row = entry as Record<string, unknown>;
    const name = String(row.name ?? row.path ?? "");
    const type = String(row.type ?? "blob");
    const child = String(row.hash ?? row.oid ?? row.id ?? "");
    const full = prefix ? `${prefix}/${name}` : name;
    if (type === "tree") {
      await walk(repo, child, full, files, ref);
    } else {
      const blob = await repo.readFile({ ref, path: full });
      files.set(full, blob ? await blob.text() : "");
    }
  }
}

export function asCommit(value: unknown): CommitMeta {
  const row = (value ?? {}) as Record<string, unknown>;
  const author = (row.author ?? {}) as Record<string, unknown>;
  return {
    hash: String(row.hash ?? row.id ?? row.oid ?? ""),
    message: String(row.message ?? ""),
    authorName: String(author.name ?? ""),
    authorEmail: String(author.email ?? ""),
    date: String(author.date ?? row.timestamp ?? ""),
    parents: Array.isArray(row.parents) ? (row.parents as string[]) : [],
    tree: String(row.tree ?? row.tree_hash ?? row.treeHash ?? ""),
  };
}
