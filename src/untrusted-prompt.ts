import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ResolvedPolicy, CommandEntry } from "./types";
import { GLOBAL_POLICY_DIR, getLocalPolicyDir } from "./paths";
import { validateCommand, isValidGlob, generateGlobExamples } from "./validator";
import { addCommandToGroup } from "./writer";

interface PromptResult {
  block: true;
  reason: string;
}

export async function promptUntrusted(
  command: string, reason: string, policy: ResolvedPolicy, cwd: string, ctx: ExtensionContext, onPolicyChanged: () => void,
): Promise<PromptResult | undefined> {
  const options = ["Yes (allow once)", "No (deny)"];
  for (const name of policy.groups.keys()) options.push(`Yes + add to: ${name}`);

  const choice = await ctx.ui.select(`🔒 Not covered by trust policy:\n\n  ${command}\n\n${reason}\n\nAllow?`, options);
  if (!choice || choice === "No (deny)") return { block: true, reason: "Blocked by trust policy (user denied)" };

  if (choice.startsWith("Yes + add to: ")) {
    await persistToGroup(command, choice.slice("Yes + add to: ".length), cwd, ctx, onPolicyChanged);
  }
  return undefined;
}

async function persistToGroup(command: string, groupName: string, cwd: string, ctx: ExtensionContext, onPolicyChanged: () => void): Promise<void> {
  const glob = await promptGlob(command, ctx);
  if (!glob) return;

  const pipe = (await ctx.ui.select(`Allow "${glob}" in pipelines?`, ["No", "Yes"])) === "Yes";
  const embedded = (await ctx.ui.select(`Allow "${glob}" in substitutions?`, ["No", "Yes"])) === "Yes";

  const ex = generateGlobExamples(glob);
  const preview = ["Allows:", ...ex.matches.map((m) => `  ✓ ${m}`), "", "Blocks:", ...ex.nonMatches.map((m) => `  ✗ ${m}`)].join("\n");
  const ok = await ctx.ui.select(`${preview}\n\nAdd to "${groupName}"?`, ["Yes", "Cancel"]);
  if (ok !== "Yes") return;

  const entry: CommandEntry = { glob, pipe, embedded, redirect: "none", passthrough: false, skipFlags: [], skipFlagsWithArg: [] };
  const localDir = getLocalPolicyDir(cwd);
  const added = addCommandToGroup(groupName, entry, localDir) || addCommandToGroup(groupName, entry, GLOBAL_POLICY_DIR);

  if (added) {
    ctx.ui.notify(`✓ Added "${glob}" to ${groupName}`, "info");
    onPolicyChanged();
  } else {
    ctx.ui.notify(`✗ Failed to add to ${groupName}`, "error");
  }
}

async function promptGlob(command: string, ctx: ExtensionContext): Promise<string | null> {
  const parts = command.split(" ");
  const suggestions = [...new Set([command, ...(parts.length > 2 ? [`${parts.slice(0, 2).join(" ")} *`] : []), ...(parts.length > 1 ? [`${parts[0]} *`] : [])])];

  const chosen = await ctx.ui.select(`Glob pattern for: ${command}`, [...suggestions, "Type custom..."]);
  if (!chosen) return null;
  if (chosen !== "Type custom...") return chosen;

  for (let i = 0; i < 5; i++) {
    const input = await ctx.ui.input(i === 0 ? "Enter glob pattern:" : "Invalid. Try again:", "");
    if (!input?.trim()) return null;
    const v = isValidGlob(input.trim());
    if (v.valid) return input.trim();
    ctx.ui.notify(`Invalid: ${v.error}`, "error");
  }
  return null;
}
