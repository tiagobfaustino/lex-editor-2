---
name: playwright
description: Use when the task requires automating a real browser from the terminal (navigation, form filling, snapshots, screenshots, data extraction, UI-flow debugging) via `playwright-cli` or the bundled wrapper script.
---

# Playwright CLI Skill

Drive a real browser from the terminal using `playwright-cli`. Prefer the bundled wrapper script so the CLI works even when it is not globally installed.
Treat this skill as CLI-first automation. Do not pivot to `@playwright/test` unless the user explicitly asks for test files.

## Choose the right tool first

- If `mcp__playwright__*` tools are available in the session, prefer them: they
  return structured snapshots and need no shell or `npx` bootstrap. Use this
  skill's CLI when the MCP server is absent, when the user asks for shell
  commands, or when you need artifacts on disk (traces, PDFs).
- This repository already owns an end-to-end suite (`@playwright/test`,
  `npm run test:e2e`, `npm run test:e2e:only`). For regression coverage that
  should persist, extend that suite instead of the CLI. Use the CLI for
  exploratory driving and one-off debugging.

## Prerequisite check (required)

Before proposing commands, check whether `npx` is available (the wrapper depends on it):

```bash
command -v npx >/dev/null 2>&1
```

If it is not available, pause and ask the user to install Node.js/npm (which provides `npx`). Provide these steps verbatim:

```bash
# Verify Node/npm are installed
node --version
npm --version

# If missing, install Node.js/npm, then:
npm install -g @playwright/cli@latest
playwright-cli --help
```

Once `npx` is present, proceed with the wrapper script. A global install of `playwright-cli` is optional.

## Skill path (set once)

```bash
export PWCLI="$(ls -1 \
  "${CLAUDE_PROJECT_DIR:-$PWD}/.claude/skills/playwright/scripts/playwright_cli.sh" \
  "$HOME/.claude/skills/playwright/scripts/playwright_cli.sh" 2>/dev/null | head -n1)"
chmod +x "$PWCLI"
```

Project-scoped skills live in `<repo>/.claude/skills`; user-scoped skills live
in `~/.claude/skills`. The lookup above takes whichever exists, project first.

## Quick start

Use the wrapper script:

```bash
"$PWCLI" open https://playwright.dev --headed
"$PWCLI" snapshot
"$PWCLI" click e15
"$PWCLI" type "Playwright"
"$PWCLI" press Enter
"$PWCLI" screenshot
```

If the user prefers a global install, this is also valid:

```bash
npm install -g @playwright/cli@latest
playwright-cli --help
```

## Core workflow

1. Open the page.
2. Snapshot to get stable element refs.
3. Interact using refs from the latest snapshot.
4. Re-snapshot after navigation or significant DOM changes.
5. Capture artifacts (screenshot, pdf, traces) when useful.

Minimal loop:

```bash
"$PWCLI" open https://example.com
"$PWCLI" snapshot
"$PWCLI" click e3
"$PWCLI" snapshot
```

## When to snapshot again

Snapshot again after:

- navigation
- clicking elements that change the UI substantially
- opening/closing modals or menus
- tab switches

Refs can go stale. When a command fails due to a missing ref, snapshot again.

## Recommended patterns

### Form fill and submit

```bash
"$PWCLI" open https://example.com/form
"$PWCLI" snapshot
"$PWCLI" fill e1 "user@example.com"
"$PWCLI" fill e2 "password123"
"$PWCLI" click e3
"$PWCLI" snapshot
```

### Debug a UI flow with traces

```bash
"$PWCLI" open https://example.com --headed
"$PWCLI" tracing-start
# ...interactions...
"$PWCLI" tracing-stop
```

### Multi-tab work

```bash
"$PWCLI" tab-new https://example.com
"$PWCLI" tab-list
"$PWCLI" tab-select 0
"$PWCLI" snapshot
```

## Wrapper script

The wrapper script uses `npx --package @playwright/cli playwright-cli` so the CLI can run without a global install:

```bash
"$PWCLI" --help
```

Prefer the wrapper unless the repository already standardizes on a global install.

## References

Open only what you need:

- CLI command reference: `references/cli.md`
- Practical workflows and troubleshooting: `references/workflows.md`

## Guardrails

- Always snapshot before referencing element ids like `e12`.
- Re-snapshot when refs seem stale.
- Prefer explicit commands over `eval` and `run-code` unless needed.
- When you do not have a fresh snapshot, use placeholder refs like `eX` and say why; do not bypass refs with `run-code`.
- Use `--headed` when a visual check will help.
- When capturing artifacts in this repo, use `output/playwright/` and avoid introducing new top-level artifact folders.
- Default to CLI commands and workflows, not Playwright test specs.
