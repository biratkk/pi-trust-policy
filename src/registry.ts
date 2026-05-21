import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { TrustPolicyGroup, CommandEntry } from "./types";

export interface IndexedGroup {
  group: TrustPolicyGroup;
  dir: string;
  source: "local" | "global" | "policies";
}

export class PolicyRegistry {
  private index = new Map<string, IndexedGroup>();

  constructor(dirs: Array<{ path: string; source: "local" | "global" | "policies" }>) {
    for (const { path: dir, source } of dirs) {
      this.scanDir(dir, source);
    }
  }

  get(name: string): TrustPolicyGroup | null {
    return this.index.get(name)?.group ?? null;
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  all(): IndexedGroup[] {
    return [...this.index.values()];
  }

  names(): string[] {
    return [...this.index.keys()];
  }

  resolve(name: string, visited: Set<string>, warnings: string[]): CommandEntry[] {
    if (visited.has(name)) {
      warnings.push(`Circular reference detected: '${name}' already in resolution chain`);
      return [];
    }
    const group = this.get(name);
    if (!group) {
      warnings.push(`Trust policy group '${name}' not found`);
      return [];
    }
    visited.add(name);
    const commands = [...group.commands];
    if (group.includes) {
      for (const inc of group.includes) {
        commands.push(...this.resolve(inc, new Set(visited), warnings));
      }
    }
    return commands;
  }

  private scanDir(dir: string, source: "local" | "global" | "policies"): void {
    if (!existsSync(dir)) return;
    for (const item of readdirSync(dir)) {
      const fullPath = join(dir, item);
      if (statSync(fullPath).isDirectory()) {
        this.scanDir(fullPath, source);
      } else if (item.endsWith(".yaml") && !this.index.has(item.replace(/\.yaml$/, ""))) {
        const group = loadYaml(fullPath);
        if (group) {
          this.index.set(group.name, { group, dir, source });
        }
      }
    }
  }
}

function loadYaml(path: string): TrustPolicyGroup | null {
  try {
    const raw = parseYaml(readFileSync(path, "utf-8")) as Record<string, unknown>;
    return normalizeGroup(raw);
  } catch {
    return null;
  }
}

function normalizeGroup(raw: Record<string, unknown>): TrustPolicyGroup {
  const rawCmds = raw.commands as Array<Record<string, unknown>> | undefined;
  const commands: CommandEntry[] = [];
  if (Array.isArray(rawCmds)) {
    for (const cmd of rawCmds) {
      if (typeof cmd.glob === "string") {
        commands.push({
          glob: cmd.glob,
          description: typeof cmd.description === "string" ? cmd.description : undefined,
          pipe: cmd.pipe === true,
          embedded: cmd.embedded === true,
          redirect: parseRedirectMode(cmd.redirect),
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

function parseRedirectMode(value: unknown): "none" | "append" | "overwrite" | "both" {
  if (value === "append" || value === "overwrite" || value === "both") return value;
  return "none";
}
