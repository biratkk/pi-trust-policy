# Agents

## Code Style Rules

- **No nested functions.** All functions must be declared at module scope or as class methods. Do not define functions inside other functions. Extract them to module-level with explicit parameters instead.

## Architecture Principles

- **Composition over flat lists.** Per-tool policies are building blocks. Aggregate policies compose them via `includes`. Only aggregates appear in the TUI.

## Workflow

- **One commit per change.** Verify with `tsc --noEmit` and `vitest run` before every commit.
