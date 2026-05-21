import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, SettingsList, type SettingItem } from "@earendil-works/pi-tui";
import type { ResolvedPolicy, CommandEntry } from "./types";
import { GLOBAL_POLICY_DIR, getLocalPolicyDir } from "./paths";
import { resolvePolicy, listStarters, listAllGroups } from "./loader";
import { validateCommand, isValidGlob, generateGlobExamples } from "./validator";
import { addCommandToGroup, setGroupActive, copyStarter, readManifest } from "./writer";
import { migrateStarterPolicies } from "./migrate";


interface State {
  policy: ResolvedPolicy | null;
  cwd: string;
}

export default function trustPolicyExtension(pi: ExtensionAPI): void {
  const state: State = { policy: null, cwd: process.cwd() };

  pi.on("session_start", async (_event, ctx) => {
    state.cwd = ctx.cwd;
    migrateStarterPolicies();
    state.policy = loadAndDisplay(state.cwd, ctx);
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    if (!state.policy) return;
    const command = event.input.command;
    if (!command || typeof command !== "string") return;

    const result = validateCommand(command, state.policy);
    if (result.allowed) return undefined;
    if (!ctx.hasUI) return { block: true, reason: `Trust policy: ${result.reason}` };
    return await promptUntrusted(command, result.reason ?? "", state, ctx);
  });

  pi.registerCommand("trust-policy", {
    description: "Manage trust policies — toggle active groups on/off",
    handler: async (_args, ctx) => {
      await openPolicyManager(state.cwd, ctx);
      state.policy = loadAndDisplay(state.cwd, ctx);
    },
  });


}

function loadAndDisplay(cwd: string, ctx: ExtensionContext): ResolvedPolicy {
  const policy = resolvePolicy(cwd);
  for (const w of policy.warnings) ctx.ui.notify(`⚠️ Trust Policy: ${w}`, "warning");

  const status = policy.groups.size > 0
    ? ctx.ui.theme.fg("success", `🔒 ${[...policy.groups.keys()].join(", ")}`)
    : ctx.ui.theme.fg("dim", "🔓 no trust policy");
  ctx.ui.setStatus("trust-policy", status);

  return policy;
}

async function openPolicyManager(cwd: string, ctx: ExtensionContext): Promise<void> {
  const localDir = getLocalPolicyDir(cwd);
  const globalManifest = readManifest(GLOBAL_POLICY_DIR);
  const localManifest = readManifest(localDir);
  const allGroups = listAllGroups(cwd).filter((g) => g.isAggregate).sort((a, b) => a.name.localeCompare(b.name));

  const items: SettingItem[] = allGroups.map(({ name, description }) => {
    const inGlobal = globalManifest.active.includes(name);
    const inLocal = localManifest.active.includes(name);
    const currentValue = resolveActivationState(inGlobal, inLocal);
    return {
      id: name,
      label: name,
      description,
      currentValue,
      values: ["inactive", "local", "global", "global & local"],
    };
  });

  await ctx.ui.custom((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild({
      render() { return [theme.fg("accent", theme.bold("Trust Policy Manager")), theme.fg("dim", "Enter/Space to cycle. Esc to close."), ""]; },
      invalidate() {},
    });

    const list = new SettingsList(items, Math.min(items.length + 2, 20), getSettingsListTheme(),
      (id: string, newValue: string) => {
        applyActivationState(id, newValue, localDir);
      },
      () => done(undefined),
      { enableSearch: true },
    );
    container.addChild(list);

    return {
      render(width: number) { return container.render(width); },
      invalidate() { container.invalidate(); },
      handleInput(data: string) { list.handleInput(data); tui.requestRender(); },
    };
  });
}

function resolveActivationState(inGlobal: boolean, inLocal: boolean): string {
  if (inGlobal && inLocal) return "global & local";
  if (inGlobal) return "global";
  if (inLocal) return "local";
  return "inactive";
}

function applyActivationState(id: string, newValue: string, localDir: string): void {
  const shouldGlobal = newValue === "global" || newValue === "global & local";
  const shouldLocal = newValue === "local" || newValue === "global & local";

  if (shouldGlobal) {
    if (listStarters().includes(id)) copyStarter(id, GLOBAL_POLICY_DIR);
    setGroupActive(id, GLOBAL_POLICY_DIR, true);
  } else {
    setGroupActive(id, GLOBAL_POLICY_DIR, false);
  }

  if (shouldLocal) {
    if (listStarters().includes(id)) copyStarter(id, localDir);
    setGroupActive(id, localDir, true);
  } else {
    setGroupActive(id, localDir, false);
  }
}

async function promptUntrusted(
  command: string, reason: string, state: State, ctx: ExtensionContext,
): Promise<{ block: true; reason: string } | undefined> {
  const options = ["Yes (allow once)", "No (deny)"];
  for (const name of state.policy!.groups.keys()) options.push(`Yes + add to: ${name}`);

  const choice = await ctx.ui.select(`🔒 Not covered by trust policy:\n\n  ${command}\n\n${reason}\n\nAllow?`, options);
  if (!choice || choice === "No (deny)") return { block: true, reason: "Blocked by trust policy (user denied)" };

  if (choice.startsWith("Yes + add to: ")) {
    await persistToGroup(command, choice.slice("Yes + add to: ".length), state, ctx);
  }
  return undefined;
}

async function persistToGroup(command: string, groupName: string, state: State, ctx: ExtensionContext): Promise<void> {
  const glob = await promptGlob(command, ctx);
  if (!glob) return;

  const pipe = (await ctx.ui.select(`Allow "${glob}" in pipelines?`, ["No", "Yes"])) === "Yes";
  const embedded = (await ctx.ui.select(`Allow "${glob}" in substitutions?`, ["No", "Yes"])) === "Yes";

  const ex = generateGlobExamples(glob);
  const preview = ["Allows:", ...ex.matches.map((m) => `  ✓ ${m}`), "", "Blocks:", ...ex.nonMatches.map((m) => `  ✗ ${m}`)].join("\n");
  const ok = await ctx.ui.select(`${preview}\n\nAdd to "${groupName}"?`, ["Yes", "Cancel"]);
  if (ok !== "Yes") return;

  const entry: CommandEntry = { glob, pipe, embedded, redirect: "none" };
  const localDir = getLocalPolicyDir(state.cwd);
  const added = addCommandToGroup(groupName, entry, localDir) || addCommandToGroup(groupName, entry, GLOBAL_POLICY_DIR);

  if (added) {
    ctx.ui.notify(`✓ Added "${glob}" to ${groupName}`, "info");
    state.policy = loadAndDisplay(state.cwd, ctx);
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
