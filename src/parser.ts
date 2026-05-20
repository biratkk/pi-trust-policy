/**
 * Command Parser
 *
 * Recursively decomposes compound bash commands into atomic segments
 * using the unbash AST parser. Determines which flags (pipe, embedded)
 * each segment requires.
 */

import { parse } from "unbash";
import type {
  Script,
  Node,
  Command,
  Pipeline,
  AndOr,
  Statement,
  Word,
  WordPart,
  CommandExpansionPart,
} from "unbash";
import type { CommandSegment } from "./types.js";

/**
 * Reconstruct the command string from a Command node.
 * Joins the command name and suffix words with spaces.
 */
function reconstructCommand(node: Command): string {
  const parts: string[] = [];
  if (node.name) {
    parts.push(node.name.text);
  }
  for (const word of node.suffix) {
    parts.push(word.text);
  }
  return parts.join(" ");
}

/**
 * Check if a Command node has environment variable assignments in prefix.
 */
function hasAssignments(node: Command): boolean {
  return node.prefix.length > 0;
}

/**
 * Check if a Command node's name is a variable (unparseable command position).
 */
function hasVariableCommandName(node: Command): boolean {
  if (!node.name) return false;
  if (node.name.parts) {
    return node.name.parts.some(
      (p) => p.type === "SimpleExpansion" || p.type === "ParameterExpansion",
    );
  }
  return /^\$/.test(node.name.text);
}

/**
 * Check if a Command node is eval.
 */
function isEval(node: Command): boolean {
  return node.name?.value === "eval";
}

/**
 * Check if a Command node is bash/sh -c.
 */
function isBashC(node: Command): { inner: string } | null {
  const name = node.name?.value;
  if (name !== "bash" && name !== "sh") return null;

  const suffixValues = node.suffix.map((w) => w.value);
  const cIndex = suffixValues.indexOf("-c");
  if (cIndex === -1 || cIndex + 1 >= node.suffix.length) return null;

  const innerWord = node.suffix[cIndex + 1];
  return { inner: innerWord.value };
}

/**
 * Extract all CommandExpansion parts from a word's parts tree.
 */
function collectExpansionsFromParts(parts: WordPart[] | undefined, out: CommandExpansionPart[]): void {
  if (!parts) return;
  for (const part of parts) {
    if (part.type === "CommandExpansion") {
      out.push(part);
    } else if (part.type === "DoubleQuoted") {
      for (const child of part.parts) {
        if (child.type === "CommandExpansion") {
          out.push(child);
        }
      }
    }
  }
}

function extractCommandExpansions(word: Word): CommandExpansionPart[] {
  const expansions: CommandExpansionPart[] = [];
  collectExpansionsFromParts(word.parts, expansions);
  return expansions;
}

/**
 * Process a single Command AST node into segments.
 * Returns null if the command is unparseable (should always prompt).
 */
function processCommand(
  node: Command,
  requiresPipe: boolean,
  requiresEmbedded: boolean,
): { segments: CommandSegment[] } | null {
  // Env var assignments → always unparseable
  if (hasAssignments(node)) return null;

  // Variable in command position → unparseable
  if (hasVariableCommandName(node)) return null;

  // eval → unparseable
  if (isEval(node)) return null;

  // export → always unparseable (sets env vars)
  if (node.name?.value === "export") return null;

  const segments: CommandSegment[] = [];

  // Check for bash -c wrapper
  const bashC = isBashC(node);
  if (bashC) {
    // Recursively parse the inner command — all segments need embedded: true
    const inner = parseCommand(bashC.inner);
    if (inner.unparseable) return null;
    for (const seg of inner.segments) {
      segments.push({
        ...seg,
        requiresEmbedded: true,
      });
    }
    return { segments };
  }

  // Extract command substitutions from all suffix words
  for (const word of node.suffix) {
    const expansions = extractCommandExpansions(word);
    for (const expansion of expansions) {
      if (expansion.script) {
        // Recursively validate the inner script
        const inner = processScript(expansion.script, true);
        if (!inner) return null;
        segments.push(...inner);
      } else if (expansion.inner) {
        // Fallback: parse inner string
        const inner = parseCommand(expansion.inner);
        if (inner.unparseable) return null;
        for (const seg of inner.segments) {
          segments.push({ ...seg, requiresEmbedded: true });
        }
      }
    }
  }

  // Also check the name for command expansions (rare but possible)
  if (node.name?.parts) {
    const nameExpansions = extractCommandExpansions(node.name);
    for (const expansion of nameExpansions) {
      if (expansion.script) {
        const inner = processScript(expansion.script, true);
        if (!inner) return null;
        segments.push(...inner);
      }
    }
  }

  // The command itself
  segments.push({
    command: reconstructCommand(node),
    requiresPipe,
    requiresEmbedded,
  });

  return { segments };
}

