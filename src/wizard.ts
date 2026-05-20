/**
 * Trust Policy Creation Wizard
 *
 * Interactive session that walks users through creating a new trust policy group.
 * Includes adversarial review of each command glob.
 */

import { execSync } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TrustPolicyGroup, CommandEntry } from "./types.js";
import { GLOBAL_POLICY_DIR, getLocalPolicyDir } from "./paths.js";
import { loadStarterGroup, listStarters } from "./loader.js";
import { writeGroupFile, activateGroup, formatGroupAsYaml } from "./writer.js";
import { isValidGlob, generateGlobExamples } from "./validator.js";

export async function runCreationWizard(cwd: string, ctx: ExtensionContext): Promise<void> {
  const scope = await promptScope(ctx);
  if (!scope) return;

  const category = await ctx.ui.input(
    "What kind of work does this policy cover? (e.g., 'git operations', 'docker development', 'aws cli'):",
    "",
  );
  if (!category) return;

  const templateCommands = await promptTemplate(ctx);

  const name = await promptPolicyName(category, ctx);
  if (!name) return;

  const commands = await collectCommands(templateCommands, ctx);
  if (commands.length === 0) {
    ctx.ui.notify("No commands added. Policy creation cancelled.", "info");
    return;
  }

  const group: TrustPolicyGroup = {
    name,
    description: `${category} - trust policy`,
    commands,
  };

  const approved = await reviewLoop(group, ctx);
  if (!approved) return;

  const targetDir = scope === "global" ? GLOBAL_POLICY_DIR : getLocalPolicyDir(cwd);
  const filePath = writeGroupFile(group, targetDir);
  ctx.ui.notify(`✓ Trust policy written to: ${filePath}`, "info");

  await promptActivation(group.name, targetDir, ctx);
}

// --- Wizard steps ---

async function promptScope(ctx: ExtensionContext): Promise<"global" | "local" | null> {
  const choice = await ctx.ui.select(
    "Should this trust policy be global or local to this project?",
    ["Global (applies everywhere)", "Local (this project only)"],
  );
  if (!choice) return null;
  return choice.startsWith("Global") ? "global" : "local";
}

async function promptTemplate(ctx: ExtensionContext): Promise<CommandEntry[]> {
  const starters = listStarters();
  if (starters.length === 0) return [];

  const choice = await ctx.ui.select(
    "Would you like to start from a template?",
    ["No, start fresh", ...starters.map((s) => `Start from: ${s}`)],
  );

  if (!choice || choice === "No, start fresh") return [];

  const templateName = choice.replace("Start from: ", "");
  const group = loadStarterGroup(templateName);
  return group?.commands ?? [];
}

async function promptPolicyName(category: string, ctx: ExtensionContext): Promise<string | null> {
  const defaultName = category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const name = await ctx.ui.input("Policy name (lowercase, hyphens only):", defaultName);
  return name || null;
}

async function collectCommands(initial: CommandEntry[], ctx: ExtensionContext): Promise<CommandEntry[]> {
  const commands = [...initial];

  ctx.ui.notify(
    commands.length > 0
      ? `Starting with ${commands.length} commands from template. Add more or type 'done' to finish.`
      : "Enter commands you want to trust. Type 'done' when finished.",
    "info",
  );

  while (true) {
    const input = await ctx.ui.input(
      `Command glob (${commands.length} so far, type 'done' to finish):`,
      "",
    );

    if (!input || input.trim().toLowerCase() === "done") break;

    const glob = input.trim();
    const validation = isValidGlob(glob);
    if (!validation.valid) {
      ctx.ui.notify(`Invalid glob: ${validation.error}`, "error");
      continue;
    }

    const pipe = (await ctx.ui.select(`Allow "${glob}" in pipelines?`, ["No", "Yes"])) === "Yes";
    const embedded = (await ctx.ui.select(`Allow "${glob}" in command substitutions?`, ["No", "Yes"])) === "Yes";
    const description = await ctx.ui.input("Description (optional, press enter to skip):", "");

    commands.push({ glob, pipe, embedded, description: description || undefined });

    await runAdversarialReview(glob, ctx);
  }

  return commands;
}

async function reviewLoop(group: TrustPolicyGroup, ctx: ExtensionContext): Promise<boolean> {
  while (true) {
    const yaml = formatGroupAsYaml(group);
    const choice = await ctx.ui.select(
      `Here's your trust policy:\n\n\`\`\`yaml\n${yaml}\`\`\`\n\nWhat would you like to do?`,
      ["Approve and save", "Edit (describe changes)", "Cancel"],
    );

    if (!choice || choice === "Cancel") {
      ctx.ui.notify("Policy creation cancelled.", "info");
      return false;
    }

    if (choice === "Approve and save") return true;

    const changes = await ctx.ui.input("Describe your changes:", "");
    if (changes) {
      ctx.ui.notify(
        "Please make your changes and re-run the wizard, or edit the YAML file directly after saving.",
        "info",
      );
    }
  }
}

async function promptActivation(groupName: string, dir: string, ctx: ExtensionContext): Promise<void> {
  const choice = await ctx.ui.select(
    "Would you like to activate this policy now?",
    ["Yes, activate it", "No, just save it"],
  );

  if (choice === "Yes, activate it") {
    activateGroup(groupName, dir);
    ctx.ui.notify(`✓ Policy "${groupName}" is now active`, "info");
  }
}

// --- Adversarial review ---

async function runAdversarialReview(glob: string, ctx: ExtensionContext): Promise<void> {
  const choice = await ctx.ui.select(
    `How would you like to review what "${glob}" allows?`,
    ["Computed guidance (run --help to enumerate) (Recommended)", "Agent-generated guidance", "Skip review"],
  );

  if (!choice || choice === "Skip review") return;

  if (choice.startsWith("Computed")) {
    showComputedGuidance(glob, ctx);
  }

  showGlobExamples(glob, ctx);

  const comfortable = await ctx.ui.select(
    "Are you comfortable with what this glob allows?",
    ["Yes, keep it", "No, I'll modify it later"],
  );

  if (comfortable === "No, I'll modify it later") {
    ctx.ui.notify("You can edit the YAML file after creation to adjust this glob.", "info");
  }
}

function showComputedGuidance(glob: string, ctx: ExtensionContext): void {
  const baseCommand = glob.split(" ")[0];
  if (!baseCommand) return;

  let helpOutput = "";
  try {
    helpOutput = execSync(`${baseCommand} --help 2>&1`, { encoding: "utf-8", timeout: 5000 });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    helpOutput = err.stdout ?? err.stderr ?? "";
  }

  if (helpOutput.length > 0) {
    const truncated = helpOutput.slice(0, 2000);
    ctx.ui.notify(
      `Available subcommands/options for '${baseCommand}':\n\n${truncated}\n\n⚠️ Review which of these match your glob "${glob}" and could be destructive.`,
      "info",
    );
  } else {
    ctx.ui.notify(`Could not get help for '${baseCommand}'. Consider reviewing manually.`, "warning");
  }
}

function showGlobExamples(glob: string, ctx: ExtensionContext): void {
  const examples = generateGlobExamples(glob);
  ctx.ui.notify(
    [
      `Glob: ${glob}`,
      "",
      "Would allow:",
      ...examples.matches.map((m) => `  ✓ ${m}`),
      "",
      "Would NOT allow:",
      ...examples.nonMatches.map((m) => `  ✗ ${m}`),
    ].join("\n"),
    "info",
  );
}
