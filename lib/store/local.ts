import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { CommitMeta, CreatedRepo, RepoInfo, TokenResult } from "../types";
import { StrataError, type CommitRequest, type FileBlob, type RepoStore, type TokenScope, type TreeEntry } from "./types";

const exec = promisify(execFile);

interface StoredToken {
  id: string;
  plaintext: string;
  scope: TokenScope;
  expiresAt: string;
  repo: string;
  state: "active" | "revoked";
}

interface MetaFile {
  repos: Record<string, { id: string; description: string | null; readOnly: boolean; forkedFrom: string | null }>;
  tokens: StoredToken[];
}

/**
 * Filesystem stand-in for Cloudflare Artifacts.
 * Each repo is a real git repository. Tokens are repo-scoped and enforced here.
 * Plaintexts live only in this gitignored directory.
 */
export class LocalStore implements RepoStore {
  readonly kind = "local" as const;

  constructor(private readonly root: string) {}

  async create(
    name: string,
    opts?: { description?: string; readOnly?: boolean; defaultBranch?: string },
  ): Promise<CreatedRepo> {
    assertName(name);
    const meta = await this.readMeta();
    if (meta.repos[name]) throw new Error(`Repository ${name} already exists`);
    const dir = this.repoDir(name);
    await mkdir(dir, { recursive: true });
    await git(["init", "-b", opts?.defaultBranch ?? "main"], dir);
    const id = `repo_${randomBytes(6).toString("hex")}`;
    meta.repos[name] = {
      id,
      description: opts?.description ?? null,
      readOnly: opts?.readOnly ?? false,
      forkedFrom: null,
    };
    const token = mint(name, "write", 3600);
    meta.tokens.push(token);
    await this.writeMeta(meta);
    return { ...this.toInfo(name, meta), token: token.plaintext };
  }

  async list(): Promise<RepoInfo[]> {
    const meta = await this.readMeta();
    return Object.keys(meta.repos)
      .sort()
      .map((name) => this.toInfo(name, meta));
  }

  async info(name: string): Promise<RepoInfo> {
    const meta = await this.readMeta();
    if (!meta.repos[name]) throw new StrataError(`Repository ${name} was not found`, "not_found");
    return this.toInfo(name, meta);
  }

  async delete(name: string): Promise<void> {
    const meta = await this.readMeta();
    if (!meta.repos[name]) return;
    delete meta.repos[name];
    meta.tokens = meta.tokens.filter((token) => token.repo !== name);
    await this.writeMeta(meta);
    await rm(this.repoDir(name), { recursive: true, force: true });
  }