/**
 * Process a Pipeline AST node into segments.
 */
function processPipeline(
  node: Pipeline,
  requiresEmbedded: boolean,
): CommandSegment[] | null {
  const segments: CommandSegment[] = [];
  const isPipeline = node.commands.length > 1;

  for (const cmd of node.commands) {
    const result = processNode(cmd, isPipeline, requiresEmbedded);
    if (!result) return null;
    segments.push(...result);
  }

  return segments;
}

/**
 * Process an AndOr AST node into segments.
 */
function processAndOr(
  node: AndOr,
  requiresEmbedded: boolean,
): CommandSegment[] | null {
  const segments: CommandSegment[] = [];

  for (const cmd of node.commands) {
    const result = processNode(cmd, false, requiresEmbedded);
    if (!result) return null;
    segments.push(...result);
  }

  return segments;
}

/**
 * Process any AST node recursively.
 */
function processNode(
  node: Node,
  requiresPipe: boolean,
  requiresEmbedded: boolean,
): CommandSegment[] | null {
  switch (node.type) {
    case "Command":
      const cmdResult = processCommand(node, requiresPipe, requiresEmbedded);
      return cmdResult?.segments ?? null;

    case "Pipeline":
      return processPipeline(node, requiresEmbedded);

    case "AndOr":
      return processAndOr(node, requiresEmbedded);

    case "Statement":
      return processNode(node.command, requiresPipe, requiresEmbedded);

    case "Subshell":
      // Treat subshell contents as embedded
      const subSegments: CommandSegment[] = [];
      for (const stmt of node.body.commands) {
        const result = processNode(stmt, requiresPipe, true);
        if (!result) return null;
        subSegments.push(...result);
      }
      return subSegments;

    case "BraceGroup":
      const braceSegments: CommandSegment[] = [];
      for (const stmt of node.body.commands) {
        const result = processNode(stmt, requiresPipe, requiresEmbedded);
        if (!result) return null;
        braceSegments.push(...result);
      }
      return braceSegments;

    default:
      // For complex constructs (if, for, while, case, function, etc.)
      // we can't statically validate — treat as unparseable
      return null;
  }
}

/**
 * Process a full Script AST into segments.
 */
function processScript(
  script: Script,
  requiresEmbedded: boolean,
): CommandSegment[] | null {
  const segments: CommandSegment[] = [];

  for (const stmt of script.commands) {
    const result = processNode(stmt, false, requiresEmbedded);
    if (!result) return null;
    segments.push(...result);
  }

  return segments;
}

/**
 * Parse a compound bash command into all atomic segments that need validation.
 * Returns segments with their required permission flags.
 */
export function parseCommand(command: string): {
  segments: CommandSegment[];
  unparseable: boolean;
} {
  const trimmed = command.trim();
  if (!trimmed) {
    return { segments: [], unparseable: false };
  }

  let ast: Script & { errors?: Array<{ message: string; pos: number }> };
  try {
    ast = parse(trimmed);
  } catch {
    return { segments: [], unparseable: true };
  }

  // If there are parse errors, treat as unparseable
  if (ast.errors && ast.errors.length > 0) {
    return { segments: [], unparseable: true };
  }

  const segments = processScript(ast, false);
  if (!segments) {
    return { segments: [], unparseable: true };
  }

  return { segments, unparseable: false };
}
