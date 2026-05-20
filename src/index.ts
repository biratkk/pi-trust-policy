/**
 * Trust Policy Extension for Pi
 *
 * Bash command allowlist system with grouped trust policies.
 * Commands not covered by active policies trigger a confirmation prompt.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, SettingsList, type SettingItem } from "@earendil-works/pi-tui";
import type { ResolvedPolicy, CommandEntry } from "./types.js";
import { GLOBAL_POLICY_DIR, getLocalPolicyDir } from "./paths.js";
import { resolvePolicy, listStarters, listAllGroups } from "./loader.js";
import { validateCommand, isValidGlob, generateGlobExamples } from "./validator.js";
import { addCommandToGroup, activateGroup, deactivateGroup, copyStarter, readManifest } from "./writer.js";
import { runCreationWizard } from "./wizard.js";

interface ExtensionState {
  policy: ResolvedPolicy | null;
  cwd: string;
}

export default function trustPolicyExtension(pi: ExtensionAPI): void {
  const state: ExtensionState = {
    policy: null,
    cwd: process.cwd(),
  };

  pi.on("session_start", async (_event, ctx) => {
    state.cwd = ctx.cwd;
    state.policy = loadAndDisplayPolicy(state.cwd, ctx);
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    if (!state.policy) return;

    const command = event.input.command;
    if (!command || typeof command !== "string") return;

    const result = validateCommand(command, state.policy);
    if (result.allowed) return undefined;

    if (!ctx.hasUI) {
      return { block: true, reason: `Trust policy: ${result.reason}` };
    }

    return await promptUntrustedCommand(command, result.reason ?? "", state, ctx);
  });

  pi.registerCommand("trust-policy", {
    description: "Manage trust policies — toggle active groups on/off",
    handler: async (_args, ctx) => {
      await openPolicyManager(state.cwd, ctx);
      state.policy = loadAndDisplayPolicy(state.cwd, ctx);
    },
  });

  pi.registerCommand("trust-policy:create", {
    description: "Create a new trust policy group through an interactive session",
    handler: async (_args, ctx) => {
      await runCreationWizard(state.cwd, ctx);
      state.policy = loadAndDisplayPolicy(state.cwd, ctx);
    },
  });
}

// --- Policy loading ---

function loadAndDisplayPolicy(cwd: string, ctx: ExtensionContext): ResolvedPolicy {
  const policy = resolvePolicy(cwd);

  for (const warning of policy.warnings) {
    ctx.ui.notify(`⚠️ Trust Policy: ${warning}`, "warning");
  }

  if (policy.groups.size > 0) {
    const names = [...policy.groups.keys()].join(", ");
    ctx.ui.setStatus("trust-policy", ctx.ui.theme.fg("success", `🔒 ${names}`));
  } else {
    ctx.ui.setStatus("trust-policy", ctx.ui.theme.fg("dim", "🔓 no trust policy"));
  }

  return policy;
}

// --- Policy manager TUI ---

async function openPolicyManager(cwd: string, ctx: ExtensionContext): Promise<void> {
  const localDir = getLocalPolicyDir(cwd);
  const globalManifest = readManifest(GLOBAL_POLICY_DIR);
  const localManifest = readManifest(localDir);
  const allActive = new Set([...globalManifest.active, ...localManifest.active]);
  const allGroups = listAllGroups(cwd);

  const items: SettingItem[] = allGroups.map(({ name, source, description }) => ({
    id: name,
    label: name,
    description: description || sourceLabel(source),
    currentValue: allActive.has(name) ? "active" : "inactive",
    values: ["active", "inactive"],
  }));

  await ctx.ui.custom((tui, theme, _kb, done) => {
    const container = new Container();

    container.addChild({
      render(_width: number) {
        return [
          theme.fg("accent", theme.bold("Trust Policy Manager")),
          theme.fg("dim", "Toggle policies active/inactive. Starters are copied on first activation."),
          "",
        ];
      },
      invalidate() {},
    });

    const settingsList = new SettingsList(
      items,
      Math.min(items.length + 2, 20),
      getSettingsListTheme(),
      (id: string, newValue: string) => {
        handlePolicyToggle(id, newValue, localDir);
      },
      () => done(undefined),
    );

    container.addChild(settingsList);

    return {
      render(width: number) {
        return container.render(width);
      },
      invalidate() {
        container.invalidate();
      },
      handleInput(data: string) {
        settingsList.handleInput(data);
        tui.requestRender();
      },
    };
  });
}

function handlePolicyToggle(name: string, newValue: string, localDir: string): void {
  if (newValue === "active") {
    if (listStarters().includes(name)) {
      copyStarter(name, GLOBAL_POLICY_DIR);
    }
    activateGroup(name, GLOBAL_POLICY_DIR);
  } else {
    deactivateGroup(name, GLOBAL_POLICY_DIR);
    deactivateGroup(name, localDir);
  }
}

// --- Untrusted command flow ---

async function promptUntrustedCommand(
  command: string,
  reason: string,
  state: ExtensionState,
  ctx: ExtensionContext,
): Promise<{ block: true; reason: string } | undefined> {
  const options = ["Yes (allow once)", "No (deny)"];
  for (const groupName of state.policy!.groups.keys()) {
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
    await persistCommandToGroup(command, groupName, state, ctx);
  }

  return undefined;
}

async function persistCommandToGroup(
  command: string,
  groupName: string,
  state: ExtensionState,
  ctx: ExtensionContext,
): Promise<void> {
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
  const localDir = getLocalPolicyDir(state.cwd);

  const added =
    addCommandToGroup(groupName, entry, localDir) ||
    addCommandToGroup(groupName, entry, GLOBAL_POLICY_DIR);

  if (added) {
    ctx.ui.notify(`✓ Added "${glob}" to ${groupName}`, "info");
    state.policy = loadAndDisplayPolicy(state.cwd, ctx);
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

function sourceLabel(source: "local" | "global" | "starter"): string {
  switch (source) {
    case "local": return "Project-local policy";
    case "global": return "Global policy";
    case "starter": return "Built-in starter (will be copied on activation)";
  }
}
