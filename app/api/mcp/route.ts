import { defaultRoot } from "@/lib/demo";
import { loadPyramid } from "@/lib/load";
import { handleMcp } from "@/lib/mcp";
import { Navigator } from "@/lib/navigator";
import { ENGAGEMENT_REPO } from "@/lib/sample";
import { openStore } from "@/lib/store/open";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** MCP over the local engagement repo. The Worker serves the same tools from Artifacts. */
export async function POST(request: Request) {
  try {
    const store = openStore("local", defaultRoot());
    const token = await store.createToken(ENGAGEMENT_REPO, "read", 3600);
    const pyramid = await loadPyramid(store, ENGAGEMENT_REPO, token.plaintext);
    const message = (await request.json()) as { method?: string; id?: string | number | null; params?: object };
    const response = handleMcp(message, new Navigator(pyramid));
    if (!response) return new Response(null, { status: 202 });
    return Response.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
