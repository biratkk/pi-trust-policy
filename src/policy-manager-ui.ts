import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, SettingsList, type SettingItem } from "@earendil-works/pi-tui";
import { GLOBAL_POLICY_DIR, getLocalPolicyDir } from "./paths";
import { listStarters, listAllGroups } from "./loader";
import { setGroupActive, copyStarter, readManifest } from "./writer";

export async function openPolicyManager(cwd: string, ctx: ExtensionContext): Promise<void> {
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
