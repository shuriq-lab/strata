import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultRoot } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const text = await readFile(path.join(defaultRoot(), "snapshot.json"), "utf8");
    return Response.json(JSON.parse(text));
  } catch {
    return Response.json({ error: "No engagement has been reconciled yet." }, { status: 404 });
  }
}
