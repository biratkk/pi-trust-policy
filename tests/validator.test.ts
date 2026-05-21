import { describe, it, expect } from "vitest";
import { validateCommand, isValidGlob, generateGlobExamples } from "../src/validator.js";
import type { ResolvedPolicy, CommandEntry } from "../src/types.js";

function buildPolicy(entries: CommandEntry[]): ResolvedPolicy {
  return {
    commands: entries,
    groups: new Map([["test-group", { description: "Test", commands: entries }]]),
    warnings: [],
  };
}

const POLICY = buildPolicy([
  { glob: "git log *", pipe: true, embedded: true },
  { glob: "git log", pipe: true, embedded: true },
  { glob: "git status", pipe: true, embedded: false },
  { glob: "grep *", pipe: true, embedded: true },
  { glob: "wc *", pipe: true, embedded: true },
  { glob: "echo *", pipe: false, embedded: false },
]);

describe("validateCommand", () => {
  describe("allowed commands", () => {
    it("allows a command matching a glob", () => {
      expect(validateCommand("git log --oneline", POLICY).allowed).toBe(true);
    });

    it("allows exact match", () => {
      expect(validateCommand("git status", POLICY).allowed).toBe(true);
    });

    it("allows pipeline when all segments have pipe: true", () => {
      expect(validateCommand("git log --oneline | grep feat", POLICY).allowed).toBe(true);
    });

    it("allows command substitution when inner has embedded: true", () => {
      expect(validateCommand("echo $(git log --oneline)", POLICY).allowed).toBe(true);
    });

    it("reports matched group", () => {
      const result = validateCommand("git log --oneline", POLICY);
      expect(result.matchedGroup).toBe("test-group");
    });
  });

  describe("denied commands", () => {
    it("denies unmatched commands", () => {
      expect(validateCommand("git push origin main", POLICY).allowed).toBe(false);
    });

    it("denies commands with env vars", () => {
      const result = validateCommand("NODE_ENV=prod npm start", POLICY);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("unparseable");
    });

    it("denies dangerous commands not in policy", () => {
      expect(validateCommand("rm -rf /", POLICY).allowed).toBe(false);
    });

    it("denies eval", () => {
      expect(validateCommand('eval "dangerous"', POLICY).allowed).toBe(false);
    });

    it("denies variable in command position", () => {
      expect(validateCommand("$CMD arg1", POLICY).allowed).toBe(false);
    });
  });

  describe("pipe/embedded flag enforcement", () => {
    it("denies pipeline when segment lacks pipe: true", () => {
      const policy = buildPolicy([
        { glob: "echo *", pipe: false, embedded: false },
        { glob: "grep *", pipe: true, embedded: false },
      ]);
      const result = validateCommand("echo hello | grep h", policy);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("pipe: true");
    });

    it("denies substitution when segment lacks embedded: true", () => {
      const policy = buildPolicy([
        { glob: "echo *", pipe: false, embedded: false },
        { glob: "git status", pipe: false, embedded: false },
      ]);
      const result = validateCommand("echo $(git status)", policy);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("embedded: true");
    });
  });
});

describe("isValidGlob", () => {
  it("accepts valid patterns", () => {
    expect(isValidGlob("git push *").valid).toBe(true);
    expect(isValidGlob("npm run [dev,build]").valid).toBe(true);
  });

  it("rejects empty patterns", () => {
    expect(isValidGlob("").valid).toBe(false);
    expect(isValidGlob("   ").valid).toBe(false);
  });

  it("rejects unmatched brackets", () => {
    expect(isValidGlob("git [branch").valid).toBe(false);
    expect(isValidGlob("git [branch").error).toContain("bracket");
  });

  it("rejects unmatched braces", () => {
    expect(isValidGlob("git {push").valid).toBe(false);
  });
});

describe("generateGlobExamples", () => {
  it("generates examples for trailing wildcard", () => {
    const ex = generateGlobExamples("git push *");
    expect(ex.matches.length).toBeGreaterThan(0);
    expect(ex.nonMatches.length).toBeGreaterThan(0);
    expect(ex.matches.every((m) => m.startsWith("git push"))).toBe(true);
  });

  it("generates examples for exact match", () => {
    const ex = generateGlobExamples("git status");
    expect(ex.matches).toContain("git status");
  });
});