  async fork(
    source: string,
    name: string,
    opts?: { description?: string; readOnly?: boolean; defaultBranchOnly?: boolean },
  ): Promise<CreatedRepo> {
    assertName(name);
    const meta = await this.readMeta();
    if (!meta.repos[source]) throw new StrataError(`Repository ${source} was not found`, "not_found");
    if (meta.repos[name]) throw new Error(`Repository ${name} already exists`);
    const dest = this.repoDir(name);
    await mkdir(path.dirname(dest), { recursive: true });
    await git(["clone", "--local", this.repoDir(source), dest], this.root);
    if (opts?.defaultBranchOnly) {
      const branch = (await git(["branch", "--show-current"], dest)).trim() || "main";
      const others = (await git(["for-each-ref", "--format=%(refname:short)", "refs/heads"], dest))
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && line !== branch);
      for (const other of others) await git(["branch", "-D", other], dest);
    }
    const id = `repo_${randomBytes(6).toString("hex")}`;
    meta.repos[name] = {
      id,
      description: opts?.description ?? meta.repos[source].description,
      readOnly: opts?.readOnly ?? false,
      forkedFrom: source,
    };
    const token = mint(name, "write", 3600);
    meta.tokens.push(token);
    await this.writeMeta(meta);
    return { ...this.toInfo(name, meta), token: token.plaintext };
  }

  async createToken(repo: string, scope: TokenScope = "write", ttlSeconds = 3600): Promise<TokenResult> {
    const meta = await this.readMeta();
    if (!meta.repos[repo]) throw new StrataError(`Repository ${repo} was not found`, "not_found");
    const token = mint(repo, scope, ttlSeconds);
    meta.tokens.push(token);
    await this.writeMeta(meta);
    return publicToken(token);
  }

  async listTokens(repo: string) {
    const meta = await this.readMeta();
    return meta.tokens
      .filter((token) => token.repo === repo)
      .map(({ plaintext: _plaintext, ...rest }) => rest);
  }

  async revokeToken(repo: string, tokenOrId: string): Promise<void> {
    const meta = await this.readMeta();
    const token = meta.tokens.find(
      (item) => item.repo === repo && (item.id === tokenOrId || item.plaintext === tokenOrId),
    );
    if (!token) throw new StrataError("Token was not found", "not_found");
    token.state = "revoked";
    await this.writeMeta(meta);
  }

  async log(repo: string, opts: { ref?: string; limit?: number; offset?: number } | undefined, token: string) {
    this.useToken(await this.readMeta(), token, repo, "read");
    const ref = opts?.ref ?? "main";
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    let raw = "";
    try {
      raw = await git(
        ["log", `--max-count=${limit}`, `--skip=${offset}`, "--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%P%x1f%T%x1f%s", ref],
        this.repoDir(repo),
      );
    } catch (error) {
      if (isMissingRef(error)) return [];
      throw error;
    }
    return raw
      .split("\n")
      .filter(Boolean)
      .map(parseLogLine);
  }

  async readCommit(repo: string, hash: string, token: string): Promise<CommitMeta | null> {
    this.useToken(await this.readMeta(), token, repo, "read");
    try {
      const line = await git(
        ["log", "-1", "--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%P%x1f%T%x1f%s", hash],
        this.repoDir(repo),
      );
      return parseLogLine(line.trim());
    } catch (error) {
      if (isMissingRef(error)) return null;
      throw error;
    }
  }

  async readTree(repo: string, hash: string, token: string): Promise<TreeEntry[] | null> {
    this.useToken(await this.readMeta(), token, repo, "read");
    try {
      const raw = await git(["ls-tree", hash], this.repoDir(repo));
      if (!raw.trim()) {
        const exists = await objectExists(this.repoDir(repo), hash);
        return exists ? [] : null;
      }
      return raw
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const match = line.match(/^(\d+)\s+(blob|tree)\s+([0-9a-f]+)\t(.+)$/);
          if (!match) throw new Error(`Unexpected ls-tree line: ${line}`);
          return { mode: match[1], type: match[2] as "blob" | "tree", hash: match[3], name: match[4] };
        });
    } catch (error) {
      if (isMissingRef(error)) return null;
      throw error;
    }
  }

  async readBlob(repo: string, hash: string, token: string): Promise<Uint8Array | null> {
    this.useToken(await this.readMeta(), token, repo, "read");
    try {
      return await gitBuffer(["cat-file", "blob", hash], this.repoDir(repo));
    } catch (error) {
      if (isMissingRef(error)) return null;
      throw error;
    }
  }

  async readFile(repo: string, args: { ref: string; path: string }, token: string): Promise<FileBlob | null> {
    if (!args.ref || !args.path) throw new StrataError("ref and path are required", "invalid_token");
    this.useToken(await this.readMeta(), token, repo, "read");
    try {
      const bytes = await gitBuffer(["show", `${args.ref}:${args.path}`], this.repoDir(repo));
      return { bytes, contentType: contentType(args.path) };
    } catch (error) {
      if (isMissingRef(error)) return null;
      throw error;
    }
  }

  async listFiles(repo: string, ref: string, token: string): Promise<string[]> {
    this.useToken(await this.readMeta(), token, repo, "read");
    try {
      const raw = await git(["ls-tree", "-r", "--name-only", ref], this.repoDir(repo));
      return raw.split("\n").filter(Boolean);
    } catch (error) {
      if (isMissingRef(error)) return [];
      throw error;
    }
  }

  async commit(repo: string, token: string, request: CommitRequest): Promise<CommitMeta> {
    const meta = await this.readMeta();
    const stored = this.useToken(meta, token, repo, "write");
    if (meta.repos[repo]?.readOnly) {
      throw new StrataError("Insufficient permissions. This repository is read-only.", "insufficient_permissions");
    }
    if (stored.scope !== "write") {
      throw new StrataError(
        "Insufficient permissions. This token is read-only.",
        "insufficient_permissions",
      );
    }
    const dir = this.repoDir(repo);
    for (const file of request.files) {
      const full = path.join(dir, file.path);
      if (!full.startsWith(dir)) throw new Error(`Refusing to write ${file.path}`);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, file.content);
    }
    await git(["add", "-A"], dir);
    const status = await git(["status", "--porcelain"], dir);
    if (!status.trim()) throw new Error("Nothing to commit");
    await git(["commit", "-m", request.message], dir, {
      GIT_AUTHOR_NAME: request.author.name,
      GIT_AUTHOR_EMAIL: request.author.email,
      GIT_AUTHOR_DATE: request.author.date,
      GIT_COMMITTER_NAME: request.author.name,
      GIT_COMMITTER_EMAIL: request.author.email,
      GIT_COMMITTER_DATE: request.author.date,
    });
    const head = await this.log(repo, { limit: 1 }, token);
    return head[0];
  }

  private repoDir(name: string): string {
    return path.join(this.root, "repos", name);
  }

  private metaPath(): string {
    return path.join(this.root, "meta.json");
  }

  private async readMeta(): Promise<MetaFile> {
    try {
      return JSON.parse(await readFile(this.metaPath(), "utf8")) as MetaFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { repos: {}, tokens: [] };
      throw error;
    }
  }

  private async writeMeta(meta: MetaFile): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.metaPath(), `${JSON.stringify(meta, null, 2)}\n`);
  }

  private toInfo(name: string, meta: MetaFile): RepoInfo {
    const row = meta.repos[name];
    return {
      id: row.id,
      name,
      description: row.description,
      defaultBranch: "main",
      readOnly: row.readOnly,
      remote: `file://${this.repoDir(name)}`,
      forkedFrom: row.forkedFrom,
    };
  }

  private useToken(meta: MetaFile, plaintext: string, repo: string, need: TokenScope): StoredToken {
    const token = meta.tokens.find((item) => item.plaintext === plaintext);
    if (!token) throw new StrataError("Token was not recognized", "invalid_token");
    if (token.repo !== repo) {
      throw new StrataError(
        `This token is scoped to ${token.repo}, not ${repo}.`,
        "wrong_repo",
      );
    }
    if (token.state === "revoked") throw new StrataError("This token has been revoked.", "token_revoked");
    if (Date.parse(token.expiresAt) <= Date.now()) {
      throw new StrataError(`This token expired at ${token.expiresAt}.`, "token_expired");
    }
    if (need === "write" && token.scope !== "write") {
      throw new StrataError("Insufficient permissions. This token is read-only.", "insufficient_permissions");
    }
    return token;
  }
}

