/**
 * Trust Policy Extension for Pi
 *
 * Bash command allowlist system with grouped trust policies.
 * Commands not covered by active policies trigger a confirmation prompt.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import type { ResolvedPolicy, CommandEntry } from "./types.js";
import { GLOBAL_POLICY_DIR, getLocalPolicyDir } from "./paths.js";
import { resolvePolicy, listStarters } from "./loader.js";
import { validateCommand, isValidGlob, generateGlobExamples } from "./validator.js";
import { addCommandToGroup, activateGroup, copyStarter, readManifest } from "./writer.js";
import { runCreationWizard } from "./wizard.js";

export default function trustPolicyExtension(pi: ExtensionAPI): void {
  let policy: ResolvedPolicy | null = null;
  let cwd: string = process.cwd();

  pi.on("session_start", async (_event, ctx) => {
    cwd = ctx.cwd;
    reloadPolicy(ctx);
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    if (!policy) return;

    const command = event.input.command;
    if (!command || typeof command !== "string") return;

    const result = validateCommand(command, policy);
    if (result.allowed) return undefined;

    if (!ctx.hasUI) {
      return { block: true, reason: `Trust policy: ${result.reason}` };
    }

    return await promptUntrustedCommand(command, result.reason ?? "", ctx);
  });

  pi.registerCommand("trust-policy:create", {
    description: "Create a new trust policy group through an interactive session",
    handler: async (_args, ctx) => {
      await runCreationWizard(cwd, ctx);
      reloadPolicy(ctx);
    },
  });

  pi.registerCommand("trust-policy:list", {
    description: "List active and available trust policy groups",
    handler: async (_args, ctx) => {
      showPolicyList(ctx);
    },
  });

  pi.registerCommand("trust-policy:activate", {
    description: "Activate a trust policy group",
    handler: async (args, ctx) => {
      await activatePolicyInteractive(args, ctx);
    },
  });

  // --- Core functions ---

  function reloadPolicy(ctx: ExtensionContext): void {
    policy = resolvePolicy(cwd);

    for (const warning of policy.warnings) {
      ctx.ui.notify(`⚠️ Trust Policy: ${warning}`, "warning");
    }

    updateStatusIndicator(policy, ctx);
  }

  function updateStatusIndicator(resolved: ResolvedPolicy, ctx: ExtensionContext): void {
    if (resolved.groups.size > 0) {
      const names = [...resolved.groups.keys()].join(", ");
      ctx.ui.setStatus("trust-policy", ctx.ui.theme.fg("success", `🔒 ${names}`));
    } else {
      ctx.ui.setStatus("trust-policy", ctx.ui.theme.fg("dim", "🔓 no trust policy"));
    }
  }

  async function promptUntrustedCommand(
    command: string,
    reason: string,
    ctx: ExtensionContext,
  ): Promise<{ block: true; reason: string } | undefined> {
    const options = ["Yes (allow once)", "No (deny)"];
    for (const groupName of policy!.groups.keys()) {
      options.push(`Yes + add to: ${groupName}`);
    }

    const choice = await ctx.ui.select(
      `🔒 Command not covered by trust policy:\n\n  ${command}\n\n${reason}\n\nAllow?`,
      options,
    );

    if (!choice || choice === "No (deny)") {
      return { block: true, reason: "Blocked by trust policy (user denied)" };
    }

    if (choice.startsWith("Yes + add to: ")) {
      const groupName = choice.slice("Yes + add to: ".length);
      await persistCommandToGroup(command, groupName, ctx);
    }

    return undefined;
  }

  async function persistCommandToGroup(command: string, groupName: string, ctx: ExtensionContext): Promise<void> {
    const glob = await promptGlobPattern(command, ctx);
    if (!glob) return;

    const pipe = (await ctx.ui.select(
      `Should "${glob}" be allowed in pipelines?`,
      ["No", "Yes"],
    )) === "Yes";

    const embedded = (await ctx.ui.select(
      `Should "${glob}" be allowed in command substitutions?`,
      ["No", "Yes"],
    )) === "Yes";

    const examples = generateGlobExamples(glob);
    const preview = [
      "This glob would allow:",
      ...examples.matches.map((m) => `  ✓ ${m}`),
      "",
      "This glob would NOT allow:",
      ...examples.nonMatches.map((m) => `  ✗ ${m}`),
    ].join("\n");

    const confirmed = await ctx.ui.select(
      `${preview}\n\nAdd to "${groupName}"?`,
      ["Yes, add it", "Cancel"],
    );
    if (confirmed !== "Yes, add it") return;

    const entry: CommandEntry = { glob, pipe, embedded };
    const localDir = getLocalPolicyDir(cwd);

    const added =
      addCommandToGroup(groupName, entry, localDir) ||
      addCommandToGroup(groupName, entry, GLOBAL_POLICY_DIR);

    if (added) {
      ctx.ui.notify(`✓ Added "${glob}" to ${groupName}`, "info");
      reloadPolicy(ctx);
    } else {
      ctx.ui.notify(`✗ Failed to add to ${groupName}`, "error");
    }
  }

  async function promptGlobPattern(command: string, ctx: ExtensionContext): Promise<string | null> {
    const suggestions = buildGlobSuggestions(command);
    const options = [...suggestions, "Type custom glob..."];

    const chosen = await ctx.ui.select(
      `What glob pattern should match this command?\n\n  Command: ${command}`,
      options,
    );
    if (!chosen) return null;

    if (chosen === "Type custom glob...") {
      return await promptValidGlob(ctx);
    }
    return chosen;
  }

  async function promptValidGlob(ctx: ExtensionContext): Promise<string | null> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const input = await ctx.ui.input(
        attempt === 0
          ? "Enter a glob pattern (e.g., 'git push origin *'):"
          : "Invalid glob. Please try again:",
        "",
      );

      if (!input?.trim()) return null;

      const validation = isValidGlob(input.trim());
      if (validation.valid) return input.trim();

      ctx.ui.notify(`Invalid glob: ${validation.error}`, "error");
    }
    return null;
  }

  function showPolicyList(ctx: ExtensionContext): void {
    const globalManifest = readManifest(GLOBAL_POLICY_DIR);
    const localManifest = readManifest(getLocalPolicyDir(cwd));
    const lines: string[] = ["Active Trust Policies:", ""];

    if (globalManifest.active.length > 0) {
      lines.push("Global:");
      for (const name of globalManifest.active) lines.push(`  • ${name}`);
    }

    if (localManifest.active.length > 0) {
      lines.push("Local:");
      for (const name of localManifest.active) lines.push(`  • ${name}`);
    }

    if (globalManifest.active.length === 0 && localManifest.active.length === 0) {
      lines.push("  No active policies.");
    }

    lines.push("", "Available starters:");
    for (const starter of listStarters()) lines.push(`  • ${starter}`);

    ctx.ui.notify(lines.join("\n"), "info");
  }

  async function activatePolicyInteractive(args: string | undefined, ctx: ExtensionContext): Promise<void> {
    const scopeChoice = await ctx.ui.select(
      "Where should this policy be active?",
      ["Global", "Local (this project)"],
    );
    if (!scopeChoice) return;

    const targetDir = scopeChoice === "Global" ? GLOBAL_POLICY_DIR : getLocalPolicyDir(cwd);
    const name = args?.trim() || (await ctx.ui.input("Policy name to activate:", ""));
    if (!name) return;

    if (listStarters().includes(name)) {
      copyStarter(name, targetDir);
    }

    activateGroup(name, targetDir);
    ctx.ui.notify(`✓ Activated "${name}" (${scopeChoice.toLowerCase()})`, "info");
    reloadPolicy(ctx);
  }
}

// --- Pure helpers ---

function buildGlobSuggestions(command: string): string[] {
  const parts = command.split(" ");
  const suggestions: string[] = [command];

  if (parts.length > 2) {
    suggestions.push(`${parts.slice(0, 2).join(" ")} *`);
  }
  if (parts.length > 1) {
    suggestions.push(`${parts[0]} *`);
  }

  return [...new Set(suggestions)];
}
