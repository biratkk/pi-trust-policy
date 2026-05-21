---
name: create-trust-policy
description: Create a new trust policy YAML file. Use when the user wants to add, define, or write a trust policy for specific commands.
---

# Create Trust Policy

Create a policy YAML file based on what the user wants to allow.

## Steps

1. Ask: scope (global `~/.pi/agent/trust-policy/` or local `.pi/trust-policy/`)?
2. Ask: what commands should be trusted?
3. For each command, determine:
   - `glob` — use `{*,*/**}` for commands that take file paths
   - `pipe` — can it appear in `|` pipelines?
   - `embedded` — can it appear inside `$()`?
   - `redirect` — `none`, `append`, `overwrite`, or `both`
4. If multiple related commands, group them. If composing existing policies, use `includes`.
5. Write the YAML file. Add the group name to `policy.json` if the user wants it active.

## Format

```yaml
name: my-policy
description: Short description

includes:        # optional
  - unix-read

commands:
  - glob: "kubectl get {*,*/**}"
    description: "List Kubernetes resources"
    pipe: true
    embedded: true
    redirect: none
```

## Rules

- `*` does not match `/` in paths. Use `{*,*/**}` for commands that take file paths.
- Defaults: `pipe: false`, `embedded: false`, `redirect: none`. Only specify when `true`/non-default.
- Aggregate policies (with `includes`, empty `commands`) appear in the TUI. Per-tool policies don't.
- Classify by risk: read (stdout only), write (creates/modifies files), destructive (irrecoverable data loss).
