# Trust Policy System — Requirements

## Overview

A permission system for pi that groups bash command allowlists into trust policies. Policies are eagerly loaded at session start and govern which bash commands the agent can execute without user confirmation. Commands not covered by any active policy trigger a confirmation prompt with options to allow once, deny, or persist the decision into a group.

This system applies **only to bash commands** — not MCP tools, skills, or other pi features.

---

## Core Concepts

### Trust Policy Group

A named set of allowed command patterns (pure allowlist). Each group defines what's permitted; anything not covered requires confirmation. There are no denylists.

### Command Pattern Matching

Commands are matched using **glob patterns**. Prefix matching is a subset of glob (e.g., `git log *` matches any `git log` invocation).

### Scope

- **Global:** `~/.pi/agent/trust-policy/` — applies in any working directory.
- **Local:** `.pi/trust-policy/` in the project root — applies only when the agent's working directory is within that project tree.

---

## File Structure

### Directory Layout

```
~/.pi/agent/trust-policy/
├── policy.json              # manifest: which groups are active globally
├── git-readonly.yaml        # group definition
├── unix-utilities.yaml      # group definition
└── node-dev.yaml            # group definition

<project>/.pi/trust-policy/
├── policy.json              # manifest: which groups are active locally
├── project-scripts.yaml     # group definition
└── docker-dev.yaml          # group definition
```

### policy.json

Simple array of active group names. No metadata.

```json
{
  "active": ["git-readonly", "unix-utilities"]
}
```

### Group File (.yaml)

```yaml
name: git-readonly
description: Read-only git commands for inspecting repo history and status

includes:
  - unix-utilities

commands:
  - glob: "git log *"
    description: "View commit history"
    pipe: true
    embedded: true
  - glob: "git diff *"
    description: "Compare changes between commits, staging, and working tree"
    pipe: true
    embedded: false
  - glob: "git status"
    pipe: false
    embedded: false
```

#### Top-level Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier for the group |
| `description` | Yes | What this group covers and when it applies |
| `includes` | No | List of other group names to inherit commands from |
| `commands` | Yes | List of command entries |

#### Command Entry Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `glob` | Yes | — | Glob pattern to match against commands |
| `description` | No | — | Why this command belongs to this group |
| `pipe` | No | `false` | Whether this command can appear in a pipeline (`\|`) |
| `embedded` | No | `false` | Whether this command can appear inside `$()`, backticks, or `bash -c` |

---

## Loading Behaviour

### Eager Loading

All groups listed in `policy.json` (both global and local) are parsed and their globs are available immediately at session start. There is no lazy/on-demand loading — trust policies are security-critical.

### Merging

Global and local active groups are merged (union). A command passes if it matches **any** active group from either scope. Allowlists are purely additive.

### Session Lifetime

The active set is fixed for the entire session. No mid-session toggling. Users edit `policy.json` and start a new session to change the active set.

### Missing Includes

If a group referenced in `includes` or `policy.json` cannot be found (in local scope first, then global), the system:
- Fails silently (does not crash)
- Shows a warning at session start: "Trust policy group 'X' not found"

---

## Command Validation

### Compound Command Parsing

The parser decomposes compound commands recursively:

1. **Chaining:** Commands separated by `&&`, `||`, `;` are each validated independently.
2. **Pipelines:** Each segment separated by `|` is validated independently. Every segment must match a trusted glob with `pipe: true`.
3. **Command substitution:** Commands inside `$()` or backticks are extracted and validated. The inner command must match a trusted glob with `embedded: true`.
4. **`bash -c` wrappers:** The inner string is extracted and recursively parsed with the same rules.
5. **Nesting:** Parsing is fully recursive with no depth limit. A `bash -c` inner string can contain pipelines, chaining, and further substitutions, all validated recursively.

### Environment Variables

Any command that **sets or exports** environment variables is automatically untrusted and always prompts for confirmation, regardless of policies.

Examples that always prompt:
- `AWS_PROFILE=prod aws s3 ls`
- `export PATH=/something:$PATH`
- `NODE_ENV=production npm start`

### Unparseable Commands

If the parser cannot statically determine what command will execute, it always prompts:

- `eval` statements (e.g., `eval "$SOME_COMMAND"`)
- Variables in **command position** (e.g., `$CMD arg1 arg2`)
- Heredocs piped to interpreters (e.g., `cat <<EOF | bash`)

### Variables in Argument Position

Variables in argument position are allowed. The glob `*` covers them:
- `git push origin $BRANCH_NAME` matches `git push *` ✓
- `docker run $IMAGE_NAME` matches `docker run *` ✓

The user opted into "any value here" when they wrote the glob with `*`.

---

## Untrusted Command Flow

When the agent attempts a command that doesn't match any active trust policy:

