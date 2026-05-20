/**
 * Policy Writer
 *
 * Handles writing trust policy group files and updating policy.json manifests.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { TrustPolicyGroup, PolicyManifest, CommandEntry } from "./types.js";
import { STARTERS_DIR } from "./paths.js";

const YAML_OPTIONS = { lineWidth: 120 };

export function writeGroupFile(group: TrustPolicyGroup, dir: string): string {
  ensureDir(dir);
  const filePath = join(dir, `${group.name}.yaml`);
  writeFileSync(filePath, formatGroupAsYaml(group), "utf-8");
  return filePath;
}

export function addCommandToGroup(groupName: string, command: CommandEntry, dir: string): boolean {
  const filePath = join(dir, `${groupName}.yaml`);
  if (!existsSync(filePath)) return false;

  try {
    const parsed = parseYaml(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
    const commands = (parsed.commands as Array<Record<string, unknown>>) ?? [];
    commands.push(serializeCommand(command));
    parsed.commands = commands;
    writeFileSync(filePath, stringifyYaml(parsed, YAML_OPTIONS), "utf-8");
    return true;
  } catch {
    return false;
  }
}

export function formatGroupAsYaml(group: TrustPolicyGroup): string {
  const doc: Record<string, unknown> = {
    name: group.name,
    description: group.description,
  };

  if (group.includes && group.includes.length > 0) {
    doc.includes = group.includes;
  }

  doc.commands = group.commands.map(serializeCommand);
  return stringifyYaml(doc, YAML_OPTIONS);
}

export function readManifest(dir: string): PolicyManifest {
  const filePath = join(dir, "policy.json");
  if (!existsSync(filePath)) return { active: [] };
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as PolicyManifest;
  } catch {
    return { active: [] };
  }
}

export function writeManifest(manifest: PolicyManifest, dir: string): void {
  ensureDir(dir);
  const filePath = join(dir, "policy.json");
  writeFileSync(filePath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

export function activateGroup(groupName: string, dir: string): void {
  const manifest = readManifest(dir);
  if (!manifest.active.includes(groupName)) {
    manifest.active.push(groupName);
    writeManifest(manifest, dir);
  }
}

export function deactivateGroup(groupName: string, dir: string): void {
  const manifest = readManifest(dir);
  manifest.active = manifest.active.filter((n) => n !== groupName);
  writeManifest(manifest, dir);
}

export function copyStarter(starterName: string, targetDir: string): boolean {
  const sourcePath = join(STARTERS_DIR, `${starterName}.yaml`);
  if (!existsSync(sourcePath)) return false;

  ensureDir(targetDir);
  copyFileSync(sourcePath, join(targetDir, `${starterName}.yaml`));
  return true;
}

// --- Private helpers ---

function serializeCommand(cmd: CommandEntry): Record<string, unknown> {
  const entry: Record<string, unknown> = { glob: cmd.glob };
  if (cmd.description) entry.description = cmd.description;
  if (cmd.pipe) entry.pipe = true;
  if (cmd.embedded) entry.embedded = true;
  return entry;
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
