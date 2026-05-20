/**
 * Command Validator
 *
 * Matches parsed command segments against the active trust policy.
 */

import { minimatch } from "minimatch";
import type { CommandEntry, ResolvedPolicy, ValidationResult } from "./types.js";
import { parseCommand } from "./parser.js";

const GLOB_OPTIONS = { dot: true, nocase: false, partial: false };

export function validateCommand(command: string, policy: ResolvedPolicy): ValidationResult {
  const { segments, unparseable } = parseCommand(command);

  if (unparseable) {
    return {
      allowed: false,
      reason: "Command contains unparseable elements (env vars, eval, variables in command position, or heredocs piped to interpreters)",
    };
  }

  if (segments.length === 0) {
    return { allowed: false, reason: "Empty command" };
  }

  for (const segment of segments) {
    if (!findMatchingEntry(segment.command, segment.requiresPipe, segment.requiresEmbedded, policy.commands)) {
      return {
        allowed: false,
        reason: formatDenialReason(segment),
      };
    }
  }

  const primary = segments[0];
  const match = findMatchingGroup(primary.command, primary.requiresPipe, primary.requiresEmbedded, policy);

  return { allowed: true, matchedGroup: match?.groupName, matchedGlob: match?.glob };
}

export function isValidGlob(pattern: string): { valid: boolean; error?: string } {
  if (!pattern || pattern.trim().length === 0) {
    return { valid: false, error: "Pattern cannot be empty" };
  }

  const bracketError = checkBalanced(pattern, "[", "]", "bracket");
  if (bracketError) return { valid: false, error: bracketError };

  const braceError = checkBalanced(pattern, "{", "}", "brace");
  if (braceError) return { valid: false, error: braceError };

  try {
    minimatch("test", pattern);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: `Invalid glob syntax: ${(e as Error).message}` };
  }
}

export function generateGlobExamples(glob: string): { matches: string[]; nonMatches: string[] } {
  const parts = glob.split(" ");
  const baseCommand = parts[0] ?? "";

  if (glob.endsWith(" *")) {
    const prefix = glob.slice(0, -2);
    return {
      matches: [`${prefix} foo`, `${prefix} --flag value`, `${prefix} arg1 arg2`],
      nonMatches: [baseCommand, `${baseCommand} other-subcommand`],
    };
  }

  if (glob.includes("*")) {
    const beforeStar = glob.split("*")[0];
    return {
      matches: [`${beforeStar}foo`, `${beforeStar}bar-baz`],
      nonMatches: ["completely-different-command"],
    };
  }

  return {
    matches: [glob],
    nonMatches: [`${glob} extra-arg`, `${baseCommand} different`],
  };
}

// --- Private helpers ---

function findMatchingEntry(
  command: string,
  requiresPipe: boolean,
  requiresEmbedded: boolean,
  entries: CommandEntry[],
): CommandEntry | null {
  for (const entry of entries) {
    if (requiresPipe && !entry.pipe) continue;
    if (requiresEmbedded && !entry.embedded) continue;
    if (minimatch(command, entry.glob, GLOB_OPTIONS)) return entry;
  }
  return null;
}

function findMatchingGroup(
  command: string,
  requiresPipe: boolean,
  requiresEmbedded: boolean,
  policy: ResolvedPolicy,
): { groupName: string; glob: string } | null {
  for (const [groupName, group] of policy.groups) {
    for (const entry of group.commands) {
      if (requiresPipe && !entry.pipe) continue;
      if (requiresEmbedded && !entry.embedded) continue;
      if (minimatch(command, entry.glob, GLOB_OPTIONS)) {
        return { groupName, glob: entry.glob };
      }
    }
  }
  return null;
}

function formatDenialReason(segment: { command: string; requiresPipe: boolean; requiresEmbedded: boolean }): string {
  const parts = [`Command segment not covered by any trust policy: ${segment.command}`];
  if (segment.requiresPipe) parts.push("(requires pipe: true)");
  if (segment.requiresEmbedded) parts.push("(requires embedded: true)");
  return parts.join(" ");
}

function checkBalanced(text: string, open: string, close: string, name: string): string | null {
  let depth = 0;
  for (const char of text) {
    if (char === open) depth++;
    if (char === close) depth--;
    if (depth < 0) return `Unmatched closing ${name} '${close}'`;
  }
  if (depth > 0) return `Unmatched opening ${name} '${open}'`;
  return null;
}
