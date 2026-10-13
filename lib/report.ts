import { shortHash } from "./text";
import type { DemoSnapshot } from "./types";

export function formatReport(snapshot: DemoSnapshot): string {
  const lines: string[] = [];
  lines.push("Strata  ·  one engagement, forked per agent, merged per record");
  lines.push("");
  lines.push(`Client    ${snapshot.engagement.client} — ${snapshot.engagement.title}`);
  lines.push(`Note      ${snapshot.engagement.note}`);
  lines.push(`Repo      ${snapshot.engagement.repo}`);
  lines.push(`Driver    ${snapshot.driver}${snapshot.mocked ? " (local git adapter, not Cloudflare)" : " (Cloudflare Artifacts)"}`);
  lines.push(`Path      ${snapshot.repo_path}`);
  lines.push("");
  lines.push("Seed      one commit per layer");
  for (const commit of snapshot.layer_commits) {
    lines.push(`  ${shortHash(commit.hash)}  ${commit.layer.padEnd(8)}  ${commit.message}`);
  }
  lines.push("");
  lines.push("Navigator");
  for (const question of snapshot.questions) {
    lines.push(`  ${question.route.padEnd(12)}  ${question.question}`);
    for (const step of question.trace) {
      lines.push(`    ${step.tool}  ${step.summary}`);
    }
    lines.push(`    → ${question.answer}`);
    lines.push(`      cites ${question.citations.join(", ")}`);
  }
  if (snapshot.narration) {
    lines.push("");
    lines.push("Narration");
    lines.push(`  ${snapshot.narration}`);
  }
  lines.push("");
  lines.push(`Agents    ${snapshot.agents.length} forks, concurrent: ${snapshot.concurrency.overlap ? "yes" : "NO"}`);
  for (const agent of snapshot.agents) {
    const mark = agent.compareOnly ? "compare only" : agent.commit ? shortHash(agent.commit) : "no commit";
    lines.push(`  ${agent.label.padEnd(22)}  ${agent.person.padEnd(12)}  ${mark}`);
    lines.push(`    ${agent.note}`);
    if (agent.committedPaths.length) lines.push(`    committed  ${agent.committedPaths.join(", ")}`);
    for (const violation of agent.violations) {
      lines.push(`    refused    ${violation.path}  (${violation.rule})`);
    }
  }
  lines.push("");
  lines.push("Reconcile");
  lines.push(`  commit     ${snapshot.reconcile.commit ? shortHash(snapshot.reconcile.commit) : "none"}`);
  lines.push(`  folded     ${snapshot.reconcile.folds.map((fold) => `${fold.folded_id} → ${fold.kept_id}`).join("; ") || "none"}`);
  lines.push(`  profile    ${snapshot.reconcile.profile_action}, ${snapshot.reconcile.profile_chars}/${snapshot.reconcile.profile_budget} chars`);
  for (const conflict of snapshot.reconcile.conflicts) {
    lines.push(`  conflict   ${conflict.claim_key}  (${conflict.reason}, review ${conflict.review})`);
    for (const record of conflict.records) {
      lines.push(`             ${record.stance ?? "—"}  ${record.agent}  ${record.id}`);
      lines.push(`             ${record.content}`);
    }
  }
  for (const comparison of snapshot.reconcile.comparisons) {
    lines.push(`  compare    ${comparison.claim_key}  ${comparison.detail}`);
  }
  lines.push("");
  const price = snapshot.provenance.find((trail) => trail.record_id === "rec_claim_harbor_price_86");
  if (price) {
    lines.push("Provenance  rec_claim_harbor_price_86");
    for (const step of price.steps) {
      lines.push(`  ${step.kind.padEnd(8)}  ${step.title}`);
      lines.push(`            ${step.detail}`);
      if (step.meta) lines.push(`            ${step.meta}`);
    }
  }
  lines.push("");
  lines.push("Receipt");
  lines.push(`  read token ${snapshot.governance_receipt.read_token_id} read profile: ${snapshot.governance_receipt.read_ok ? "ok" : "failed"}`);
  lines.push(`  same token commit: ${snapshot.governance_receipt.read_commit_refused ? "refused" : "WAS ALLOWED"}`);
  lines.push(`  ${snapshot.governance_receipt.refusal_message}`);
  lines.push("");
  lines.push("History");
  for (const commit of snapshot.history) {
    lines.push(`  ${shortHash(commit.hash)}  ${commit.message}`);
  }
  return lines.join("\n");
}