### Step 1: Confirmation Prompt

The agent calls `ask_user_question` with options:
- **"Yes"** — allow this one command, this one time (ephemeral)
- **"No"** — deny the command
- **"Yes + add to group: \<Group Name\>"** — allow and persist to an existing group (one option per relevant active group)

### Step 2: Glob Selection (if adding to group)

The agent proposes 2-3 glob options ranging from exact to general:
- Exact: `git push origin main`
- Moderate: `git push origin *`
- Broad: `git push *`

The user can also type a custom glob.

### Step 3: Post-Submit Validation

If the user types a custom glob:
1. Validate the glob syntax
2. If invalid, re-ask with a clear error message explaining what's wrong
3. If valid, show example matches and non-matches (3-4 each)
4. Ask for final confirmation before persisting

### Step 4: Persist

Write the new command entry to the group's `.yaml` file.

---

## Recursive Includes

### Declaration

Includes are declared in the YAML file itself:

```yaml
name: git-full
description: All git operations
includes:
  - git-readonly
  - git-write

commands:
  - glob: "git stash *"
    description: "Stash operations"
```

### Resolution

- Includes resolve by name: local scope first, then global scope.
- Cross-scope includes are allowed (a local group can include a global group).
- Resolution is fully recursive with no depth limit.
- Circular references are detected at parse time and rejected with an error.

### Flattening

At session start, all includes are resolved recursively and flattened into a single set of globs per active group. The runtime operates on the flat set.

---

## `/trust-policy:create` Command

### Entry Point

Explicit slash command invocation only: `/trust-policy:create`

### Grill Session Flow

1. **Scope:** "Should this be global or local to this project?"
2. **Category:** "What kind of work does this policy cover?" (free text)
3. **Template:** "Would you like to start from a template?" (offer starters if relevant)
4. **Commands:** "What commands do you typically run for this?" (iterative, keep asking until done)
5. **Properties:** For each command — "Should this be allowed in pipelines?" / "Should this be allowed in command substitutions?"
6. **Adversarial review:** (see below)
7. **Descriptions:** "Would you like to add descriptions to any of these commands?"
8. **Output:** Show final YAML for review
9. **Iteration:** User can comment, request changes, edit — agent iterates until approved
10. **Write:** Only write to disk after explicit user approval (never too eager)
11. **Activate:** "Would you like to activate this policy now?" — update `policy.json` only if confirmed

### Adversarial Review

The agent is adversarial toward the commands being added. For each glob:

1. **Ask the user** whether they want **computed guidance** (default) or **agent-generated guidance**
2. **Computed guidance:** Run `--help`, `man`, completion commands to enumerate real subcommands/flags that match the glob, then highlight destructive ones
3. **Agent-generated guidance:** Use LLM knowledge to surface dangerous matches
4. **Fallback:** If computed guidance fails (binary doesn't support `--help`), fall back to agent-generated

The agent presents:
- A small portion of **positive examples** (commands this glob correctly allows)
- A larger portion of **negative examples** (dangerous commands this glob would also allow)

The agent asks: "Have you thought about this example? Are you comfortable with this being allowed?"

### User Autonomy

The agent always defers to the user after clearly warning them. No hard blocks. It's the user's machine — if they insist after being warned, the agent complies. The agent's job is to surface risks, not to gatekeep.

---

## Starter Policies

Three built-in starter groups ship with pi:

### git-readonly
- `git log *`
- `git diff *`
- `git status`
- `git show *`
- `git branch --list*`

### unix-utilities
- `grep *`
- `wc *`
- `head *`
- `tail *`
- `sort *`
- `cat *`
- `less *`
- `find *`

### node-dev
- `npm run *`
- `npm test *`
- `npm install *`
- `npx *`

### Activation Flow

Starters are bundled in pi's install directory as read-only templates. When a user activates a starter:
1. The group file is **copied** into the user's trust-policy directory (`~/.pi/agent/trust-policy/`)
2. The user now owns the copy and can freely modify it
3. Updates to pi do not overwrite user's copies

The `create_trust_policy` flow offers "Start from a template?" to reference these starters.

---

## Design Principles

1. **Pure allowlist:** No denylists anywhere. Users declare what's permitted, never what's denied.
2. **Fail-safe defaults:** `pipe: false`, `embedded: false`, env vars always prompt, unparseable commands always prompt.
3. **User autonomy:** The system warns but never hard-blocks. Informed users are trusted.
4. **Eager loading:** Security-critical decisions are resolved at startup, not lazily.
5. **Additive merging:** Multiple scopes can only grant more permission, never restrict.
6. **Never too eager to write:** Always show output and get explicit approval before writing files.
7. **Adversarial by default:** The creation flow actively challenges the user's choices with computed negative examples.
