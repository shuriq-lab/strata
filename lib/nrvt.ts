/**
 * nrvt-storm-week: five towns on the Norwalk River Valley Trail share one collective
 * memory repo. Each town agent writes on its own fork, concurrently. All amounts,
 * IDs, readings, and people in this scenario are illustrative, not real NRVT data.
 */
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { commitAsAgent } from "./governance";
import { openStore } from "./store/open";
import { StrataError, type RepoStore } from "./store/types";
import type { Violation } from "./types";

export const NRVT_REPO = "nrvt-collective";
export const ILLUSTRATIVE = "Illustrative scenario. Amounts, IDs, readings, and names are invented, not NRVT data.";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const jl = (rows: object[]) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";

export interface NrvtClaim {
  id: string;
  town: string;
  key: string;
  stance: string;
  text: string;
  source: string;
  observed: string;
  cost_usd?: number;
  crew_days?: number;
}
export interface NrvtSource { id: string; town: string; kind: string; text: string; sha256: string; uri: string }

type Lane = {
  id: string;
  town: string;
  suffix: string;
  person: string;
  compareOnly?: boolean;
  claims: NrvtClaim[];
  sources: Omit<NrvtSource, "sha256">[];
  extra?: { path: string; content: string }[];
  message: string;
};

function source(s: Omit<NrvtSource, "sha256">): NrvtSource {
  return { ...s, sha256: sha(s.text) };
}

export function nrvtContract() {
  const town = (id: string, label: string, compare = false) => ({
    id,
    label,
    compare_only: compare,
    may_write: compare ? ["whatif/"] : [`records/${id}/`, `raw/${id}/`, `tracks/${id}.md`],
    may_promote: compare ? [] : [`records/${id}/`, `raw/${id}/`, `tracks/${id}.md`],
  });
  return {
    contract_version: "1",
    kind: "strata.collective",
    purpose: "Shared trail memory for five towns. Each town writes only its own records.",
    client: { name: "NRVT corridor (illustrative)", engagement: "nrvt-storm-week", note: ILLUSTRATIVE },
    layers: {
      L0: { path: "raw/", append_only: true, description: "Sensor snapshots, forms, inspection notes" },
      L1: { path: "records/", format: "jsonl", types: ["claim", "source"] },
      L2: { path: "tracks/", format: "markdown" },
      L3: { path: "summary.md", format: "markdown", max_chars: 1200 },
    },
    agents: [
      town("norwalk", "Norwalk agent"),
      town("wilton", "Wilton agent"),
      town("ridgefield", "Ridgefield agent"),
      town("redding", "Redding agent"),
      town("danbury", "Danbury agent"),
      town("norwalk-whatif", "Norwalk what-if: evening hours", true),
      { id: "reconciler", label: "Strata reconciler", may_write: ["records/", "raw/", "tracks/", "conflicts/", "reconcile/"], may_promote: [] },
      { id: "steward", label: "Trail steward (human)", may_write: ["decisions/", "summary.md"], may_promote: [] },
    ],
    rules: [
      "A town agent writes only records/<town>/ and tracks/<town>.md.",
      "Conflicting claims stay open until a person decides.",
      "What-if forks are compared, never merged.",
      "Only the human steward writes decisions/ and summary.md.",
    ],
  };
}

