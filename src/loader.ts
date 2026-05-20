/**
 * Trust Policy Loader
 *
 * Resolves active trust policy groups from global and local directories.
 * Handles recursive includes with cycle detection.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { TrustPolicyGroup, PolicyManifest, ResolvedPolicy, CommandEntry } from "./types.js";
import { GLOBAL_POLICY_DIR, STARTERS_DIR, getLocalPolicyDir } from "./paths.js";

interface ResolutionContext {
  localDir: string;
  groupCache: Map<string, TrustPolicyGroup | null>;
  warnings: string[];
}

export function resolvePolicy(cwd: string): ResolvedPolicy {
  const localDir = getLocalPolicyDir(cwd);
  const ctx: ResolutionContext = {
    localDir,
    groupCache: new Map(),
    warnings: [],
  };

  const activeNames = collectActiveNames(localDir);
  const groups = new Map<string, { description: string; commands: CommandEntry[] }>();
  const allCommands: CommandEntry[] = [];

  for (const name of activeNames) {
    const commands = resolveGroup(name, new Set(), ctx);
    allCommands.push(...commands);

    const group = findGroup(name, ctx);
    if (group) {
      groups.set(name, { description: group.description, commands });
    }
  }

  return { commands: allCommands, groups, warnings: ctx.warnings };
}

export function loadStarterGroup(name: string): TrustPolicyGroup | null {
  return loadGroupFromDir(STARTERS_DIR, name);
}

export function listStarters(): string[] {
  if (!existsSync(STARTERS_DIR)) return [];
  return readdirSync(STARTERS_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(/\.yaml$/, ""));
}

export interface DiscoveredGroup {
  name: string;
  source: "local" | "global" | "starter";
  description: string;
}

export function listAllGroups(cwd: string): DiscoveredGroup[] {
  const localDir = getLocalPolicyDir(cwd);
  const seen = new Set<string>();
  const groups: DiscoveredGroup[] = [];

  for (const [dir, source] of [
    [localDir, "local"],
    [GLOBAL_POLICY_DIR, "global"],
    [STARTERS_DIR, "starter"],
  ] as const) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".yaml")) continue;
      const name = file.replace(/\.yaml$/, "");
      if (!seen.has(name)) {
        seen.add(name);
        const group = loadGroupFromDir(dir, name);
        groups.push({ name, source, description: group?.description ?? "" });
      }
    }
  }

  return groups;
}

// --- Resolution helpers ---

function findGroup(name: string, ctx: ResolutionContext): TrustPolicyGroup | null {
  if (ctx.groupCache.has(name)) return ctx.groupCache.get(name)!;

  const group =
    loadGroupFromDir(ctx.localDir, name) ??
    loadGroupFromDir(GLOBAL_POLICY_DIR, name) ??
    loadGroupFromDir(STARTERS_DIR, name);

  ctx.groupCache.set(name, group);
  return group;
}

function resolveGroup(name: string, visited: Set<string>, ctx: ResolutionContext): CommandEntry[] {
  if (visited.has(name)) {
    ctx.warnings.push(`Circular reference detected: '${name}' already in resolution chain`);
    return [];
  }

  const group = findGroup(name, ctx);
  if (!group) {
    ctx.warnings.push(`Trust policy group '${name}' not found`);
    return [];
  }

  visited.add(name);
  const commands: CommandEntry[] = [...group.commands];

  if (group.includes) {
    for (const includeName of group.includes) {
      commands.push(...resolveGroup(includeName, new Set(visited), ctx));
    }
  }

  return commands;
}

// --- File I/O helpers ---

function collectActiveNames(localDir: string): Set<string> {
  const names = new Set<string>();

  const globalManifest = loadManifest(GLOBAL_POLICY_DIR);
  const localManifest = loadManifest(localDir);

  if (globalManifest) {
    for (const name of globalManifest.active) names.add(name);
  }
  if (localManifest) {
    for (const name of localManifest.active) names.add(name);
  }

  return names;
}

function loadManifest(dir: string): PolicyManifest | null {
  const manifestPath = join(dir, "policy.json");
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf-8")) as PolicyManifest;
  } catch {
    return null;
  }
}

function loadGroupFromDir(dir: string, name: string): TrustPolicyGroup | null {
  const yamlPath = join(dir, `${name}.yaml`);
  if (!existsSync(yamlPath)) return null;
  try {
    const raw = parseYaml(readFileSync(yamlPath, "utf-8")) as Record<string, unknown>;
    return normalizeGroup(raw);
  } catch {
    return null;
  }
}

function normalizeGroup(raw: Record<string, unknown>): TrustPolicyGroup {
  const rawCommands = raw.commands as Array<Record<string, unknown>> | undefined;
  const commands: CommandEntry[] = [];

  if (Array.isArray(rawCommands)) {
    for (const cmd of rawCommands) {
      if (typeof cmd.glob === "string") {
        commands.push({
          glob: cmd.glob,
          description: typeof cmd.description === "string" ? cmd.description : undefined,
          pipe: cmd.pipe === true,
          embedded: cmd.embedded === true,
        });
      }
    }
  }

  return {
    name: typeof raw.name === "string" ? raw.name : "unknown",
    description: typeof raw.description === "string" ? raw.description : "",
    includes: Array.isArray(raw.includes) ? (raw.includes as string[]) : undefined,
    commands,
  };
}
