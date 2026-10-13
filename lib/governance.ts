import { agentById, parseContract, pathAllowed, profileBodyLength } from "./contract";
import type { RepoStore } from "./store/types";
import type { CommitMeta, Violation } from "./types";

export interface AgentWrite {
  path: string;
  content: string;
}

export interface CommitAsAgentInput {
  store: RepoStore;
  repo: string;
  token: string;
  agentId: string;
  ref?: string;
  writes: AgentWrite[];
  message: string;
  author: { name: string; email: string; date: string };
}

export interface CommitAsAgentResult {
  commit: CommitMeta | null;
  committed: AgentWrite[];
  violations: Violation[];
}

/**
 * Enforce contract.json at commit time. Forbidden paths never enter the fork.
 * The reconciler checks promotion again, so a bad file still cannot land.
 */
export async function commitAsAgent(input: CommitAsAgentInput): Promise<CommitAsAgentResult> {
  const ref = input.ref ?? "main";
  const contractFile = await input.store.readFile(
    input.repo,
    { ref, path: "contract.json" },
    input.token,
  );
  if (!contractFile) throw new Error(`${input.repo} has no contract.json`);
  const contract = parseContract(new TextDecoder().decode(contractFile.bytes));
  const agent = agentById(contract, input.agentId);
  const violations: Violation[] = [];
  const allowed: AgentWrite[] = [];

  for (const write of input.writes) {
    if (!pathAllowed(agent.may_write, write.path)) {
      violations.push({
        agent: input.agentId,
        path: write.path,
        rule: "may_write",
        detail: `${agent.label} may not write ${write.path}.`,
      });
      continue;
    }
    if (write.path.startsWith(contract.layers.L0.path) && contract.layers.L0.append_only) {
      const prior = await input.store.readFile(input.repo, { ref, path: write.path }, input.token);
      if (prior && new TextDecoder().decode(prior.bytes) !== write.content) {
        violations.push({
          agent: input.agentId,
          path: write.path,
          rule: "append_only",
          detail: "raw/ is append-only. Existing bytes cannot change.",
        });
        continue;
      }
    }
    if (write.path === contract.layers.L3.path) {
      const chars = profileBodyLength(write.content);
      const budget = contract.layers.L3.max_chars;
      if (chars > budget) {
        violations.push({
          agent: input.agentId,
          path: write.path,
          rule: "profile_budget",
          detail: `Profile body is ${chars} characters. The contract budget is ${budget}.`,
        });
        continue;
      }
    }
    allowed.push(write);
  }

  if (allowed.length === 0) return { commit: null, committed: [], violations };

  const commit = await input.store.commit(input.repo, input.token, {
    message: input.message,
    author: input.author,
    files: allowed,
  });
  return { commit, committed: allowed, violations };
}
