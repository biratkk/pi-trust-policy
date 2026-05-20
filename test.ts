import { parseCommand } from "./src/parser.js";
import { validateCommand, isValidGlob, generateGlobExamples } from "./src/validator.js";
import type { ResolvedPolicy } from "./src/types.js";

// --- Parser tests ---
console.log("=== Parser Tests ===\n");

console.log("Simple command:");
console.log("  'git status' →", JSON.stringify(parseCommand("git status")));

console.log("\nChained commands:");
console.log("  'git status && npm test' →", JSON.stringify(parseCommand("git status && npm test")));

console.log("\nPipeline:");
const pipeline = parseCommand("git log --oneline | grep feature | wc -l");
console.log("  'git log --oneline | grep feature | wc -l' →");
for (const seg of pipeline.segments) {
  console.log(`    ${seg.command} (pipe=${seg.requiresPipe}, embedded=${seg.requiresEmbedded})`);
}

console.log("\nCommand substitution:");
const sub = parseCommand("echo $(git rev-parse HEAD)");
console.log("  'echo $(git rev-parse HEAD)' →");
for (const seg of sub.segments) {
  console.log(`    ${seg.command} (pipe=${seg.requiresPipe}, embedded=${seg.requiresEmbedded})`);
}

console.log("\nBash -c:");
const bashC = parseCommand('bash -c "git log --oneline"');
console.log('  \'bash -c "git log --oneline"\' →');
for (const seg of bashC.segments) {
  console.log(`    ${seg.command} (pipe=${seg.requiresPipe}, embedded=${seg.requiresEmbedded})`);
}

console.log("\nEnv vars (unparseable):");
console.log("  'NODE_ENV=prod npm start' →", parseCommand("NODE_ENV=prod npm start"));
console.log("  'export PATH=/foo' →", parseCommand("export PATH=/foo"));

console.log("\nVariable in command position (unparseable):");
console.log("  '$CMD arg1' →", parseCommand("$CMD arg1"));

console.log("\nEval (unparseable):");
console.log("  'eval \"rm -rf /\"' →", parseCommand('eval "rm -rf /"'));

// --- Validator tests ---
console.log("\n=== Validator Tests ===\n");

const policy: ResolvedPolicy = {
  commands: [
    { glob: "git log *", pipe: true, embedded: true },
    { glob: "git log", pipe: true, embedded: true },
    { glob: "git status", pipe: true, embedded: false },
    { glob: "grep *", pipe: true, embedded: true },
    { glob: "wc *", pipe: true, embedded: true },
    { glob: "echo *", pipe: false, embedded: false },
  ],
  groups: new Map([
    ["git-readonly", { description: "Git readonly", commands: [
      { glob: "git log *", pipe: true, embedded: true },
      { glob: "git log", pipe: true, embedded: true },
      { glob: "git status", pipe: true, embedded: false },
    ]}],
    ["unix-utilities", { description: "Unix utils", commands: [
      { glob: "grep *", pipe: true, embedded: true },
      { glob: "wc *", pipe: true, embedded: true },
      { glob: "echo *", pipe: false, embedded: false },
    ]}],
  ]),
  warnings: [],
};

const tests = [
  { cmd: "git log --oneline", expect: true },
  { cmd: "git status", expect: true },
  { cmd: "git push origin main", expect: false },
  { cmd: "git log --oneline | grep feat", expect: true },
  { cmd: "NODE_ENV=prod npm start", expect: false },
  { cmd: "rm -rf /", expect: false },
  { cmd: "echo $(git log --oneline)", expect: true },
  { cmd: "$CMD arg1", expect: false },
  { cmd: 'eval "dangerous"', expect: false },
];

for (const t of tests) {
  const result = validateCommand(t.cmd, policy);
  const pass = result.allowed === t.expect;
  console.log(`  ${pass ? "✓" : "✗"} '${t.cmd}' → allowed=${result.allowed} (expected ${t.expect})${result.reason ? ` [${result.reason}]` : ""}`);
}

// --- Glob validation ---
console.log("\n=== Glob Validation ===\n");
console.log("  'git push *' →", isValidGlob("git push *"));
console.log("  '' →", isValidGlob(""));
console.log("  'git [branch' →", isValidGlob("git [branch"));

console.log("\n=== All tests complete ===");
