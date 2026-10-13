import { parsePyramid } from "./pyramid";
import type { RepoStore } from "./store/types";
import type { Pyramid } from "./types";

export async function loadPyramid(store: RepoStore, repo: string, token: string, ref = "main"): Promise<Pyramid> {
  const paths = await store.listFiles(repo, ref, token);
  const files = new Map<string, string>();
  for (const filePath of paths) {
    const blob = await store.readFile(repo, { ref, path: filePath }, token);
    if (!blob) continue;
    files.set(filePath, new TextDecoder().decode(blob.bytes));
  }
  return parsePyramid(files);
}
