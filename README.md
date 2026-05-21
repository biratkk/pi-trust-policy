# pi-trust-policy

Bash command allowlist system for [pi](https://github.com/earendil-works/pi). Group trusted commands into policies, toggle them on/off, and get prompted for anything not covered.

## Install

```bash
pi install git:github.com/biratkk/pi-trust-policy
```

Or for a quick test:

```bash
pi -e git:github.com/biratkk/pi-trust-policy
```

## Usage

### 1. Write a policy YAML file

Create `~/.pi/agent/trust-policy/git-readonly.yaml`:

```yaml
name: git-readonly
description: Read-only git commands for inspecting repo history and status

commands:
  - glob: "git log *"
    description: "View commit history"
    pipe: true
    embedded: true
  - glob: "git status"
    pipe: true
  - glob: "git diff *"
    pipe: true
    embedded: true
```

### 2. Activate it

Run `/trust-policy` in pi to open the TUI manager and toggle policies on/off.

Or manually create `~/.pi/agent/trust-policy/policy.json`:

```json
{
  "active": ["git-readonly"]
}
```

### 3. Work normally

Trusted commands run without interruption. Untrusted commands prompt you with options to allow once, deny, or persist to a group.

## Commands

| Command | Description |
|---------|-------------|
| `/trust-policy` | Open TUI manager — toggle policies active/inactive |

## Policy Format

```yaml
name: my-policy
description: What this policy covers

includes:                    # optional: inherit from other groups
  - unix-utilities

commands:
  - glob: "docker build *"
    description: "Build images"  # optional
    pipe: false                  # allow in pipelines (default: false)
    embedded: false              # allow in $() substitutions (default: false)
```

## Starters

Three built-in starter policies are included and can be activated from the TUI:

- **git-readonly** — log, diff, status, show, branch
- **unix-utilities** — grep, wc, head, tail, sort, cat, find, ls, awk, sed
- **node-dev** — npm run/test/install, npx, node

## How It Works

1. At session start, loads `policy.json` from global (`~/.pi/agent/trust-policy/`) and local (`.pi/trust-policy/`) directories
2. Resolves all active groups and their `includes` recursively (with cycle detection)
3. Intercepts every `bash` tool call and validates against the merged allowlist
4. Recursively parses compound commands (pipelines, `&&`/`||`/`;`, `$()`, `bash -c`) using [unbash](https://github.com/webpro-nl/unbash)
5. Commands with env vars, `eval`, or unparseable elements always prompt

## Security Model

- **Pure allowlist** — only explicitly permitted commands run without confirmation
- **Fail-safe defaults** — `pipe: false`, `embedded: false`
- **Env vars always prompt** — `VAR=val cmd` and `export` trigger confirmation
- **Recursive validation** — every segment of a compound command is checked independently

## File Structure

```
~/.pi/agent/trust-policy/        # global
├── policy.json                  # {"active": ["git-readonly", "unix-utilities"]}
├── git-readonly.yaml
└── unix-utilities.yaml

<project>/.pi/trust-policy/      # local (project-scoped)
├── policy.json
└── project-scripts.yaml
```

Both scopes merge additively. Local policies apply only within that project tree.

## License

MIT