export function lanes(): Lane[] {
  const S = {
    rdgGauge: { id: "src-rdg-gauge07-0640", town: "redding", kind: "sensor", uri: "synthetic://nrvt/redding/gauge-07/2026-09-18T06:40", text: "Gauge 07, segment R4 near the Ridgefield line. Water depth 31 cm across trail at 06:40. Rising since 03:10." },
    rfdForm: { id: "src-rfd-form-0412", town: "ridgefield", kind: "resident", uri: "synthetic://nrvt/ridgefield/forms/0412", text: "Resident form 0412, 07:15. Walked R4 from the Ridgefield side. Wet but passable, water below the boardwalk edge." },
    wilPhoto: { id: "src-wil-photo-w2", town: "wilton", kind: "photo", uri: "synthetic://nrvt/wilton/photos/w2-rail.jpg.txt", text: "Photo log W2 boardwalk, 08:02. Two railing posts loose after debris strike." },
    dbyInspect: { id: "src-dby-inspect-d1", town: "danbury", kind: "crew", uri: "synthetic://nrvt/danbury/inspections/d1", text: "Crew inspection D1 trailhead, 09:30. Gravel washout 12 m long, 40 cm deep at the culvert outlet." },
    nwkTicket: { id: "src-nwk-311-5521", town: "norwalk", kind: "ticket", uri: "synthetic://nrvt/norwalk/311/5521", text: "311 ticket 5521. Two path lights out at N3 since the storm. Reported 10:05." },
    nwkCounts: { id: "src-nwk-counter-n3", town: "norwalk", kind: "sensor", uri: "synthetic://nrvt/norwalk/counter-n3/summer", text: "Counter N3, summer weekdays. 18:00 to 20:00 averages 140 people per hour. Counts drop to near zero after dusk." },
  };
  return [
    {
      id: "redding", town: "Redding", suffix: "redding", person: "Redding agent",
      claims: [{ id: "clm-rdg-r4-flooded", town: "redding", key: "segment.R4.condition", stance: "impassable", text: "Segment R4 near the Ridgefield line is under 31 cm of water and impassable.", source: S.rdgGauge.id, observed: "06:40", cost_usd: 22000, crew_days: 3 }],
      sources: [S.rdgGauge], message: "Redding: gauge 07 reports R4 flooded",
    },
    {
      id: "ridgefield", town: "Ridgefield", suffix: "ridgefield", person: "Ridgefield agent",
      claims: [{ id: "clm-rfd-r4-passable", town: "ridgefield", key: "segment.R4.condition", stance: "passable", text: "A resident walked R4 at 07:15 and reports it wet but passable.", source: S.rfdForm.id, observed: "07:15" }],
      sources: [S.rfdForm], message: "Ridgefield: resident reports R4 passable",
    },
    {
      id: "wilton", town: "Wilton", suffix: "wilton", person: "Wilton agent",
      claims: [{ id: "clm-wil-w2-railing", town: "wilton", key: "segment.W2.railing", stance: "damaged", text: "Two railing posts on the W2 boardwalk are loose.", source: S.wilPhoto.id, observed: "08:02", cost_usd: 4000, crew_days: 1 }],
      sources: [S.wilPhoto],
      extra: [{ path: "records/redding/claims.jsonl", content: jl([{ id: "clm-rdg-r4-flooded", town: "redding", key: "segment.R4.condition", stance: "passable", text: "Corrected by Wilton: R4 is passable.", source: "none", observed: "08:10" }]) }],
      message: "Wilton: W2 railing damage (and an attempt to correct Redding)",
    },
    {
      id: "danbury", town: "Danbury", suffix: "danbury", person: "Danbury agent",
      claims: [{ id: "clm-dby-d1-washout", town: "danbury", key: "segment.D1.surface", stance: "washout", text: "The D1 trailhead has a 12 m gravel washout at the culvert outlet.", source: S.dbyInspect.id, observed: "09:30", cost_usd: 12000, crew_days: 2 }],
      sources: [S.dbyInspect], message: "Danbury: D1 washout from crew inspection",
    },
    {
      id: "norwalk", town: "Norwalk", suffix: "norwalk", person: "Norwalk agent",
      claims: [{ id: "clm-nwk-n3-lights", town: "norwalk", key: "segment.N3.lighting", stance: "out", text: "Two path lights are out at N3.", source: S.nwkTicket.id, observed: "10:05", cost_usd: 2500, crew_days: 1 }],
      sources: [S.nwkTicket], message: "Norwalk: N3 lights out",
    },
    {
      id: "norwalk-whatif", town: "Norwalk", suffix: "norwalk-whatif", person: "Norwalk what-if agent", compareOnly: true,
      claims: [{ id: "clm-nwk-hours-2100", town: "norwalk", key: "policy.hours.close", stance: "21:00", text: "Close the Norwalk section at 21:00 instead of dusk. Projected 260 extra evening visits per week; needs N3 lights working.", source: S.nwkCounts.id, observed: "projection" }],
      sources: [S.nwkCounts],
      extra: [{ path: "whatif/evening-hours.json", content: JSON.stringify({ proposal: "Close at 21:00", baseline: "dusk", projected_extra_visits_per_week: 260, depends_on: ["clm-nwk-n3-lights"], note: ILLUSTRATIVE }, null, 2) + "\n" }],
      message: "What-if: Norwalk evening hours to 21:00",
    },
  ];
}

