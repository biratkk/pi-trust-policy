import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { POLICIES_DIR, BUNDLED_STARTERS_DIR } from "./paths";

const HASH_MANIFEST_PATH = join(POLICIES_DIR, ".starter-hashes.json");

type HashManifest = Record<string, string>;

export interface StarterUpdate {
  relativePath: string;
  kind: "modified" | "new";
}

/**
 * Detects starters that have changed upstream (in the bundled package)
 * compared to what was last installed. Returns a list of updates available.
 */
export function detectStarterUpdates(): StarterUpdate[] {
  if (!existsSync(BUNDLED_STARTERS_DIR)) return [];
  const manifest = loadHashManifest();
  const updates: StarterUpdate[] = [];

  collectUpdates(BUNDLED_STARTERS_DIR, POLICIES_DIR, "", manifest, updates);
  return updates;
}

/**
 * Applies pending starter updates by copying changed files and updating the hash manifest.
 * Only updates files that haven't been locally modified by the user.
 */
export function applyStarterUpdates(updates: StarterUpdate[]): void {
  if (updates.length === 0) return;
  mkdirSync(POLICIES_DIR, { recursive: true });
  const manifest = loadHashManifest();

  for (const update of updates) {
    const srcPath = join(BUNDLED_STARTERS_DIR, update.relativePath);
    const destPath = join(POLICIES_DIR, update.relativePath);
    const destDir = join(destPath, "..");
    mkdirSync(destDir, { recursive: true });

    const srcContent = readFileSync(srcPath);
    writeFileSync(destPath, srcContent);
    manifest[update.relativePath] = hashBuffer(srcContent);
  }

  saveHashManifest(manifest);
}

/**
 * Records the current state of installed policies into the hash manifest.
 * Called after initial migration to establish baseline.
 */
export function recordInstalledHashes(): void {
  if (!existsSync(POLICIES_DIR)) return;
  const manifest: HashManifest = {};
  collectHashes(POLICIES_DIR, "", manifest);
  saveHashManifest(manifest);
}

function collectUpdates(srcDir: string, destDir: string, prefix: string, manifest: HashManifest, updates: StarterUpdate[]): void {
  if (!existsSync(srcDir)) return;
  for (const entry of readdirSync(srcDir)) {
    if (entry.startsWith(".")) continue;
    if (entry.endsWith(".test.json")) continue;

    const srcPath = join(srcDir, entry);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;

    if (statSync(srcPath).isDirectory()) {
      collectUpdates(srcPath, join(destDir, entry), relativePath, manifest, updates);
    } else if (entry.endsWith(".yaml")) {
      const destPath = join(destDir, entry);
      const srcHash = hashFile(srcPath);

      if (!existsSync(destPath)) {
        updates.push({ relativePath, kind: "new" });
      } else {
        const previousHash = manifest[relativePath];
        if (previousHash && previousHash !== srcHash) {
          const destHash = hashFile(destPath);
          if (destHash === previousHash) {
            updates.push({ relativePath, kind: "modified" });
          }
        }
      }
    }
  }
}

function collectHashes(dir: string, prefix: string, manifest: HashManifest): void {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const fullPath = join(dir, entry);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;

    if (statSync(fullPath).isDirectory()) {
      collectHashes(fullPath, relativePath, manifest);
    } else if (entry.endsWith(".yaml")) {
      manifest[relativePath] = hashFile(fullPath);
    }
  }
}

function hashFile(path: string): string {
  return hashBuffer(readFileSync(path));
}

function hashBuffer(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function loadHashManifest(): HashManifest {
  if (!existsSync(HASH_MANIFEST_PATH)) return {};
  try {
    return JSON.parse(readFileSync(HASH_MANIFEST_PATH, "utf-8")) as HashManifest;
  } catch {
    return {};
  }
}

function saveHashManifest(manifest: HashManifest): void {
  mkdirSync(POLICIES_DIR, { recursive: true });
  writeFileSync(HASH_MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
}
