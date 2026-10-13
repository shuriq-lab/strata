import path from "node:path";
import { CloudflareStore, cloudflareConfigFromEnv } from "./cloudflare";
import { LocalStore } from "./local";
import type { RepoStore } from "./types";

export function openStore(driver: "local" | "cloudflare", root: string): RepoStore {
  if (driver === "cloudflare") {
    return new CloudflareStore(cloudflareConfigFromEnv(path.join(root, "cloudflare-cache")));
  }
  return new LocalStore(root);
}

export function driverFromEnv(): "local" | "cloudflare" {
  return process.env.ARTIFACTS_DRIVER === "cloudflare" ? "cloudflare" : "local";
}
