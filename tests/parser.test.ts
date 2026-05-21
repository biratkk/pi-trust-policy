import { describe, it, expect } from "vitest";
import { parseCommand } from "../src/parser";
import type { CommandSegment } from "../src/types";

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
        { command: "git status", requiresPipe: false, requiresEmbedded: false },
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
});
