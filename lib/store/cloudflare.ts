import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { CommitMeta, CreatedRepo, RepoInfo } from "../types";
import { StrataError, type CommitRequest, type FileBlob, type RepoStore, type TokenScope, type TreeEntry } from "./types";

const exec = promisify(execFile);

export interface CloudflareConfig {
  accountId: string;
  namespace: string;
  apiToken: string;
  cacheDir: string;
  fetchImpl?: typeof fetch;
}

interface Envelope<T> {
  success: boolean;
  errors?: { message?: string }[];
  result: T;
}

/**
 * REST + git adapter for real Cloudflare Artifacts.
 * Control-plane calls use the account API token. Git push and clone use a
 * repo-scoped token in an Authorization header, never in a remote URL.
 * This module is not used by `npm run demo` unless ARTIFACTS_DRIVER=cloudflare.
 */
export class CloudflareStore implements RepoStore {
  readonly kind = "cloudflare" as const;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: CloudflareConfig) {
    this.base = artifactsBaseUrl(config.accountId, config.namespace);
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async create(name: string, opts?: { description?: string; readOnly?: boolean; defaultBranch?: string }): Promise<CreatedRepo> {
    const body = {
      name,
      description: opts?.description,
      default_branch: opts?.defaultBranch ?? "main",
      read_only: opts?.readOnly ?? false,
    };
    // A just-deleted name can briefly still report 409; retry for a short while.
    let result: CreateResult | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        result = await this.request<CreateResult>("POST", "/repos", body);
        break;
      } catch (error) {
        if ((error as { status?: number }).status !== 409 || attempt >= 15) throw error;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    return {
      id: result.id,
      name: result.name,
      description: result.description,
      defaultBranch: result.default_branch,
      readOnly: opts?.readOnly ?? false,
      remote: result.remote,
      forkedFrom: null,
      token: result.token,
    };
  }

  async list(): Promise<RepoInfo[]> {
    const result = await this.request<RepoResult[]>("/repos?limit=100");
    return result.map(toInfo);
  }

  async info(name: string): Promise<RepoInfo> {
    return toInfo(await this.request<RepoResult>(`/repos/${encodeURIComponent(name)}`));
  }

  async delete(name: string): Promise<void> {
    await this.request("DELETE", `/repos/${encodeURIComponent(name)}`);
    await rm(path.join(this.config.cacheDir, name), { recursive: true, force: true });
  }

  async fork(
    source: string,
    name: string,
    opts?: { description?: string; readOnly?: boolean; defaultBranchOnly?: boolean },
  ): Promise<CreatedRepo> {
    const result = await this.request<CreateResult & { objects?: number }>(
      "POST",
      `/repos/${encodeURIComponent(source)}/fork`,
      {
        name,
        description: opts?.description,
        read_only: opts?.readOnly ?? false,
        default_branch_only: opts?.defaultBranchOnly ?? true,
      },
    );
    return {
      id: result.id,
      name: result.name,
      description: result.description,
      defaultBranch: result.default_branch,
      readOnly: opts?.readOnly ?? false,
      remote: result.remote,
      forkedFrom: source,
      token: result.token,
    };
  }

  async createToken(repo: string, scope: TokenScope = "write", ttlSeconds = 3600) {
    const result = await this.request<TokenCreateResult>("POST", "/tokens", {
      repo,
      scope,
      ttl: ttlSeconds,
    });
    return {
      id: result.id,
      plaintext: result.plaintext,
      scope: result.scope,
      expiresAt: result.expires_at,
      repo,
    };
  }

  async listTokens(repo: string) {
    const result = await this.request<TokenListResult[]>(
      `/repos/${encodeURIComponent(repo)}/tokens?state=all&per_page=100`,
    );
    return result.map((token) => ({
      id: token.id,
      scope: token.scope,
      expiresAt: token.expires_at,
      repo,
      state: token.state,
    }));
  }

  async revokeToken(_repo: string, tokenOrId: string): Promise<void> {
    await this.request("DELETE", `/tokens/${encodeURIComponent(tokenOrId)}`);
  }

  async log(repo: string, opts: { ref?: string; limit?: number; offset?: number } | undefined, token: string) {
    requireToken(token);
    const params = new URLSearchParams();
    if (opts?.ref) params.set("ref", opts.ref);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    const query = params.size ? `?${params}` : "";
    const result = await this.request<unknown>(`/repos/${encodeURIComponent(repo)}/log${query}`);
    return normalizeCommits(result);
  }

  async readCommit(repo: string, hash: string, token: string): Promise<CommitMeta | null> {
    requireToken(token);
    try {
      const result = await this.request<unknown>(
        `/repos/${encodeURIComponent(repo)}/commit/${encodeURIComponent(hash)}`,
      );
      return normalizeCommits([result])[0] ?? null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async readTree(repo: string, hash: string, token: string): Promise<TreeEntry[] | null> {
    requireToken(token);
    try {
      const result = await this.request<unknown>(
        `/repos/${encodeURIComponent(repo)}/tree/${encodeURIComponent(hash)}`,
      );
      return normalizeTree(result);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async readBlob(repo: string, hash: string, token: string): Promise<Uint8Array | null> {
    requireToken(token);
    const response = await this.fetchImpl(
      `${this.base}/repos/${encodeURIComponent(repo)}/blob/${encodeURIComponent(hash)}`,
      { headers: this.headers() },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Artifacts blob read failed (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async readFile(repo: string, args: { ref: string; path: string }, token: string): Promise<FileBlob | null> {
    requireToken(token);
    const params = new URLSearchParams({ ref: args.ref, path: args.path });
    const response = await this.fetchImpl(
      `${this.base}/repos/${encodeURIComponent(repo)}/file?${params}`,
      { headers: this.headers() },
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      const text = await response.text();
      if (text.includes("File not found") || response.status === 404) return null;
      throw new Error(`Artifacts file read failed (${response.status}): ${text.slice(0, 300)}`);
    }
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  async listFiles(repo: string, ref: string, token: string): Promise<string[]> {
    const history = await this.log(repo, { ref, limit: 1 }, token);
    if (history.length === 0) return [];
    const commit = history[0];
    const root = commit.tree || (await this.readCommit(repo, commit.hash, token))?.tree;
    if (!root) return [];
    return walkTree(this, repo, root, "", token);
  }

  async commit(repo: string, token: string, request: CommitRequest): Promise<CommitMeta> {
    requireToken(token);
    const info = await this.info(repo);
    if (info.readOnly) {
      throw new StrataError("Insufficient permissions. This repository is read-only.", "insufficient_permissions");
    }
    const dir = path.join(this.config.cacheDir, repo);
    await mkdir(this.config.cacheDir, { recursive: true });
    const header = `Authorization: Bearer ${token}`;
    try {
      await git(["rev-parse", "--is-inside-work-tree"], dir);
      await git(["fetch", info.remote, info.defaultBranch], dir, header);
      // Fetching by URL only updates FETCH_HEAD, not origin/<branch>.
      await git(["checkout", "-B", info.defaultBranch, "FETCH_HEAD"], dir);
      await git(["reset", "--hard", "FETCH_HEAD"], dir);
    } catch {
      await rm(dir, { recursive: true, force: true });
      await git(["clone", info.remote, dir], this.config.cacheDir, header);
    }
    for (const file of request.files) {
      const full = path.join(dir, file.path);
      if (!full.startsWith(dir)) throw new Error(`Refusing to write ${file.path}`);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, file.content);
    }
    await git(["add", "-A"], dir);
    await git(["commit", "-m", request.message], dir, undefined, {
      GIT_AUTHOR_NAME: request.author.name,
      GIT_AUTHOR_EMAIL: request.author.email,
      GIT_AUTHOR_DATE: request.author.date,
      GIT_COMMITTER_NAME: request.author.name,
      GIT_COMMITTER_EMAIL: request.author.email,
      GIT_COMMITTER_DATE: request.author.date,
    });
    try {
      await git(["push", info.remote, `HEAD:${info.defaultBranch}`], dir, header);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Insufficient permissions|returned error: 403/i.test(message)) {
        // Drop the local commit so the cache matches the remote again.
        await git(["reset", "--hard", "HEAD~1"], dir).catch(() => undefined);
        throw new StrataError("Insufficient permissions. Artifacts refused the push for this token.", "insufficient_permissions", /\b403\b/.test(message) ? 403 : undefined);
      }
      throw error;
    }
    const history = await this.log(repo, { ref: info.defaultBranch, limit: 1 }, token);
    if (!history[0]) throw new Error("Push succeeded but the commit was not readable yet");
    return history[0];
  }

  private headers(): HeadersInit {
    return { Authorization: `Bearer ${this.config.apiToken}` };
  }

  private async request<T>(methodOrPath: string, pathOrBody?: string | unknown, body?: unknown): Promise<T> {
    const isVerb =
      methodOrPath === "GET" || methodOrPath === "POST" || methodOrPath === "DELETE" || methodOrPath === "PUT";
    const method = isVerb ? methodOrPath : "GET";
    const route = isVerb ? String(pathOrBody ?? "") : methodOrPath;
    const payload = isVerb ? body : undefined;
    const response = await this.fetchImpl(`${this.base}${route}`, {
      method,
      headers: {
        ...this.headers(),
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const text = await response.text();
    let envelope: Envelope<T> | null = null;
    try {
      envelope = JSON.parse(text) as Envelope<T>;
    } catch {
      envelope = null;
    }
    if (!response.ok || (envelope && envelope.success === false)) {
      const message = envelope?.errors?.[0]?.message ?? text.slice(0, 400);
      const error = new Error(`Artifacts ${method} ${route} failed (${response.status}): ${message}`);
      (error as { status?: number }).status = response.status;
      throw error;
    }
    if (!envelope) throw new Error(`Artifacts ${route} returned a non-JSON body`);
    return envelope.result;
  }
}

export function artifactsBaseUrl(accountId: string, namespace: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/artifacts/namespaces/${namespace}`;
}

/** Artifacts git basic-auth uses the token secret. The Bearer header takes the full plaintext. */
export function artifactTokenSecret(plaintext: string): string {
  return plaintext.split("?expires=")[0] ?? plaintext;
}

export function cloudflareConfigFromEnv(cacheDir: string): CloudflareConfig {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const namespace = process.env.ARTIFACTS_NAMESPACE ?? "";
  const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? "";
  if (!accountId || !namespace || !apiToken) {
    throw new Error(
      "Cloudflare Artifacts needs CLOUDFLARE_ACCOUNT_ID, ARTIFACTS_NAMESPACE, and CLOUDFLARE_API_TOKEN. Leave ARTIFACTS_DRIVER unset to use the local adapter.",
    );
  }
  return { accountId, namespace, apiToken, cacheDir };
}

interface CreateResult {
  id: string;
  name: string;
  description: string | null;
  default_branch: string;
  remote: string;
  token: string;
}

interface RepoResult {
  id: string;
  name: string;
  description: string | null;
  default_branch: string;
  remote: string;
  read_only?: boolean;
}

interface TokenCreateResult {
  id: string;
  plaintext: string;
  scope: TokenScope;
  expires_at: string;
}

interface TokenListResult {
  id: string;
  scope: TokenScope;
  state: string;
  expires_at: string;
}

function toInfo(result: RepoResult): RepoInfo {
  return {
    id: result.id,
    name: result.name,
    description: result.description,
    defaultBranch: result.default_branch ?? "main",
    readOnly: result.read_only ?? false,
    remote: result.remote,
    forkedFrom: null,
  };
}

function requireToken(token: string) {
  if (!token) throw new StrataError("A repo-scoped token is required.", "invalid_token");
}

function isNotFound(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  const message = error instanceof Error ? error.message : "";
  return status === 404 || /not found/i.test(message);
}

function normalizeCommits(result: unknown): CommitMeta[] {
  const list = Array.isArray(result)
    ? result
    : ((result as { commits?: unknown[] })?.commits ?? [result]);
  return list.filter(Boolean).map((item) => {
    const row = item as Record<string, unknown>;
    const author = (row.author ?? {}) as Record<string, unknown>;
    const parents = Array.isArray(row.parents) ? (row.parents as string[]) : [];
    return {
      hash: String(row.hash ?? row.id ?? row.oid ?? ""),
      message: String(row.message ?? row.subject ?? ""),
      authorName: String(author.name ?? row.author_name ?? ""),
      authorEmail: String(author.email ?? row.author_email ?? ""),
      date: String(author.date ?? row.timestamp ?? row.authored_at ?? ""),
      parents,
      tree: String(row.tree ?? row.tree_hash ?? row.treeHash ?? ""),
    };
  });
}

function normalizeTree(result: unknown): TreeEntry[] {
  const list = Array.isArray(result) ? result : ((result as { entries?: unknown[] })?.entries ?? []);
  return list.map((item) => {
    const row = item as Record<string, unknown>;
    const type = String(row.type ?? "blob");
    return {
      mode: String(row.mode ?? ""),
      type: type === "tree" ? "tree" : "blob",
      hash: String(row.hash ?? row.oid ?? row.id ?? ""),
      name: String(row.name ?? row.path ?? row.filename ?? ""),
    };
  });
}

async function walkTree(
  store: CloudflareStore,
  repo: string,
  hash: string,
  prefix: string,
  token: string,
): Promise<string[]> {
  const entries = await store.readTree(repo, hash, token);
  if (!entries) return [];
  const files: string[] = [];
  for (const entry of entries) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.type === "tree") files.push(...(await walkTree(store, repo, entry.hash, name, token)));
    else files.push(name);
  }
  return files;
}

async function git(
  args: string[],
  cwd: string,
  header?: string,
  extra?: Record<string, string>,
): Promise<string> {
  const flags = ["-c", "safe.directory=*", "-c", "user.name=Strata", "-c", "user.email=strata@localhost", "-c", "commit.gpgsign=false"];
  if (header) flags.push("-c", `http.extraHeader=${header}`);
  try {
    const { stdout } = await exec("git", flags.concat(args), {
      cwd,
      env: { ...process.env, ...extra },
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    // Never leak the repo token through error messages or logs.
    const redact = (text: unknown) => String(text ?? "").replace(/Bearer [^\s'"]+/g, "Bearer [redacted]");
    const err = error as { message?: string; stderr?: string };
    throw new Error(`git ${args[0]} failed: ${redact(err.stderr || err.message).slice(0, 600)}`);
  }
}
