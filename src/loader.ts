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

export function resolvePolicy(cwd: string): ResolvedPolicy {
  const warnings: string[] = [];
  const groups = new Map<string, { description: string; commands: CommandEntry[] }>();
  const localDir = getLocalPolicyDir(cwd);

  const activeNames = collectActiveNames(localDir);
  const groupCache = new Map<string, TrustPolicyGroup | null>();

  function findGroup(name: string): TrustPolicyGroup | null {
    if (groupCache.has(name)) return groupCache.get(name)!;

    const group =
      loadGroupFromDir(localDir, name) ??
      loadGroupFromDir(GLOBAL_POLICY_DIR, name) ??
      loadGroupFromDir(STARTERS_DIR, name);

    groupCache.set(name, group);
    return group;
  }

  function resolveGroup(name: string, visited: Set<string>): CommandEntry[] {
    if (visited.has(name)) {
      warnings.push(`Circular reference detected: '${name}' already in resolution chain`);
      return [];
    }

    const group = findGroup(name);
    if (!group) {
      warnings.push(`Trust policy group '${name}' not found`);
      return [];
    }

    visited.add(name);
    const commands: CommandEntry[] = [...group.commands];

    if (group.includes) {
      for (const includeName of group.includes) {
        commands.push(...resolveGroup(includeName, new Set(visited)));
      }
    }

    return commands;
  }

  const allCommands: CommandEntry[] = [];
  for (const name of activeNames) {
    const commands = resolveGroup(name, new Set());
    allCommands.push(...commands);

    const group = findGroup(name);
    if (group) {
      groups.set(name, { description: group.description, commands });
    }
  }

  return { commands: allCommands, groups, warnings };
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

// --- Private helpers ---

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