function mint(repo: string, scope: TokenScope, ttlSeconds: number): StoredToken {
  const id = randomBytes(8).toString("hex");
  const secret = `local${randomBytes(16).toString("hex")}`;
  const expires = new Date(Date.now() + ttlSeconds * 1000);
  return {
    id,
    plaintext: `art_v1_${secret}?expires=${Math.floor(expires.getTime() / 1000)}`,
    scope,
    expiresAt: expires.toISOString(),
    repo,
    state: "active",
  };
}

function publicToken(token: StoredToken): TokenResult {
  return {
    id: token.id,
    plaintext: token.plaintext,
    scope: token.scope,
    expiresAt: token.expiresAt,
    repo: token.repo,
  };
}

function assertName(name: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) {
    throw new Error(`Repository name ${name} is not a lowercase Artifacts-style name`);
  }
}

function parseLogLine(line: string): CommitMeta {
  const [hash, authorName, authorEmail, date, parents, tree, message] = line.split("\x1f");
  return {
    hash,
    authorName,
    authorEmail,
    date,
    parents: parents ? parents.split(" ").filter(Boolean) : [],
    tree,
    message,
  };
}

async function objectExists(dir: string, hash: string): Promise<boolean> {
  try {
    await git(["cat-file", "-t", hash], dir);
    return true;
  } catch {
    return false;
  }
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".json") || filePath.endsWith(".jsonl")) return "application/json;charset=utf-8";
  if (filePath.endsWith(".md")) return "text/markdown;charset=utf-8";
  return "text/plain;charset=utf-8";
}

function isMissingRef(error: unknown): boolean {
  const stderr = String((error as { stderr?: string }).stderr ?? error ?? "");
  return /unknown revision|exists on disk|does not exist|bad revision|Not a valid object|invalid object/i.test(stderr);
}

async function git(args: string[], cwd: string, extra: Record<string, string> = {}): Promise<string> {
  const { stdout } = await exec("git", gitPrefix().concat(args), {
    cwd,
    env: { ...process.env, ...extra },
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

async function gitBuffer(args: string[], cwd: string): Promise<Uint8Array> {
  const { stdout } = await exec("git", gitPrefix().concat(args), {
    cwd,
    env: process.env,
    encoding: "buffer",
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

function gitPrefix(): string[] {
  return [
    "-c",
    "safe.directory=*",
    "-c",
    "user.name=Strata",
    "-c",
    "user.email=strata@localhost",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.autocrlf=false",
  ];
}
