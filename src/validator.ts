import { minimatch } from "minimatch";
import type { CommandEntry, ResolvedPolicy, ValidationResult } from "./types";
import { parseCommand } from "./parser";

const GLOB_OPTIONS = { dot: true, nocase: false, partial: false };

export function validateCommand(command: string, policy: ResolvedPolicy): ValidationResult {
  const { segments, unparseable } = parseCommand(command);

  if (unparseable) {
    return { allowed: false, reason: "Command contains unparseable elements (env vars, eval, variables in command position, or heredocs piped to interpreters)" };
  }
  if (segments.length === 0) {
    return { allowed: false, reason: "Empty command" };
  }

  for (const seg of segments) {
    if (!matchSegment(seg.command, seg.requiresPipe, seg.requiresEmbedded, seg.redirect, policy.commands)) {
      const passthrough = tryPassthrough(seg.command, seg.requiresPipe, seg.requiresEmbedded, seg.redirect, policy.commands);
      if (passthrough) {
        const innerResult = validateCommand(passthrough.innerCommand, policy);
        if (!innerResult.allowed) return innerResult;
        continue;
      }
      const parts = [`Command segment not covered by any trust policy: ${seg.command}`];
      if (seg.requiresPipe) parts.push("(requires pipe: true)");
      if (seg.requiresEmbedded) parts.push("(requires embedded: true)");
      if (seg.redirect !== "none") parts.push(`(requires redirect: ${seg.redirect} or both)`);
      return { allowed: false, reason: parts.join(" ") };
    }
  }

  const primary = segments[0];
  const match = findMatchingGroup(primary.command, primary.requiresPipe, primary.requiresEmbedded, primary.redirect, policy);
  return { allowed: true, matchedGroup: match?.groupName, matchedGlob: match?.glob };
}

export function isValidGlob(pattern: string): { valid: boolean; error?: string } {
  if (!pattern?.trim()) return { valid: false, error: "Pattern cannot be empty" };

  for (const [open, close, name] of [["[", "]", "bracket"], ["{", "}", "brace"]] as const) {
    let depth = 0;
    for (const ch of pattern) {
      if (ch === open) depth++;
      if (ch === close) depth--;
      if (depth < 0) return { valid: false, error: `Unmatched closing ${name} '${close}'` };
    }
    if (depth > 0) return { valid: false, error: `Unmatched opening ${name} '${open}'` };
  }

  try {
    minimatch("test", pattern);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: `Invalid glob syntax: ${(e as Error).message}` };
  }
}

export function generateGlobExamples(glob: string): { matches: string[]; nonMatches: string[] } {
  const base = glob.split(" ")[0] ?? "";

  if (glob.endsWith(" *")) {
    const prefix = glob.slice(0, -2);
    return {
      matches: [`${prefix} foo`, `${prefix} --flag value`, `${prefix} arg1 arg2`],
      nonMatches: [base, `${base} other-subcommand`],
    };
  }
  if (glob.includes("*")) {
    const before = glob.split("*")[0];
    return { matches: [`${before}foo`, `${before}bar-baz`], nonMatches: ["completely-different-command"] };
  }
  return { matches: [glob], nonMatches: [`${glob} extra-arg`, `${base} different`] };
}

function matchSegment(command: string, needsPipe: boolean, needsEmbedded: boolean, needsRedirect: "none" | "append" | "overwrite", entries: CommandEntry[]): CommandEntry | null {
  for (const entry of entries) {
    if (needsPipe && !entry.pipe) continue;
    if (needsEmbedded && !entry.embedded) continue;
    if (!redirectAllowed(needsRedirect, entry.redirect)) continue;
    if (!minimatch(command, entry.glob, GLOB_OPTIONS)) continue;
    if (entry.passthrough) continue;
    return entry;
  }
  return null;
}

interface PassthroughResult {
  kind: "command";
  innerCommand: string;
}

function tryPassthrough(command: string, needsPipe: boolean, needsEmbedded: boolean, needsRedirect: "none" | "append" | "overwrite", entries: CommandEntry[]): PassthroughResult | null {
  for (const entry of entries) {
    if (needsPipe && !entry.pipe) continue;
    if (needsEmbedded && !entry.embedded) continue;
    if (!redirectAllowed(needsRedirect, entry.redirect)) continue;
    if (!entry.passthrough) continue;
    if (!minimatch(command, entry.glob, GLOB_OPTIONS)) continue;
    const inner = extractInnerCommand(command, entry);
    if (inner) return { kind: "command", innerCommand: inner };
  }
  return null;
}

function extractInnerCommand(command: string, entry: CommandEntry): string | null {
  const tokens = command.split(/\s+/);
  const skipSet = new Set(entry.skipFlags);
  const skipWithArgSet = new Set(entry.skipFlagsWithArg);

  let i = 1;
  while (i < tokens.length) {
    const token = tokens[i];
    if (skipSet.has(token)) {
      i++;
    } else if (skipWithArgSet.has(token)) {
      i += 2;
    } else if (token.startsWith("-")) {
      return null;
    } else {
      break;
    }
  }

  if (i >= tokens.length) return null;
  return tokens.slice(i).join(" ");
}

function findMatchingGroup(command: string, needsPipe: boolean, needsEmbedded: boolean, needsRedirect: "none" | "append" | "overwrite", policy: ResolvedPolicy): { groupName: string; glob: string } | null {
  for (const [groupName, group] of policy.groups) {
    const entry = matchSegment(command, needsPipe, needsEmbedded, needsRedirect, group.commands);
    if (entry) return { groupName, glob: entry.glob };
    const passthrough = tryPassthrough(command, needsPipe, needsEmbedded, needsRedirect, group.commands);
    if (passthrough) return { groupName, glob: "passthrough" };
  }
  return null;
}

function redirectAllowed(needed: "none" | "append" | "overwrite", allowed: "none" | "append" | "overwrite" | "both"): boolean {
  if (needed === "none") return true;
  if (allowed === "both") return true;
  if (needed === "append" && allowed === "append") return true;
  if (needed === "overwrite" && allowed === "overwrite") return true;
  return false;
}
