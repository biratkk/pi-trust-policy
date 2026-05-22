import { describe, it, expect } from "vitest";
import { validateCommand } from "../../src/validator";
import type { ResolvedPolicy, CommandEntry } from "../../src/types";

function entry(glob: string, overrides: Partial<CommandEntry> = {}): CommandEntry {
  return {
    glob,
    pipe: true,
    embedded: true,
    redirect: "none",
    passthrough: false,
    skipFlags: [],
    skipFlagsWithArg: [],
    ...overrides,
  };
}

function xargsEntry(): CommandEntry {
  return entry("xargs {*,*/**}", {
    passthrough: true,
    skipFlags: ["-0", "-t", "-r", "--no-run-if-empty", "--null", "--verbose"],
    skipFlagsWithArg: ["-n", "-P", "-d", "--max-procs", "--max-args", "--delimiter"],
  });
}

function buildPolicy(entries: CommandEntry[]): ResolvedPolicy {
  return {
    commands: entries,
    groups: new Map([["test-group", { description: "Test", commands: entries }]]),
    warnings: [],
  };
}

describe("xargs passthrough", () => {
  const policy = buildPolicy([
    entry("grep {*,*/**}"),
    entry("cat {*,*/**}"),
    entry("head {*,*/**}"),
    entry("rm {*,*/**}", { pipe: false, embedded: false }),
    xargsEntry(),
  ]);

  describe("allowed: inner command matches policy", () => {
    it("simple xargs grep", () => {
      expect(validateCommand("xargs grep -l pattern", policy).allowed).toBe(true);
    });

    it("xargs with -0 flag", () => {
      expect(validateCommand("xargs -0 grep pattern", policy).allowed).toBe(true);
    });

    it("xargs with -n flag and argument", () => {
      expect(validateCommand("xargs -n 1 cat file.txt", policy).allowed).toBe(true);
    });

    it("xargs with multiple flags", () => {
      expect(validateCommand("xargs -0 -t -n 5 grep foo", policy).allowed).toBe(true);
    });

    it("xargs in pipeline", () => {
      const pipePolicy = buildPolicy([
        entry("find {*,*/**}"),
        entry("grep {*,*/**}"),
        xargsEntry(),
      ]);
      expect(validateCommand("find . -name '*.ts' | xargs grep pattern", pipePolicy).allowed).toBe(true);
    });

    it("xargs grep with 2>/dev/null in pipeline", () => {
      const pipePolicy = buildPolicy([
        entry("find {*,*/**}"),
        entry("grep {*,*/**}"),
        entry("head {*,*/**}"),
        xargsEntry(),
      ]);
      expect(validateCommand("find . -name '*.ts' | xargs grep -l pattern 2>/dev/null | head -20", pipePolicy).allowed).toBe(true);
    });
  });

  describe("denied: inner command not in policy", () => {
    it("xargs with untrusted inner command", () => {
      const limitedPolicy = buildPolicy([
        entry("grep {*,*/**}"),
        xargsEntry(),
      ]);
      expect(validateCommand("xargs sed 's/foo/bar/' file", limitedPolicy).allowed).toBe(false);
    });

    it("xargs rm denied when rm not in policy", () => {
      const noRmPolicy = buildPolicy([
        entry("grep {*,*/**}"),
        xargsEntry(),
      ]);
      expect(validateCommand("xargs rm -rf /tmp", noRmPolicy).allowed).toBe(false);
    });
  });

  describe("denied: unknown flags make inner command unresolvable", () => {
    it("xargs with -I flag (not in skipFlags)", () => {
      expect(validateCommand("xargs -I {} grep {} file", policy).allowed).toBe(false);
    });

    it("xargs with --replace (not in skipFlags)", () => {
      expect(validateCommand("xargs --replace grep pattern", policy).allowed).toBe(false);
    });

    it("xargs with unknown flag", () => {
      expect(validateCommand("xargs --some-unknown-flag grep pattern", policy).allowed).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("bare xargs with no inner command", () => {
      expect(validateCommand("xargs", policy).allowed).toBe(false);
    });

    it("xargs with only flags, no inner command", () => {
      expect(validateCommand("xargs -0 -t", policy).allowed).toBe(false);
    });

    it("xargs not matched without passthrough entry", () => {
      const noPassthrough = buildPolicy([entry("grep {*,*/**}")]);
      expect(validateCommand("xargs grep pattern", noPassthrough).allowed).toBe(false);
    });
  });
});
