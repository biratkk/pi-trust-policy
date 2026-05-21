# Agents

## Code Style Rules

- **No nested functions.** All functions must be declared at module scope or as class methods. Do not define functions inside other functions. Extract them to module-level with explicit parameters instead.

## Architecture Principles

- **Composition over flat lists.** Per-tool policies are building blocks. Aggregate policies compose them via `includes`. Only aggregates appear in the TUI.

## Workflow

- **One commit per change.** Verify with `tsc --noEmit` and `vitest run` before every commit.
- **Every starter policy has a colocated `.test.json`.** Both per-tool (`grep/grep-read.test.json`) and aggregate (`unix-read.test.json`) policies must have test cases. The test runner at `tests/starters.test.ts` auto-discovers them.
