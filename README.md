# pi-trust-policy

A pi extension that implements bash command allowlists via trust policy groups. Commands not covered by active policies trigger a user confirmation prompt.

## Installation

Place this directory in `~/.pi/agent/extensions/trust-policy/` or add to your project at `.pi/extensions/trust-policy/`.

```bash
# Global install
cp -r . ~/.pi/agent/extensions/trust-policy/
cd ~/.pi/agent/extensions/trust-policy && npm install

# Or test with
pi -e ./src/index.ts
```

## Quick Start

```bash
# Activate a starter policy
# (via the /trust-policy:activate command in pi)

# Or manually:
mkdir -p ~/.pi/agent/trust-policy
cp starters/git-readonly.yaml ~/.pi/agent/trust-policy/
echo '{ "active": ["git-readonly"] }' > ~/.pi/agent/trust-policy/policy.json
```

## Commands

| Command | Description |
|---------|-------------|
| `/trust-policy:create` | Interactive wizard to create a new trust policy |
| `/trust-policy:list` | List active and available policies |
| `/trust-policy:activate` | Activate a policy group |

## How It Works

1. At session start, loads `policy.json` from global (`~/.pi/agent/trust-policy/`) and local (`.pi/trust-policy/`) directories
2. Resolves all active groups and their `includes` recursively
3. Intercepts every `bash` tool call and validates against the merged allowlist
4. If a command isn't covered, prompts the user with options to allow once, deny, or persist to a group

## File Structure

```
~/.pi/agent/trust-policy/
├── policy.json              # {"active": ["git-readonly", "unix-utilities"]}
├── git-readonly.yaml        # Group definition
└── unix-utilities.yaml      # Group definition
```

## Group Format

```yaml
name: git-readonly
description: Read-only git commands

includes:
  - unix-utilities  # optional: inherit from other groups

commands:
  - glob: "git log *"
    description: "View commit history"
    pipe: true       # allowed in pipelines (default: false)
    embedded: true   # allowed in $() substitutions (default: false)
```

## Security Model

- **Pure allowlist** — only explicitly permitted commands run without confirmation
- **Env vars always prompt** — any `VAR=val cmd` or `export` triggers confirmation
- **Unparseable commands prompt** — `eval`, `$CMD`, heredocs-to-interpreters
- **Recursive validation** — pipelines, `&&`/`||`/`;`, `$()`, `bash -c` all decomposed and checked
- **Fail-safe defaults** — `pipe: false`, `embedded: false`

See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for the full specification.
