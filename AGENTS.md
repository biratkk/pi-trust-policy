# Agents

## Code Style Rules

- **No nested functions.** All functions must be declared at module scope or as class methods. Do not define functions inside other functions. Extract them to module-level with explicit parameters instead.

## Architecture Principles

- **Composition over flat lists.** Policies are organized as layered taxonomies (read → write → destructive). Per-tool policies are atomic building blocks; aggregate policies compose them via `includes`. Only aggregates are surfaced in the TUI — internals stay internal.

## Workflow

- **Commit incrementally.** Each commit is one self-contained change (feature, fix, or refactor). Verify with `tsc --noEmit` and `vitest run` before every commit. Never batch unrelated changes into a single commit.
