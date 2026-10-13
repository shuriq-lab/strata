import { listFilesFromBinding, type ArtifactsBinding } from "../lib/store/binding";
import { handleMcp } from "../lib/mcp";
import { Navigator } from "../lib/navigator";
import { parsePyramid } from "../lib/pyramid";

interface Env {
  ARTIFACTS?: ArtifactsBinding;
  REPO_NAME?: string;
}

/**
 * Navigator MCP over one Artifacts repo.
 * Reads use the Workers binding. Tokens minted here are read-only.
 * Writes stay on the git remote; this Worker does not push.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors() });
    }
    if (!env.ARTIFACTS) {
      return Response.json(
        {
          error: "ARTIFACTS binding is not configured. Run npm run demo for the local adapter.",
          driver: "unconfigured",
        },
        { status: 503, headers: cors() },
      );
    }
    const repoName = url.searchParams.get("repo") ?? env.REPO_NAME ?? "northwind-dusk";

    if (request.method === "GET" && url.pathname === "/") {
      return Response.json(
        {
          name: "strata-navigator",
          repo: repoName,
          tools: ["read_files", "get_records", "search_records", "get_conversations", "search_conversations"],
          mcp: "/mcp",
        },
        { headers: cors() },
      );
    }

    if (request.method === "POST" && url.pathname === "/tokens") {
      const repo = await env.ARTIFACTS.get(repoName);
      const token = await repo.createToken("read", 3600);
      return Response.json(
        {
          repo: repoName,
          scope: token.scope ?? "read",
          expiresAt: token.expiresAt ?? token.expires_at ?? null,
          id: token.id ?? null,
          token: token.plaintext,
        },
        { headers: cors() },
      );
    }

    if (request.method === "POST" && url.pathname === "/mcp") {
      const repo = await env.ARTIFACTS.get(repoName);
      const files = await listFilesFromBinding(repo, "main");
      const navigator = new Navigator(parsePyramid(files));
      const message = (await request.json()) as { method?: string; id?: string | number | null; params?: object };
      const response = handleMcp(message, navigator);
      if (!response) return new Response(null, { status: 202, headers: cors() });
      return Response.json(response, { headers: cors() });
    }

    return Response.json(
      { message: "Use GET /, POST /mcp, or POST /tokens." },
      { status: 404, headers: cors() },
    );
  },
};

function cors(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  };
}
