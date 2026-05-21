import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { TrustPolicyGroup, PolicyManifest, CommandEntry } from "./types";
import { STARTERS_DIR } from "./paths";

export function writeGroupFile(group: TrustPolicyGroup, dir: string): string {
  mkdirSync(dir, { recursive: true });
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
    writeFileSync(filePath, stringifyYaml(parsed, { lineWidth: 120 }), "utf-8");
    return true;
  } catch {
    return false;
  }
}

function formatGroupAsYaml(group: TrustPolicyGroup): string {
  const doc: Record<string, unknown> = { name: group.name, description: group.description };
  if (group.includes?.length) doc.includes = group.includes;
  doc.commands = group.commands.map(serializeCommand);
  return stringifyYaml(doc, { lineWidth: 120 });
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

export function setGroupActive(groupName: string, dir: string, active: boolean): void {
  const manifest = readManifest(dir);
  const isActive = manifest.active.includes(groupName);

  if (active && !isActive) {
    manifest.active.push(groupName);
  } else if (!active && isActive) {
    manifest.active = manifest.active.filter((n) => n !== groupName);
  } else {
    return;
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "policy.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

export function copyStarter(starterName: string, targetDir: string): boolean {
  const sourcePath = join(STARTERS_DIR, `${starterName}.yaml`);
  if (!existsSync(sourcePath)) return false;
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(sourcePath, join(targetDir, `${starterName}.yaml`));
  return true;
}

function serializeCommand(cmd: CommandEntry): Record<string, unknown> {
  const entry: Record<string, unknown> = { glob: cmd.glob };
  if (cmd.description) entry.description = cmd.description;
  if (cmd.pipe) entry.pipe = true;
  if (cmd.embedded) entry.embedded = true;
  return entry;
}
