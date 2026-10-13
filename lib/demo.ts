import { rm } from "node:fs/promises";
import path from "node:path";
import { AGENT_SPECS, planAgent, type AgentSpec } from "./agents";
import { commitAsAgent } from "./governance";
import { loadPyramid } from "./load";
import { narrateAnswers } from "./llm";
import { Navigator } from "./navigator";
import { profileBodyLength } from "./contract";
import { buildTrail, type Origin } from "./provenance";
import { answerQuestions } from "./questions";
import { reconcile } from "./reconcile";
import { ENGAGEMENT_REPO, IDS, seedLayers } from "./sample";
import { normalize } from "./text";
import { driverFromEnv, openStore } from "./store/open";
import { StrataError, type RepoStore } from "./store/types";
import type {
  AgentReport,
  DemoSnapshot,
  IncomingBatch,
  LayerCommit,
  MemoryRecord,
  ProvenanceTrail,
} from "./types";

const FORK_SUFFIX: Record<AgentSpec["id"], string> = {
  evidence: "evidence",
  competitor: "competitor",
  "section-writer": "section",
  "what-if": "what-if",
};

export interface DemoOptions {
  root: string;
  driver?: "local" | "cloudflare";
  llm?: boolean;
}

export async function runDemo(options: DemoOptions): Promise<DemoSnapshot> {
  const driver = options.driver ?? "local";
  if (driver === "local") await rm(options.root, { recursive: true, force: true });
  const store = openStore(driver, options.root);
  const repoNames = [ENGAGEMENT_REPO, ...AGENT_SPECS.map((spec) => forkName(spec.id))];
  if (driver === "cloudflare") {
    for (const name of [...repoNames].reverse()) {
      try {
        await store.delete(name);
      } catch {
        // The demo replaces its own repo names. A missing repo is fine.
      }
    }
  }

  const created = await store.create(ENGAGEMENT_REPO, {
    description: "Northwind Lanterns dusk-sensor engagement (synthetic)",
    defaultBranch: "main",
  });
  const layerCommits = await seedEngagement(store, created.name, created.token);
  const seeded = await loadPyramid(store, created.name, created.token);
  const questions = answerQuestions(new Navigator(seeded));
  const governance = await governanceReceipt(store, created.name);

  const forks = [];
  for (const spec of AGENT_SPECS) {
    const forked = await forkWithRetry(store, created.name, forkName(spec.id), {
      description: `${spec.label} fork of ${created.name}`,
      defaultBranchOnly: true,
    });
    const read = await store.createToken(forked.name, "read", 3600);
    forks.push({ spec, repo: forked.name, writeToken: forked.token, readToken: read.plaintext });
  }

  let remaining = forks.length;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const runs = await Promise.all(
    forks.map(async (fork) => {
      const start = Date.now();
      remaining -= 1;
      if (remaining === 0) release();
      await gate;
      const pyramid = await loadPyramid(store, fork.repo, fork.readToken);
      const plan = planAgent(fork.spec.id, new Navigator(pyramid), pyramid.files);
      const committed = await commitAsAgent({
        store,
        repo: fork.repo,
        token: fork.writeToken,
        agentId: fork.spec.id,
        writes: plan.writes,
        message: fork.spec.message,
        author: {
          name: fork.spec.person,
          email: fork.spec.email,
          date: "2026-09-19T16:00:00Z",
        },
      });
      const report: AgentReport = {
        id: fork.spec.id,
        label: fork.spec.label,
        person: fork.spec.person,
        repo: fork.repo,
        compareOnly: fork.spec.compareOnly,
        start,
        end: Date.now(),
        commit: committed.commit?.hash ?? null,
        commitMessage: committed.commit?.message ?? null,
        addedRecordIds: plan.addedRecordIds,
        committedPaths: committed.committed.map((file) => file.path),
        violations: committed.violations,
        trace: plan.trace,
        note: fork.spec.note,
      };
      return { fork, plan, report, pyramid };
    }),
  );

  const baseToken = await store.createToken(created.name, "read", 3600);
  const base = await loadPyramid(store, created.name, baseToken.plaintext);
  const batches: IncomingBatch[] = [];
  for (const run of runs) {
    const current = await loadPyramid(store, run.fork.repo, run.fork.readToken);
    const novel = current.records.filter((record) => {
      const prior = base.records.find((item) => item.id === record.id);
      return !prior || normalize(prior.content) !== normalize(record.content);
    });
    const files = [];
    for (const [filePath, content] of current.files) {
      if (filePath.startsWith("records/") || filePath === "contract.json") continue;
      if (base.files.get(filePath) !== content) files.push({ path: filePath, content });
    }
    batches.push({
      agent: run.fork.spec.id,
      repo: run.fork.repo,
      commit: run.report.commit,
      compareOnly: run.fork.spec.compareOnly,
      records: novel,
      files,
    });
  }

  const merged = reconcile({
    contract: base.contract,
    baseRecords: base.records,
    baseFiles: base.files,
    batches,
  });

  const violations = runs.flatMap((run) => run.report.violations);
  const manifest = {
    version: 1,
    note: "Record-level reconcile. Conflicting claims stay on the record for a person to review. Strata does not pick a winner.",
    folds: merged.folds,
    conflicts: merged.conflicts,
    comparisons: merged.comparisons,
    added: merged.added.map((record) => record.id),
    promotions: merged.promotions,
    refusals: [...merged.refusals, ...violations],
    profile_action: merged.profileAction,
  };
  const writeToken = await store.createToken(created.name, "write", 3600);
  const reconcileCommit = await commitAsAgent({
    store,
    repo: created.name,
    token: writeToken.plaintext,
    agentId: "reconciler",
    writes: [
      ...merged.files,
      { path: "reconcile/manifest.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
    ],
    message: "Reconcile forks at the record layer",
    author: {
      name: "Strata Reconciler",
      email: "reconciler@strata.localhost",
      date: "2026-09-19T17:00:00Z",
    },
  });
  if (reconcileCommit.violations.length > 0) {
    throw new Error(`Reconciler was refused: ${reconcileCommit.violations.map((item) => item.path).join(", ")}`);
  }

  const finalPyramid = await loadPyramid(store, created.name, baseToken.plaintext);
  const history = await store.log(created.name, { ref: "main", limit: 20 }, baseToken.plaintext);
  const origins = new Map<string, Origin>();
  for (const run of runs) {
    if (!run.report.commit) continue;
    for (const id of run.plan.addedRecordIds) {
      origins.set(id, {
        agent: run.fork.spec.id,
        repo: run.fork.repo,
        commit: run.report.commit,
        message: run.report.commitMessage ?? "",
      });
    }
  }
  const l1 = layerCommits.find((commit) => commit.layer === "L1");
  if (!l1) throw new Error("L1 commit is missing");
  for (const record of finalPyramid.records) {
    if (!origins.has(record.id)) {
      origins.set(record.id, {
        agent: record.agent,
        repo: created.name,
        commit: l1.hash,
        message: l1.message,
      });
    }
  }

  const promoted = reconcileCommit.commit
    ? {
        repo: created.name,
        commit: reconcileCommit.commit.hash,
        message: reconcileCommit.commit.message,
      }
    : null;
  const present = new Set(finalPyramid.records.map((record) => record.id));
  const trails: ProvenanceTrail[] = [];
  const seenTrail = new Set<string>();
  const trailFor = (record: MemoryRecord) => {
    if (seenTrail.has(record.id)) return;
    seenTrail.add(record.id);
    const origin = origins.get(record.id) ?? null;
    if (origin && !origins.has(record.id)) origins.set(record.id, origin);
    trails.push(
      buildTrail(
        finalPyramid,
        record,
        origins,
        present.has(record.id) && origin && origin.repo !== created.name ? promoted : null,
      ),
    );
  };
  for (const record of finalPyramid.records) trailFor(record);
  for (const comparison of merged.comparisons) {
    for (const record of comparison.records) {
      if (!present.has(record.id)) trailFor(record);
    }
  }

  const starts = runs.map((run) => run.report.start);
  const ends = runs.map((run) => run.report.end);
  const narration = options.llm ? await narrateAnswers(questions.map((item) => ({ question: item.question, answer: item.answer }))) : null;
  const info = await store.info(created.name);

  const snapshot: DemoSnapshot = {
    generated_at: new Date().toISOString(),
    driver,
    mocked: driver === "local",
    repo_path: info.remote,
    engagement: {
      repo: created.name,
      client: base.contract.client.name,
      title: "Dusk-sensor brief",
      note: base.contract.client.note,
    },
    contract: base.contract,
    layer_commits: layerCommits,
    history,
    questions,
    narration,
    agents: runs.map((run) => run.report),
    concurrency: {
      overlap: Math.max(...starts) < Math.min(...ends),
      agents: runs.length,
      window_start: Math.min(...starts),
      window_end: Math.max(...ends),
    },
    governance_receipt: governance,
    reconcile: {
      folds: merged.folds,
      conflicts: merged.conflicts,
      comparisons: merged.comparisons,
      added: merged.added.map((record) => record.id),
      promotions: merged.promotions,
      refusals: [...merged.refusals, ...violations],
      profile_action: merged.profileAction,
      profile_chars: finalPyramid.profile.chars,
      profile_budget: base.contract.layers.L3.max_chars,
      commit: reconcileCommit.commit?.hash ?? null,
    },
    pyramid: {
      profile_body: finalPyramid.profile.body,
      profile_chars: finalPyramid.profile.chars,
      tracks: finalPyramid.tracks,
      records: finalPyramid.records,
      messages: finalPyramid.messages,
      sources: finalPyramid.sources,
      raw_files: [...finalPyramid.files.keys()].filter((filePath) => filePath.startsWith("raw/")).sort(),
      counts: {
        L0: [...finalPyramid.files.keys()].filter((filePath) => filePath.startsWith("raw/")).length,
        L1: finalPyramid.records.length,
        L2: finalPyramid.tracks.length,
        L3: 1,
      },
    },
    provenance: trails,
  };

  assertDemo(snapshot);
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(options.root, { recursive: true });
  await writeFile(path.join(options.root, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}

export async function seedEngagement(store: RepoStore, repo: string, token: string): Promise<LayerCommit[]> {
  const commits: LayerCommit[] = [];
  const layers = seedLayers();
  for (const [index, layer] of layers.entries()) {
    const commit = await store.commit(repo, token, {
      message: layer.message,
      author: {
        name: "Iona Blake",
        email: "iona.blake@northwind.example",
        date: `2026-09-18T15:0${index}:00Z`,
      },
      files: Object.entries(layer.files).map(([filePath, content]) => ({ path: filePath, content })),
    });
    commits.push({ hash: commit.hash, message: commit.message, layer: layer.layer });
  }
  const profile = layers.find((layer) => layer.layer === "L3")?.files["profile.md"] ?? "";
  const budget = JSON.parse(layers[0].files["contract.json"]).layers.L3.max_chars as number;
  const chars = profileBodyLength(profile);
  if (chars > budget) throw new Error(`Seed profile is ${chars} characters. Budget is ${budget}.`);
  return commits;
}

export function defaultRoot(): string {
  return path.join(process.cwd(), ".demo");
}

export function assertDemo(snapshot: DemoSnapshot): void {
  if (snapshot.agents.length < 3) throw new Error("Expected at least three agents");
  if (!snapshot.concurrency.overlap) throw new Error("Agent runs did not overlap");
  if (!snapshot.governance_receipt.read_ok || !snapshot.governance_receipt.read_commit_refused) {
    throw new Error("Read token did not behave as read-only");
  }
  if (snapshot.layer_commits.length !== 5) throw new Error("Expected one commit per layer, plus the contract");
  const conflict = snapshot.reconcile.conflicts.find((item) => item.claim_key === "competitor.harbor.price");
  if (!conflict || conflict.records.length < 2) throw new Error("Harbor price conflict was not flagged");
  const comparison = snapshot.reconcile.comparisons.find((item) => item.claim_key === "decision.price_cut");
  if (!comparison) throw new Error("What-if price cut was not compared");
  if (snapshot.pyramid.records.some((record) => record.id === IDS.recClaimCutRecommended)) {
    throw new Error("What-if claim was merged");
  }
  if (snapshot.pyramid.records.some((record) => record.id === IDS.recClaimPriceEcho)) {
    throw new Error("Duplicate price claim was not folded");
  }
  if (!snapshot.reconcile.folds.some((fold) => fold.folded_id === IDS.recClaimPriceEcho)) {
    throw new Error("Expected the evidence-lane price claim to fold");
  }
  const listed = snapshot.pyramid.records.find((record) => record.id === IDS.recClaimPrice86);
  if (!listed || listed.status !== "contested") throw new Error("Listed price was not kept as contested");
  const instruction = snapshot.pyramid.records.find((record) => record.id === IDS.recInsNoCut);
  if (!instruction?.content.includes("must not")) throw new Error("Instruction record was rewritten");
  const violations = snapshot.agents.flatMap((agent) => agent.violations);
  for (const pathName of ["profile.md", "raw/calls/call-001.json", "records/instruction.jsonl"]) {
    if (!violations.some((violation) => violation.path === pathName)) {
      throw new Error(`Expected a contract refusal for ${pathName}`);
    }
  }
  if (snapshot.reconcile.profile_chars > snapshot.reconcile.profile_budget) {
    throw new Error("Profile exceeds its budget");
  }
  if (snapshot.reconcile.profile_action !== "unchanged") throw new Error("Profile should have stayed unchanged");
  for (const question of snapshot.questions) {
    if (question.citations.length === 0) throw new Error(`${question.id} has no citations`);
  }
  const trail = snapshot.provenance.find((item) => item.record_id === IDS.recClaimPrice86);
  if (!trail?.steps.some((step) => step.kind === "snapshot")) throw new Error("Price claim has no source hash");
  if (!trail.steps.some((step) => step.kind === "commit")) throw new Error("Price claim has no authoring commit");
  const decision = snapshot.pyramid.tracks.find((track) => track.id === "decision");
  if (!decision?.record_ids.includes(IDS.recInsNoCut)) throw new Error("Decision track lost the instruction");
  if (!decision.body.includes("must not recommend a price cut")) {
    throw new Error("Decision track dropped the instruction");
  }
}

async function governanceReceipt(store: RepoStore, repo: string): Promise<DemoSnapshot["governance_receipt"]> {
  const read = await store.createToken(repo, "read", 3600);
  const file = await store.readFile(repo, { ref: "main", path: "profile.md" }, read.plaintext);
  let refusal = "";
  let refused = false;
  try {
    await store.commit(repo, read.plaintext, {
      message: "Read token must not commit",
      author: { name: "Strata", email: "strata@localhost", date: "2026-09-18T18:00:00Z" },
      files: [{ path: "profile.md", content: "rewritten by a read token\n" }],
    });
  } catch (error) {
    refused = error instanceof StrataError && error.code === "insufficient_permissions";
    refusal = error instanceof Error ? error.message : String(error);
  }
  return {
    read_token_id: read.id,
    read_ok: Boolean(file && file.bytes.byteLength > 0),
    read_commit_refused: refused,
    refusal_message: refusal,
  };
}

async function forkWithRetry(
  store: RepoStore,
  source: string,
  name: string,
  opts: { description?: string; defaultBranchOnly?: boolean },
) {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await store.fork(source, name, opts);
    } catch (error) {
      last = error;
      const message = error instanceof Error ? error.message : "";
      if (store.kind !== "cloudflare" || !/409|forking|not ready/i.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw last;
}

function forkName(id: AgentSpec["id"]): string {
  return `${ENGAGEMENT_REPO}--${FORK_SUFFIX[id]}`;
}

export { driverFromEnv };
