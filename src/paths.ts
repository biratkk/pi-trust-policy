/**
 * Trust Policy Paths
 *
 * Single source of truth for all trust-policy directory locations.
 */

import { join, resolve } from "node:path";

const HOME = process.env.HOME ?? "~";

export const GLOBAL_POLICY_DIR = join(HOME, ".pi", "agent", "trust-policy");
export const STARTERS_DIR = resolve(import.meta.dirname ?? __dirname, "..", "starters");

export function getLocalPolicyDir(cwd: string): string {
  return join(cwd, ".pi", "trust-policy");
}
