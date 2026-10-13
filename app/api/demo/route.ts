import { defaultRoot, driverFromEnv, runDemo } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const snapshot = await runDemo({ root: defaultRoot(), driver: driverFromEnv() });
    return Response.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Demo failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
