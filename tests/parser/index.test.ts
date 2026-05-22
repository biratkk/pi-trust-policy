import { describe, it, expect } from "vitest";
import { parseCommand } from "../../src/parser";
import type { CommandSegment } from "../../src/types";

function segments(command: string): CommandSegment[] {
  const result = parseCommand(command);
  expect(result.unparseable).toBe(false);
  return result.segments;
}

function expectUnparseable(command: string): void {
  expect(parseCommand(command).unparseable).toBe(true);
}

describe("parseCommand", () => {
  describe("simple commands", () => {
    it("parses a single command", () => {
      expect(segments("git status")).toEqual([
        { command: "git status", requiresPipe: false, requiresEmbedded: false, redirect: "none" },
      ]);
    });

    it("returns empty for blank input", () => {
      expect(parseCommand("").segments).toEqual([]);
      expect(parseCommand("  ").segments).toEqual([]);
    });
  });

  describe("chained commands (&&, ||, ;)", () => {
    it("splits on &&", () => {
      const segs = segments("git status && npm test");
      expect(segs).toHaveLength(2);
      expect(segs[0].command).toBe("git status");
      expect(segs[1].command).toBe("npm test");
      expect(segs.every((s) => !s.requiresPipe)).toBe(true);
    });

    it("splits on ;", () => {
      const segs = segments("cd /tmp; ls");
      expect(segs).toHaveLength(2);
    });
  });

  describe("pipelines", () => {
    it("marks all segments with requiresPipe", () => {
      const segs = segments("git log --oneline | grep feature | wc -l");
      expect(segs).toHaveLength(3);
      expect(segs.every((s) => s.requiresPipe)).toBe(true);
      expect(segs[0].command).toBe("git log --oneline");
      expect(segs[1].command).toBe("grep feature");
      expect(segs[2].command).toBe("wc -l");
    });

    it("does not mark single command as pipe", () => {
      const segs = segments("git log");
      expect(segs[0].requiresPipe).toBe(false);
    });
  });

  describe("command substitutions", () => {
    it("extracts $() as embedded segments", () => {
      const segs = segments("echo $(git rev-parse HEAD)");
      const embedded = segs.filter((s) => s.requiresEmbedded);
      expect(embedded).toHaveLength(1);
      expect(embedded[0].command).toBe("git rev-parse HEAD");
    });
  });

  describe("bash -c wrappers", () => {
    it("parses inner command as embedded", () => {
      const segs = segments('bash -c "git log --oneline"');
      expect(segs).toHaveLength(1);
      expect(segs[0].command).toBe("git log --oneline");
      expect(segs[0].requiresEmbedded).toBe(true);
    });
  });

  describe("unparseable commands", () => {
    it("rejects env var assignments", () => {
      expectUnparseable("NODE_ENV=prod npm start");
    });

    it("rejects export", () => {
      expectUnparseable("export PATH=/foo");
    });

    it("rejects variables in command position", () => {
      expectUnparseable("$CMD arg1");
    });

    it("rejects eval", () => {
      expectUnparseable('eval "rm -rf /"');
    });
  });

  describe("redirects", () => {
    it("detects overwrite redirect >", () => {
      const segs = segments("echo hello > file.txt");
      expect(segs).toHaveLength(1);
      expect(segs[0].command).toBe("echo hello");
      expect(segs[0].redirect).toBe("overwrite");
    });

    it("detects append redirect >>", () => {
      const segs = segments("echo hello >> file.txt");
      expect(segs).toHaveLength(1);
      expect(segs[0].command).toBe("echo hello");
      expect(segs[0].redirect).toBe("append");
    });

    it("marks no redirect for plain commands", () => {
      const segs = segments("cat file.txt");
      expect(segs[0].redirect).toBe("none");
    });

    it("overwrite takes precedence over append", () => {
      const segs = segments("echo hello >> log.txt > out.txt");
      expect(segs[0].redirect).toBe("overwrite");
    });

    it("ignores redirect to /dev/null", () => {
      const segs = segments("grep pattern file 2>/dev/null");
      expect(segs[0].redirect).toBe("none");
    });

    it("ignores stdout redirect to /dev/null", () => {
      const segs = segments("grep pattern file >/dev/null");
      expect(segs[0].redirect).toBe("none");
    });

    it("still detects redirect when mixed with /dev/null", () => {
      const segs = segments("echo hello 2>/dev/null > file.txt");
      expect(segs[0].redirect).toBe("overwrite");
    });
  });
});
