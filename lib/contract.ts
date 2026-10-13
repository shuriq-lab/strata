import type { Contract, ContractAgent } from "./types";

export function parseContract(text: string): Contract {
  const value = JSON.parse(text) as Contract;
  if (!value || !Array.isArray(value.agents)) {
    throw new Error("contract.json is missing agents");
  }
  if (!value.layers?.L0?.path || !value.layers?.L3?.max_chars) {
    throw new Error("contract.json is missing layer rules");
  }
  return value;
}

export function agentById(contract: Contract, id: string): ContractAgent {
  const agent = contract.agents.find((item) => item.id === id);
  if (!agent) throw new Error(`contract.json has no agent "${id}"`);
  return agent;
}

/** A rule ending in `/` is a directory prefix. Anything else is an exact path. */
export function pathAllowed(rules: string[], filePath: string): boolean {
  return rules.some((rule) => {
    if (rule.endsWith("/")) return filePath.startsWith(rule);
    return filePath === rule;
  });
}

export function profileBodyLength(markdown: string): number {
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const body = match ? markdown.slice(match[0].length).trim() : markdown.trim();
  return body.length;
}