export interface NrvtSnapshot {
  generated_at: string;
  driver: string;
  note: string;
  repo: string;
  forks: string[];
  seed: { hash: string; message: string }[];
  agents: { id: string; repo: string; person: string; start: number; end: number; commit: string | null; committed: string[]; violations: Violation[]; compareOnly: boolean }[];
  overlap: boolean;
  promoted: string[];
  conflicts: { id: string; key: string; claims: NrvtClaim[] }[];
  comparison: { fork: string; key: string; proposal: string; baseline: string; projected: number; merged: false };
  reconcile_commit: string;
  receipt: { read_ok: boolean; refused: boolean; status: number | null; message: string };
  decision: { id: string; commit: string; author: string; budget_usd: number; crew_days: number; allocations: { claim: string; usd: number; crew_days: number; why: string }[]; hours: string; resolves: string[]; cites: string[]; rationale: string };
  provenance: { claim: string; source: string; sha256: string; uri: string; fork: string; fork_commit: string; promoted_in: string; cited_by: string }[];
  history: { hash: string; message: string }[];
  summary: string;
}

export async function runNrvt(opts: { root: string; driver: "local" | "cloudflare" }): Promise<NrvtSnapshot> {
  if (opts.driver === "local") await rm(opts.root, { recursive: true, force: true });
  const store = openStore(opts.driver, opts.root);
  const L = lanes();
  const forkName = (suffix: string) => `${NRVT_REPO}--${suffix}`;
  if (store.kind === "cloudflare") {
    for (const name of [...L.map((lane) => forkName(lane.suffix)), NRVT_REPO]) {
      try { await store.delete(name); } catch { /* missing is fine */ }
    }
  }

  const created = await store.create(NRVT_REPO, { description: "NRVT storm week collective memory (illustrative)", defaultBranch: "main" });
  const author = (name: string, date: string) => ({ name, email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@nrvt.example`, date });
  const seed = [];
  const c1 = await store.commit(NRVT_REPO, created.token, { message: "Contract: each town writes only its own records", author: author("Strata", "2026-09-18T05:00:00Z"), files: [{ path: "contract.json", content: JSON.stringify(nrvtContract(), null, 2) + "\n" }] });
  seed.push({ hash: c1.hash, message: c1.message });
  const c2 = await store.commit(NRVT_REPO, created.token, {
    message: "Summary: corridor baseline before the storm", author: author("Strata", "2026-09-18T05:01:00Z"),
    files: [
      { path: "summary.md", content: `---\ntitle: NRVT corridor summary\n---\n\nAll segments open. No open conflicts. Storm expected overnight.\n\n_${ILLUSTRATIVE}_\n` },
      { path: "records/README.md", content: "Town records live in records/<town>/.\n" },
    ],
  });
  seed.push({ hash: c2.hash, message: c2.message });

  const forks = [];
  for (const lane of L) {
    const forked = await forkWithRetry(store, NRVT_REPO, forkName(lane.suffix));
    const read = await store.createToken(forked.name, "read", 3600);
    forks.push({ lane, repo: forked.name, write: forked.token, read: read.plaintext });
  }

  let remaining = forks.length;
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const runs = await Promise.all(forks.map(async (fork) => {
    remaining -= 1;
    if (remaining === 0) release();
    await gate;
    const start = Date.now();
    const { lane } = fork;
    const sources = lane.sources.map(source);
    const writes = [
      { path: `records/${lane.id}/claims.jsonl`, content: jl(lane.claims) },
      { path: `records/${lane.id}/sources.jsonl`, content: jl(sources) },
      ...sources.map((s) => ({ path: `raw/${lane.id}/${s.id}.txt`, content: s.text + "\n" })),
      ...(lane.extra ?? []),
    ];
    if (lane.compareOnly) {
      // The what-if lane may only write whatif/. Its claim rides inside the proposal.
      writes.splice(0, writes.length, ...(lane.extra ?? []), { path: "whatif/claims.jsonl", content: jl(lane.claims) }, { path: "whatif/sources.jsonl", content: jl(sources) });
    }
    const result = await commitAsAgent({ store, repo: fork.repo, token: fork.write, agentId: lane.id, writes, message: lane.message, author: author(lane.person, "2026-09-18T11:00:00Z") });
    return { fork, sources, start, end: Date.now(), commit: result.commit?.hash ?? null, committed: result.committed.map((w) => w.path), violations: result.violations };
  }));
  const starts = runs.map((r) => r.start), ends = runs.map((r) => r.end);
  const overlap = Math.max(...starts) < Math.min(...ends);

  // Reconcile: promote only paths each town may promote; compare-only forks are compared.
  const contract = nrvtContract();
  const promotedFiles: { path: string; content: string }[] = [];
  const allClaims: NrvtClaim[] = [];
  const allSources: NrvtSource[] = [];
  const origin = new Map<string, { fork: string; commit: string }>();
  let comparison: NrvtSnapshot["comparison"] | null = null;
  for (const run of runs) {
    const agent = contract.agents.find((a) => a.id === run.fork.lane.id)!;
    if (run.fork.lane.compareOnly) {
      const file = await store.readFile(run.fork.repo, { ref: "main", path: "whatif/evening-hours.json" }, run.fork.read);
      const w = JSON.parse(new TextDecoder().decode(file!.bytes));
      comparison = { fork: run.fork.repo, key: "policy.hours.close", proposal: w.proposal, baseline: w.baseline, projected: w.projected_extra_visits_per_week, merged: false };
      for (const c of run.fork.lane.claims) origin.set(c.id, { fork: run.fork.repo, commit: run.commit ?? "" });
      continue;
    }
    for (const p of run.committed) {
      if (!agent.may_promote.some((rule) => (rule.endsWith("/") ? p.startsWith(rule) : p === rule))) continue;
      const f = await store.readFile(run.fork.repo, { ref: "main", path: p }, run.fork.read);
      if (f) promotedFiles.push({ path: p, content: new TextDecoder().decode(f.bytes) });
    }
    allClaims.push(...run.fork.lane.claims);
    allSources.push(...run.sources);
    for (const c of run.fork.lane.claims) origin.set(c.id, { fork: run.fork.repo, commit: run.commit ?? "" });
  }
  const byKey = new Map<string, NrvtClaim[]>();
  for (const c of allClaims) byKey.set(c.key, [...(byKey.get(c.key) ?? []), c]);
  const conflicts = [...byKey.entries()].filter(([, cs]) => new Set(cs.map((c) => c.stance)).size > 1).map(([key, claims]) => ({ id: `cf-${key.split(".")[1]}`, key, claims }));
  const reconcilerToken = await store.createToken(NRVT_REPO, "write", 3600);
  const rec = await commitAsAgent({
    store, repo: NRVT_REPO, token: reconcilerToken.plaintext, agentId: "reconciler",
    writes: [
      ...promotedFiles,
      { path: "conflicts/open.json", content: JSON.stringify(conflicts.map((c) => ({ id: c.id, key: c.key, status: "open", claims: c.claims.map((x) => x.id) })), null, 2) + "\n" },
      { path: "reconcile/manifest.json", content: JSON.stringify({ promoted: promotedFiles.map((f) => f.path), compared_not_merged: comparison, note: "Strata does not pick a winner." }, null, 2) + "\n" },
    ],
    message: "Reconcile town forks: promote records, keep R4 conflict open",
    author: author("Strata Reconciler", "2026-09-18T12:00:00Z"),
  });
  if (!rec.commit || rec.violations.length) throw new Error("Reconciler refused");
  // Read-only receipt.
  const read = await store.createToken(NRVT_REPO, "read", 3600);
  const sum = await store.readFile(NRVT_REPO, { ref: "main", path: "summary.md" }, read.plaintext);
  const receipt = { read_ok: Boolean(sum), refused: false, status: null as number | null, message: "" };
  try {
    await store.commit(NRVT_REPO, read.plaintext, { message: "Read token tries to edit the decision", author: author("Strata", "2026-09-18T12:30:00Z"), files: [{ path: "decisions/forged.json", content: "{}\n" }] });
  } catch (error) {
    receipt.refused = error instanceof StrataError && error.code === "insufficient_permissions";
    receipt.status = error instanceof StrataError ? error.status ?? null : null;
    receipt.message = error instanceof Error ? error.message : String(error);
  }

  // The human steward decides. Budget and crew are illustrative.
  const budget = 30000, crew = 5;
  const allocations = [
    { claim: "clm-rdg-r4-flooded", usd: 18000, crew_days: 3, why: "Gauge shows 31 cm at 06:40 and rising since 03:10. The 07:15 resident report came after the crest. Both stand; the culvert under R4 floods every storm, so fix the cause." },
    { claim: "clm-dby-d1-washout", usd: 9500, crew_days: 2, why: "Crew-verified washout at a trailhead. Safety risk at the entrance." },
    { claim: "clm-nwk-n3-lights", usd: 2500, crew_days: 0, why: "Contractor repair. Required before any evening-hours trial." },
    { claim: "clm-wil-w2-railing", usd: 0, crew_days: 0, why: "Deferred one week. Tape off two posts; next storm-fund cycle." },
  ];
  const decision = {
    id: "dec-storm-0918-01",
    author: "Trail steward (human, illustrative)",
    budget_usd: budget,
    crew_days: crew,
    allocations,
    hours: "Norwalk evening hours to 21:00: not now. Trial for four weeks after the N3 lights pass inspection.",
    resolves: ["cf-R4"],
    cites: ["clm-rdg-r4-flooded", "clm-rfd-r4-passable", "clm-dby-d1-washout", "clm-nwk-n3-lights", "clm-wil-w2-railing", "clm-nwk-hours-2100"],
    rationale: "R4 conflict resolved as both true at different times: flooded at the crest, passable after. Funds go to the recurring R4 culvert and the D1 washout first; lights are cheap and unlock the hours trial.",
    note: ILLUSTRATIVE,
  };
  const summary = `---\ntitle: NRVT corridor summary\n---\n\nStorm week. R4 culvert repair funded (3 crew days). D1 washout repair funded (2 crew days). N3 lights repaired by contractor. W2 railing taped off, deferred one week. Evening hours: trial after lights pass inspection. Decision dec-storm-0918-01.\n\n_${ILLUSTRATIVE}_\n`;
  const stewardToken = await store.createToken(NRVT_REPO, "write", 3600);
  const dec = await commitAsAgent({ store, repo: NRVT_REPO, token: stewardToken.plaintext, agentId: "steward", writes: [{ path: `decisions/${decision.id}.json`, content: JSON.stringify(decision, null, 2) + "\n" }, { path: "summary.md", content: summary }], message: "Steward decision: storm fund and crew allocation, hours ruling", author: author("Trail Steward", "2026-09-18T15:00:00Z") });
  if (!dec.commit) throw new Error("Steward decision was not committed");

  const provenance = decision.cites.map((id) => {
    const claim = [...allClaims, ...L.find((l) => l.compareOnly)!.claims].find((c) => c.id === id)!;
    const src = [...allSources, ...L.flatMap((l) => l.sources.map(source))].find((s) => s.id === claim.source)!;
    const o = origin.get(id)!;
    return { claim: id, source: src.id, sha256: src.sha256, uri: src.uri, fork: o.fork, fork_commit: o.commit, promoted_in: id === "clm-nwk-hours-2100" ? "compared only" : rec.commit!.hash, cited_by: dec.commit!.hash };
  });
  const history = (await store.log(NRVT_REPO, { ref: "main", limit: 20 }, read.plaintext)).map((c) => ({ hash: c.hash, message: c.message }));
  const info = await store.info(NRVT_REPO);
  void info;

  const snap: NrvtSnapshot = {
    generated_at: new Date().toISOString(), driver: store.kind, note: ILLUSTRATIVE, repo: NRVT_REPO,
    forks: forks.map((f) => f.repo), seed,
    agents: runs.map((r) => ({ id: r.fork.lane.id, repo: r.fork.repo, person: r.fork.lane.person, start: r.start, end: r.end, commit: r.commit, committed: r.committed, violations: r.violations, compareOnly: Boolean(r.fork.lane.compareOnly) })),
    overlap, promoted: promotedFiles.map((f) => f.path), conflicts, comparison: comparison!, reconcile_commit: rec.commit.hash, receipt,
    decision: { ...decision, commit: dec.commit.hash }, provenance, history, summary,
  };
  assertNrvt(snap);
  await mkdir(opts.root, { recursive: true });
  await writeFile(path.join(opts.root, "nrvt-snapshot.json"), JSON.stringify(snap, null, 2) + "\n");
  return snap;
}

export function assertNrvt(s: NrvtSnapshot): void {
  if (s.forks.length !== 6) throw new Error("Expected five town forks plus the what-if fork");
  if (!s.overlap) throw new Error("Agent writes did not overlap");
  const r4 = s.conflicts.find((c) => c.key === "segment.R4.condition");
  if (!r4 || r4.claims.length !== 2) throw new Error("R4 conflict was not kept open");
  const wil = s.agents.find((a) => a.id === "wilton")!;
  if (!wil.violations.some((v) => v.path === "records/redding/claims.jsonl")) throw new Error("Wilton was not refused");
  if (s.promoted.includes("whatif/evening-hours.json")) throw new Error("What-if was merged");
  if (!s.comparison || s.comparison.merged !== false) throw new Error("What-if was not compared");
  if (!s.receipt.read_ok || !s.receipt.refused) throw new Error("Read token was not read-only");
  if (s.decision.allocations.reduce((n, a) => n + a.usd, 0) > s.decision.budget_usd) throw new Error("Decision exceeds budget");
  if (s.decision.allocations.reduce((n, a) => n + a.crew_days, 0) > s.decision.crew_days) throw new Error("Decision exceeds crew");
  if (!s.decision.cites.includes("clm-rdg-r4-flooded") || !s.decision.cites.includes("clm-rfd-r4-passable")) throw new Error("Decision does not cite both R4 claims");
  if (s.provenance.some((p) => !p.sha256 || !p.fork_commit)) throw new Error("Provenance is incomplete");
}

async function forkWithRetry(store: RepoStore, source: string, name: string) {
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await store.fork(source, name, { description: `town fork of ${source}`, defaultBranchOnly: true });
    } catch (error) {
      last = error;
      const message = error instanceof Error ? error.message : "";
      if (store.kind !== "cloudflare" || !/409|forking|not ready/i.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
  throw last;
}

const pad = (s: string, n: number) => s.padEnd(n);
export function formatNrvt(s: NrvtSnapshot): string {
  const o: string[] = [];
  const short = (h: string | null) => (h ?? "—").slice(0, 8);
  o.push("Strata  ·  nrvt-storm-week  ·  five towns, one collective memory");
  o.push(`Note      ${s.note}`);
  o.push(`Driver    ${s.driver === "cloudflare" ? "cloudflare (Cloudflare Artifacts)" : "local (file driver)"}`);
  o.push(`Repo      ${s.repo}`);
  o.push("");
  o.push("Seed");
  for (const c of s.seed) o.push(`  ${short(c.hash)}  ${c.message}`);
  o.push("");
  o.push(`Forks     ${s.agents.length} forks, concurrent: ${s.overlap ? "yes" : "no"}`);
  for (const a of s.agents) {
    o.push(`  ${pad(a.repo, 34)} ${a.compareOnly ? "compare only" : short(a.commit)}`);
    const claim = lanes().find((l) => l.id === a.id)!.claims[0];
    o.push(`    claim      ${claim.id}  ${claim.stance}`);
    for (const v of a.violations) o.push(`    refused    ${v.path}  (contract.json may_write: ${a.id} may not write Redding's records)`);
  }
  o.push("");
  o.push("Reconcile");
  o.push(`  commit     ${short(s.reconcile_commit)}`);
  o.push(`  promoted   ${s.promoted.filter((p) => p.endsWith("claims.jsonl")).length} town claim files, ${s.promoted.filter((p) => p.startsWith("raw/")).length} raw snapshots`);
  for (const c of s.conflicts) {
    o.push(`  conflict   ${c.id}  ${c.key}  (review open)`);
    for (const x of c.claims) o.push(`             ${pad(x.stance, 11)} ${pad(x.town, 11)} ${x.id}  @${x.observed}`);
  }
  o.push(`  compare    ${s.comparison.key}  ${s.comparison.proposal} vs ${s.comparison.baseline}, +${s.comparison.projected} visits/wk projected. Not merged.`);
  o.push("");
  o.push("Receipt");
  o.push(`  read token  read summary.md: ${s.receipt.read_ok ? "ok" : "failed"}`);
  o.push(`  same token  push decisions/: refused${s.receipt.status ? ` (HTTP ${s.receipt.status})` : ""}`);
  o.push(`  ${s.receipt.message}`);
  o.push("");
  o.push(`Decision  ${s.decision.id}  by ${s.decision.author}`);
  o.push(`  commit     ${short(s.decision.commit)}`);
  o.push(`  budget     $${s.decision.budget_usd.toLocaleString("en-US")} · ${s.decision.crew_days} crew-days (illustrative)`);
  for (const a of s.decision.allocations) o.push(`  ${pad(a.claim, 22)} $${pad(a.usd.toLocaleString("en-US"), 7)} ${a.crew_days} crew-days`);
  o.push(`  hours      ${s.decision.hours}`);
  o.push(`  resolves   ${s.decision.resolves.join(", ")}`);
  o.push(`  cites      ${s.decision.cites.length} claims`);
  o.push("");
  o.push("Provenance  dec-storm-0918-01 → claims → sources");
  for (const p of s.provenance.slice(0, 3)) {
    o.push(`  ${p.claim}`);
    o.push(`    source   ${p.source}  sha256 ${p.sha256.slice(0, 12)}…`);
    o.push(`    fork     ${p.fork} @ ${short(p.fork_commit)} → ${p.promoted_in === "compared only" ? "compared only" : `promoted ${short(p.promoted_in)}`}`);
  }
  o.push("");
  o.push("History");
  for (const c of s.history) o.push(`  ${short(c.hash)}  ${c.message}`);
  return o.join("\n");
}
