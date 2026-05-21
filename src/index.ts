import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import type { ResolvedPolicy } from "./types";
import { resolvePolicy } from "./loader";
import { validateCommand } from "./validator";
import { migrateStarterPolicies } from "./migrate";
import { openPolicyManager } from "./policy-manager-ui";
import { promptUntrusted } from "./untrusted-prompt";

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

    return await promptUntrusted(command, result.reason ?? "", state.policy, state.cwd, ctx, () => {
      state.policy = loadAndDisplay(state.cwd, ctx);
    });
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
