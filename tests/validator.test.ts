import { describe, it, expect } from "vitest";
import { validateCommand, isValidGlob, generateGlobExamples } from "../src/validator";
import type { ResolvedPolicy, CommandEntry } from "../src/types";

function buildPolicy(entries: CommandEntry[]): ResolvedPolicy {
  return {
    commands: entries,
    groups: new Map([["test-group", { description: "Test", commands: entries }]]),
    warnings: [],
  };
}

const POLICY = buildPolicy([
  { glob: "git log *", pipe: true, embedded: true, redirect: "none" },
  { glob: "git log", pipe: true, embedded: true, redirect: "none" },
  { glob: "git status", pipe: true, embedded: false, redirect: "none" },
  { glob: "grep *", pipe: true, embedded: true, redirect: "none" },
  { glob: "wc *", pipe: true, embedded: true, redirect: "none" },
  { glob: "echo *", pipe: false, embedded: false, redirect: "none" },
]);

describe("validateCommand", () => {
  describe("allowed commands", () => {
    it("allows a command matching a glob", () => {
      expect(validateCommand("git log --oneline", POLICY).allowed).toBe(true);
    });

    it("allows exact match", () => {
      expect(validateCommand("git status", POLICY).allowed).toBe(true);
    });

    it("allows 'cat file.txt' with glob 'cat *'", () => {
      const policy = buildPolicy([{ glob: "cat *", pipe: true, embedded: false, redirect: "none" }]);
      expect(validateCommand("cat file.txt", policy).allowed).toBe(true);
    });

    it("denies 'cat /file/path' with glob 'cat *' because * does not match /", () => {
      const policy = buildPolicy([{ glob: "cat *", pipe: true, embedded: false, redirect: "none" }]);
      expect(validateCommand("cat /file/path", policy).allowed).toBe(false);
    });

    it("allows 'cat /file/path' with glob 'cat */**'", () => {
      const policy = buildPolicy([{ glob: "cat */**", pipe: true, embedded: false, redirect: "none" }]);
      expect(validateCommand("cat /file/path", policy).allowed).toBe(true);
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
        { glob: "echo *", pipe: false, embedded: false, redirect: "none" },
        { glob: "grep *", pipe: true, embedded: false, redirect: "none" },
      ]);
      const result = validateCommand("echo hello | grep h", policy);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("pipe: true");
    });

    it("denies substitution when segment lacks embedded: true", () => {
      const policy = buildPolicy([
        { glob: "echo *", pipe: false, embedded: false, redirect: "none" },
        { glob: "git status", pipe: false, embedded: false, redirect: "none" },
      ]);
      const result = validateCommand("echo $(git status)", policy);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("embedded: true");
    });
  });

  describe("redirect flag enforcement", () => {
    it("allows overwrite redirect when entry has redirect: overwrite", () => {
      const policy = buildPolicy([
        { glob: "echo *", pipe: false, embedded: false, redirect: "overwrite" },
      ]);
      expect(validateCommand("echo hello > file.txt", policy).allowed).toBe(true);
    });

    it("allows append redirect when entry has redirect: append", () => {
      const policy = buildPolicy([
        { glob: "echo *", pipe: false, embedded: false, redirect: "append" },
      ]);
      expect(validateCommand("echo hello >> file.txt", policy).allowed).toBe(true);
    });

    it("allows both redirect types when entry has redirect: both", () => {
      const policy = buildPolicy([
        { glob: "echo *", pipe: false, embedded: false, redirect: "both" },
      ]);
      expect(validateCommand("echo hello > file.txt", policy).allowed).toBe(true);
      expect(validateCommand("echo hello >> file.txt", policy).allowed).toBe(true);
    });

    it("denies overwrite redirect when entry has redirect: none", () => {
      const policy = buildPolicy([
        { glob: "echo *", pipe: false, embedded: false, redirect: "none" },
      ]);
      const result = validateCommand("echo hello > file.txt", policy);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("redirect");
    });

    it("denies append redirect when entry has redirect: none", () => {
      const policy = buildPolicy([
        { glob: "echo *", pipe: false, embedded: false, redirect: "none" },
      ]);
      const result = validateCommand("echo hello >> file.txt", policy);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("redirect");
    });

    it("denies overwrite redirect when entry only has redirect: append", () => {
      const policy = buildPolicy([
        { glob: "echo *", pipe: false, embedded: false, redirect: "append" },
      ]);
      const result = validateCommand("echo hello > file.txt", policy);
      expect(result.allowed).toBe(false);
    });

    it("allows command without redirect even when entry has redirect: both", () => {
      const policy = buildPolicy([
        { glob: "echo *", pipe: false, embedded: false, redirect: "both" },
      ]);
      expect(validateCommand("echo hello", policy).allowed).toBe(true);
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
