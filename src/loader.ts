import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PolicyManifest, ResolvedPolicy, CommandEntry } from "./types";
import { GLOBAL_POLICY_DIR, POLICIES_DIR, getLocalPolicyDir } from "./paths";
import { PolicyRegistry } from "./registry";

export interface DiscoveredGroup {
  name: string;
  source: "local" | "global" | "policies";
  description: string;
  isAggregate: boolean;
}

export function resolvePolicy(cwd: string): ResolvedPolicy {
  const localDir = getLocalPolicyDir(cwd);
  const registry = buildRegistry(localDir);
  const activeNames = collectActiveNames(localDir);
  const groups = new Map<string, { description: string; commands: CommandEntry[] }>();
  const allCommands: CommandEntry[] = [];
  const warnings: string[] = [];

  for (const name of activeNames) {
    const commands = registry.resolve(name, new Set(), warnings);
    allCommands.push(...commands);
    const group = registry.get(name);
    if (group) groups.set(name, { description: group.description, commands });
  }

  return { commands: allCommands, groups, warnings };
}

export function listStarters(): string[] {
  const registry = buildRegistry("");
  return registry.names();
}

export function listAllGroups(cwd: string): DiscoveredGroup[] {
  const localDir = getLocalPolicyDir(cwd);
  const registry = buildRegistry(localDir);

  return registry.all().map(({ group, source }) => ({
    name: group.name,
    source,
    description: group.description,
    isAggregate: (group.includes?.length ?? 0) > 0,
  }));
}

function buildRegistry(localDir: string): PolicyRegistry {
  const dirs: Array<{ path: string; source: "local" | "global" | "policies" }> = [];
  if (localDir) dirs.push({ path: localDir, source: "local" });
  dirs.push({ path: GLOBAL_POLICY_DIR, source: "global" });
  dirs.push({ path: POLICIES_DIR, source: "policies" });
  return new PolicyRegistry(dirs);
}

function collectActiveNames(localDir: string): Set<string> {
  const names = new Set<string>();
  for (const manifest of [loadManifest(GLOBAL_POLICY_DIR), loadManifest(localDir)]) {
    if (manifest) manifest.active.forEach((n) => names.add(n));
  }
  return names;
}

function loadManifest(dir: string): PolicyManifest | null {
  const path = join(dir, "policy.json");
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf-8")) as PolicyManifest; } catch { return null; }
}
