import { execSync } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TrustPolicyGroup, CommandEntry } from "./types.js";
import { GLOBAL_POLICY_DIR, getLocalPolicyDir } from "./paths.js";
import { loadStarterGroup, listStarters } from "./loader.js";
import { writeGroupFile, setGroupActive, formatGroupAsYaml } from "./writer.js";
import { isValidGlob, generateGlobExamples } from "./validator.js";

export async function runCreationWizard(cwd: string, ctx: ExtensionContext): Promise<void> {
  const scope = await promptScope(ctx);
  if (!scope) return;

  const category = await ctx.ui.input("What kind of work does this policy cover? (e.g., 'git operations', 'docker development'):", "");
  if (!category) return;

  const templateCommands = await promptTemplate(ctx);

  const defaultName = category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const name = await ctx.ui.input("Policy name (lowercase, hyphens only):", defaultName);
  if (!name) return;

  const commands = await collectCommands(templateCommands, ctx);
  if (commands.length === 0) {
    ctx.ui.notify("No commands added. Cancelled.", "info");
    return;
  }

  const group: TrustPolicyGroup = { name, description: `${category} - trust policy`, commands };

  if (!(await reviewLoop(group, ctx))) return;

  const targetDir = scope === "global" ? GLOBAL_POLICY_DIR : getLocalPolicyDir(cwd);
  const filePath = writeGroupFile(group, targetDir);
  ctx.ui.notify(`✓ Written to: ${filePath}`, "info");

  const activate = await ctx.ui.select("Activate this policy now?", ["Yes", "No"]);
  if (activate === "Yes") {
    setGroupActive(group.name, targetDir, true);
    ctx.ui.notify(`✓ Policy "${group.name}" is now active`, "info");
  }
}

async function promptScope(ctx: ExtensionContext): Promise<"global" | "local" | null> {
  const choice = await ctx.ui.select("Scope?", ["Global (applies everywhere)", "Local (this project only)"]);
  if (!choice) return null;
  return choice.startsWith("Global") ? "global" : "local";
}

async function promptTemplate(ctx: ExtensionContext): Promise<CommandEntry[]> {
  const starters = listStarters();
  if (starters.length === 0) return [];
  const choice = await ctx.ui.select("Start from a template?", ["No, start fresh", ...starters.map((s) => `Start from: ${s}`)]);
  if (!choice || choice === "No, start fresh") return [];
  const group = loadStarterGroup(choice.replace("Start from: ", ""));
  return group?.commands ?? [];
}

async function collectCommands(initial: CommandEntry[], ctx: ExtensionContext): Promise<CommandEntry[]> {
  const commands = [...initial];
  if (commands.length > 0) {
    ctx.ui.notify(`Starting with ${commands.length} commands from template. Type 'done' to finish.`, "info");
  }

  while (true) {
    const input = await ctx.ui.input(`Command glob (${commands.length} so far, 'done' to finish):`, "");
    if (!input || input.trim().toLowerCase() === "done") break;

    const glob = input.trim();
    const validation = isValidGlob(glob);
    if (!validation.valid) { ctx.ui.notify(`Invalid: ${validation.error}`, "error"); continue; }

    const pipe = (await ctx.ui.select(`Allow "${glob}" in pipelines?`, ["No", "Yes"])) === "Yes";
    const embedded = (await ctx.ui.select(`Allow "${glob}" in command substitutions?`, ["No", "Yes"])) === "Yes";
    const description = await ctx.ui.input("Description (optional):", "");

    commands.push({ glob, pipe, embedded, description: description || undefined });
    await runAdversarialReview(glob, ctx);
  }

  return commands;
}

async function reviewLoop(group: TrustPolicyGroup, ctx: ExtensionContext): Promise<boolean> {
  while (true) {
    const yaml = formatGroupAsYaml(group);
    const choice = await ctx.ui.select(`\`\`\`yaml\n${yaml}\`\`\`\n\nWhat next?`, ["Approve and save", "Edit (describe changes)", "Cancel"]);
    if (!choice || choice === "Cancel") return false;
    if (choice === "Approve and save") return true;
    await ctx.ui.input("Describe your changes:", "");
    ctx.ui.notify("Edit the YAML file directly after saving, or re-run the wizard.", "info");
  }
}

async function runAdversarialReview(glob: string, ctx: ExtensionContext): Promise<void> {
  const choice = await ctx.ui.select(`Review what "${glob}" allows?`, ["Computed guidance (Recommended)", "Skip review"]);
  if (!choice || choice === "Skip review") return;

  const base = glob.split(" ")[0];
  if (base) {
    let output = "";
    try { output = execSync(`${base} --help 2>&1`, { encoding: "utf-8", timeout: 5000 }); }
    catch (e: unknown) { const err = e as { stdout?: string; stderr?: string }; output = err.stdout ?? err.stderr ?? ""; }
    if (output) ctx.ui.notify(`'${base}' help (truncated):\n${output.slice(0, 1500)}`, "info");
  }

  const ex = generateGlobExamples(glob);
  ctx.ui.notify([`Glob: ${glob}`, "", "Allows:", ...ex.matches.map((m) => `  ✓ ${m}`), "", "Blocks:", ...ex.nonMatches.map((m) => `  ✗ ${m}`)].join("\n"), "info");

  const ok = await ctx.ui.select("Comfortable with this?", ["Yes", "No, I'll edit later"]);
  if (ok === "No, I'll edit later") ctx.ui.notify("Edit the YAML after creation.", "info");
}
