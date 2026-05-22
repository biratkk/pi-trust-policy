import { parse } from "unbash";
import type { Script, Node, Command, Word, WordPart, CommandExpansionPart } from "unbash";
import type { CommandSegment } from "./types";

export function parseCommand(command: string): { segments: CommandSegment[]; unparseable: boolean } {
  const trimmed = command.trim();
  if (!trimmed) return { segments: [], unparseable: false };

  try {
    const ast = parse(trimmed) as Script & { errors?: unknown[] };
    if (ast.errors?.length) return { segments: [], unparseable: true };
    const segments = processScript(ast, false);
    return segments ? { segments, unparseable: false } : { segments: [], unparseable: true };
  } catch {
    return { segments: [], unparseable: true };
  }
}

function processScript(script: Script, requiresEmbedded: boolean): CommandSegment[] | null {
  const segments: CommandSegment[] = [];
  for (const stmt of script.commands) {
    const result = processNode(stmt, false, requiresEmbedded);
    if (!result) return null;
    segments.push(...result);
  }
  return segments;
}

function processNode(node: Node, requiresPipe: boolean, requiresEmbedded: boolean): CommandSegment[] | null {
  switch (node.type) {
    case "Command":
      return processCommand(node, requiresPipe, requiresEmbedded);
    case "Pipeline": {
      const segments: CommandSegment[] = [];
      const isPipe = node.commands.length > 1;
      for (const cmd of node.commands) {
        const result = processNode(cmd, isPipe, requiresEmbedded);
        if (!result) return null;
        segments.push(...result);
      }
      return segments;
    }
    case "AndOr": {
      const segments: CommandSegment[] = [];
      for (const cmd of node.commands) {
        const result = processNode(cmd, false, requiresEmbedded);
        if (!result) return null;
        segments.push(...result);
      }
      return segments;
    }
    case "Statement":
      return processNode(node.command, requiresPipe, requiresEmbedded);
    case "Subshell":
    case "BraceGroup": {
      const segments: CommandSegment[] = [];
      const embedded = node.type === "Subshell" || requiresEmbedded;
      for (const stmt of node.body.commands) {
        const result = processNode(stmt, requiresPipe, embedded);
        if (!result) return null;
        segments.push(...result);
      }
      return segments;
    }
    default:
      return null;
  }
}

function processCommand(node: Command, requiresPipe: boolean, requiresEmbedded: boolean): CommandSegment[] | null {
  if (node.prefix.length > 0) return null;
  if (!node.name) return null;
  if (isUnparseableName(node)) return null;
  if (node.name.value === "eval" || node.name.value === "export") return null;

  const bashC = extractBashCInner(node);
  if (bashC) {
    const inner = parseCommand(bashC);
    if (inner.unparseable) return null;
    return inner.segments.map((s) => ({ ...s, requiresEmbedded: true }));
  }

  const xargsInner = extractXargsInner(node);
  if (xargsInner) {
    if (xargsInner === "unparseable") return null;
    const redirect = detectRedirect(node);
    return [{ command: xargsInner, requiresPipe, requiresEmbedded, redirect }];
  }

  const segments: CommandSegment[] = [];

  for (const word of node.suffix) {
    if (!processExpansions(word, segments)) return null;
  }
  if (node.name.parts) {
    if (!processExpansions(node.name, segments)) return null;
  }

  const redirect = detectRedirect(node);
  const commandText = [node.name.text, ...node.suffix.map((w) => w.text)].join(" ");
  segments.push({ command: commandText, requiresPipe, requiresEmbedded, redirect });
  return segments;
}

function detectRedirect(node: Command): "none" | "append" | "overwrite" {
  if (!node.redirects || node.redirects.length === 0) return "none";
  let hasOverwrite = false;
  let hasAppend = false;
  for (const redir of node.redirects) {
    if (redir.target?.value === "/dev/null") continue;
    if (redir.operator === ">") hasOverwrite = true;
    else if (redir.operator === ">>") hasAppend = true;
  }
  if (hasOverwrite) return "overwrite";
  if (hasAppend) return "append";
  return "none";
}

function isUnparseableName(node: Command): boolean {
  if (!node.name) return true;
  if (node.name.parts) {
    return node.name.parts.some((p) => p.type === "SimpleExpansion" || p.type === "ParameterExpansion");
  }
  return /^\$/.test(node.name.text);
}

function extractBashCInner(node: Command): string | null {
  const name = node.name?.value;
  if (name !== "bash" && name !== "sh") return null;
  const idx = node.suffix.findIndex((w) => w.value === "-c");
  if (idx === -1 || idx + 1 >= node.suffix.length) return null;
  return node.suffix[idx + 1].value;
}

const XARGS_COMPLEX_FLAGS = new Set(["-I", "--replace", "-L", "--max-lines"]);

function extractXargsInner(node: Command): string | "unparseable" | null {
  if (node.name?.value !== "xargs") return null;
  const args = node.suffix;
  if (args.length === 0) return null;

  let i = 0;
  while (i < args.length) {
    const val = args[i].value;
    if (XARGS_COMPLEX_FLAGS.has(val)) return "unparseable";
    if (val.startsWith("-I") && val.length > 2) return "unparseable";
    if (val.startsWith("-")) {
      if (val === "-n" || val === "-P" || val === "--max-procs" || val === "--max-args") {
        i += 2;
      } else {
        i++;
      }
    } else {
      break;
    }
  }

  if (i >= args.length) return null;
  const innerParts = args.slice(i).map((w) => w.text);
  return innerParts.join(" ");
}

function processExpansions(word: Word, segments: CommandSegment[]): boolean {
  const expansions = extractCommandExpansions(word);
  for (const exp of expansions) {
    if (exp.script) {
      const inner = processScript(exp.script, true);
      if (!inner) return false;
      segments.push(...inner);
    } else if (exp.inner) {
      const inner = parseCommand(exp.inner);
      if (inner.unparseable) return false;
      segments.push(...inner.segments.map((s) => ({ ...s, requiresEmbedded: true })));
    }
  }
  return true;
}

function extractCommandExpansions(word: Word): CommandExpansionPart[] {
  const out: CommandExpansionPart[] = [];
  if (!word.parts) return out;
  for (const part of word.parts) {
    if (part.type === "CommandExpansion") {
      out.push(part);
    } else if (part.type === "DoubleQuoted") {
      for (const child of part.parts) {
        if (child.type === "CommandExpansion") out.push(child);
      }
    }
  }
  return out;
}
