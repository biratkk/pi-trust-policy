import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateCommand } from "../src/validator";
import { PolicyRegistry } from "../src/registry";
import type { ResolvedPolicy, CommandEntry } from "../src/types";

const STARTERS_DIR = resolve(__dirname, "..", "starters");

interface TestCase {
  command: string;
  allowed: boolean;
  label: string;
}

interface TestFile {
  policy: string;
  cases: TestCase[];
}

function discoverTestFiles(dir: string): Array<{ path: string; file: TestFile }> {
  const results: Array<{ path: string; file: TestFile }> = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      results.push(...discoverTestFiles(fullPath));
    } else if (entry.endsWith(".test.json")) {
      const content = JSON.parse(readFileSync(fullPath, "utf-8")) as TestFile;
      results.push({ path: fullPath, file: content });
    }
  }
  return results;
}

function resolveStarterPolicy(policyName: string): ResolvedPolicy {
  const registry = new PolicyRegistry([{ path: STARTERS_DIR, source: "policies" }]);
  const warnings: string[] = [];
  const commands = registry.resolve(policyName, new Set(), warnings);
  const group = registry.get(policyName);
  const groups = new Map<string, { description: string; commands: CommandEntry[] }>();
  if (group) groups.set(policyName, { description: group.description, commands });
  return { commands, groups, warnings };
}

const testFiles = discoverTestFiles(STARTERS_DIR);

for (const { path, file } of testFiles) {
  const relativePath = path.replace(STARTERS_DIR + "/", "");
  describe(`starter: ${relativePath}`, () => {
    const policy = resolveStarterPolicy(file.policy);

    for (const { command, allowed, label } of file.cases) {
      it(`${allowed ? "allows" : "denies"}: ${label}`, () => {
        const result = validateCommand(command, policy);
        expect(result.allowed, `"${command}" expected ${allowed ? "allowed" : "denied"} but got ${result.allowed ? "allowed" : "denied"}${result.reason ? ` (${result.reason})` : ""}`).toBe(allowed);
      });
    }
  });
}
