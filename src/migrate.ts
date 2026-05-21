import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { POLICIES_DIR, BUNDLED_STARTERS_DIR } from "./paths";

/**
 * Migrates bundled starter policies into ~/.pi/agent/trust-policy/policies/.
 * Only copies files that don't already exist (preserves user edits).
 * Called on extension load to ensure policies dir is populated.
 */
export function migrateStarterPolicies(): void {
  if (!existsSync(BUNDLED_STARTERS_DIR)) return;
  mkdirSync(POLICIES_DIR, { recursive: true });
  copyDirRecursive(BUNDLED_STARTERS_DIR, POLICIES_DIR);
}

function copyDirRecursive(src: string, dest: string): void {
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);

    if (statSync(srcPath).isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath);
    } else if (!existsSync(destPath)) {
      copyFileSync(srcPath, destPath);
    }
  }
}
