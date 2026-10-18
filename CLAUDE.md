# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Keep in sync with `AGENTS.md`** — both files carry the same content; only the first-line header differs. Update both in the same commit whenever either changes.

## Project Overview

RubyCLI — an AI coding agent CLI powered by RubyCLI Cloud, derived from OpenCLI (MIT). It speaks any OpenAI-compatible endpoint, plus Anthropic and Gemini natively. TypeScript/Node.js (ESM, Node 20+).

## Getting Started with a Task

**New to this project?** Start here: [Task Workflow](docs/task-workflow.md) — it walks you through the typical task lifecycle, from reading the issue to committing your work. It references this document and [docs/engineering-practices.md](docs/engineering-practices.md) for the conventions you need to know.

## Commands

```bash
npm run dev               # Run interactive REPL (auto-loads .env)
npm run dev run "<prompt>"  # One-shot prompt
npm run build             # Bundle with tsup → dist/
npm run typecheck         # tsc --noEmit
npm run lint              # ESLint
npm run lint:fix          # ESLint with auto-fix
npm run format            # Prettier --write src/**/*.ts
npm run format:check      # Prettier check (no write)
npm test                  # Vitest
npm run test:single       # Vitest verbose (single run)
```

The RubyCLI key resolves from `RUBY_API_KEY` (legacy alias: `RUBYCLI_API_KEY`), then `~/.rubycli/config.json`, then the first-run prompt. Default model: `ruby-smart` — it must be an id that exists in `GET /v1/models`, because the backend does not publish a router alias. Other providers keep their own env vars (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, …); the table in `providers/registry.ts` is the source of truth.

## Source Structure

```
src/
  cli/            # Thin adapter — reads config/env, wires dependencies, runs the REPL
    index.ts        # Entry point — commander CLI (chat / run / sessions / config commands)
    repl.ts         # Interactive REPL, /slash command interception, skill loading, session logging
    renderer.ts     # MarkdownStreamRenderer (paragraph-level streaming), tool call display
    input.ts        # Raw-mode readline, /slash popup with arrow-key navigation
    confirm.ts      # HITL confirmation dialog (y/n/always); reads and writes settings
    keys.ts         # API key resolution — env var → config file lookup
    mcp-cmd.ts      # /mcp slash command handler (list, add, remove, test)
    mentions.ts     # @-mention expansion — resolves @file references before the agent sees them
    plan.ts         # /plan slash command handler — plan pass → approval → react execution
    runner.ts       # runAgentTurn() helper extracted from repl.ts
    models.ts       # GET /models client — used by /model and live context-window lookup
    context-window.ts # resolves the model context window (config → registry → API)
    project-doc.ts  # discovers AGENTS.md / RUBYCLI.md / CLAUDE.md for the system prompt
    git-info.ts     # read-only git queries (branch, diff) powering /diff and /status
    status-state.ts # session status shared by runner (metrics) and REPL (status bar, /cost)
    status-footer.ts# pinned footer via the terminal scroll region
  core/           # Pure library — no process.env reads, no CLI/state imports
    agent.ts        # Agentic loop: stream → collect function calls → execute → feed back
    executor.ts     # Parallel tool execution, skill activation dispatch, HITL confirmation gate,
                    #   provenance-tracking confirmation bump (#309): results from web_search/web_fetch/mcp__*/
                    #   out-of-project reads are tagged untrusted; while any is consumed this turn,
                    #   outbound/mutating tools (bash/write/edit/multi_edit/web_search/web_fetch/mcp__*) are forced
                    #   through the gate (same-batch reads arm it pre-dispatch)
    context.ts      # Conversation history, skill content injection, context pruning
    prompt.ts       # DEFAULT_SYSTEM_INSTRUCTION template + loadSystemInstruction() (RUBYCLI_SYSTEM_MD)
    compact.ts      # compactContext() — LLM-based context compaction for /compact command
    observability.ts # ObservabilityEvent types; token + turn metrics emitted by the agent loop
  providers/      # LLM clients — no CLI/state imports
    types.ts        # Shared types: Message, StreamEvent, ToolDefinition, ToolResult, thoughtSignature
    client.ts       # LLMClient interface — the provider plug point
    registry.ts     # PRESETS — single source of truth for provider wire format, base URL, key env
                    #   vars, context windows, capabilities. Adding a provider is a data change.
    gemini.ts       # GeminiClient implements LLMClient; Gemini-specific schema conversion internal
    anthropic.ts    # AnthropicClient implements LLMClient; translates role/tool formats internally
    openai.ts       # OpenAIClient implements LLMClient; also serves every OpenAI-compatible OSS
                    #   provider and local Ollama
    salvage.ts      # Recovers tool calls OSS models emit as text instead of structured tool_calls
    ollama-discovery.ts # Best-effort /api/tags query — local context window + tool capability
    factory.ts      # createClient(model, apiKey) — picks provider via the registry
    schema.ts       # Generic toolToDefinition() + activateSkillDefinition (plain JSONSchema, no provider deps)
    retry.ts        # withRetry() — shared exponential-backoff retry wrapper for provider streams
    errors.ts       # toFriendlyError() — normalises provider errors to human-readable messages
  tools/
    base.ts         # Tool interface + JSONSchema type
    registry.ts     # ToolRegistry: register, execute, list
    file/           # read, write, edit, multi_edit, glob, grep, ls; paths.ts (symlink-aware containment + credential-path checks)
    exec/           # bash (with requiresConfirmation for non-safe commands); sandbox/ (bwrap, sandbox-exec, passthrough)
    web/            # web_search and web_fetch tools
    task/           # todo_write and todo_read tools
    think.ts        # think tool — private scratchpad; skipped for native-thinking models
    index.ts        # createDefaultRegistry(model?, runner?) factory — omits think for native-thinking models
  skills/
    registry.ts     # Discover SKILL.md files across 4 scoped directories
    loader.ts       # Parse SKILL.md frontmatter, !{cmd} preprocessing, $ARGUMENTS substitution
    builtin/        # general workflow skills plus 28 Minecraft modding skills (see docs/skills.md)
  mcp/            # MCP integration — bridges external tool servers into ToolRegistry
    types.ts        # McpStdioServer, McpHttpServer, McpServerConfig, McpConfig, McpToolInfo
    config.ts       # loadMcpConfig(agentDir) — reads ~/.rubycli/mcp.json; expands ${VAR} refs
    client.ts       # McpClient — connects via stdio or HTTP, enforces per-server callTimeout
    adapter.ts      # mcpToolToTool() — wraps one MCP tool as a Tool (name: mcp__server__tool)
    manager.ts      # McpManager — connects all servers in parallel, registers adapters
    index.ts        # Re-exports all public types and classes
  state/
    config.ts       # ~/.rubycli/config.json load/save; exports AGENT_DIR, Config (incl. anthropicApiKey)
    session.ts      # JSONL session logs at ~/.rubycli/projects/<cwd>/; create, list, resume
    settings.ts     # .rubycli/settings.json load/save; holds project-level Permissions (HITL allow/ask/deny list)
    snapshot.ts     # SnapshotManager — git stash create/restore for per-session working-tree snapshots
```

## Architecture

**Data flow**: User input → CLI Layer → Agent Core → LLM provider (streaming) → Tool/Skill execution → feed results back → repeat until final text response.

**Agentic loop** (`src/core/agent.ts`):

1. Add user message to context
2. Stream from the active `LLMClient` with tool + `activate_skill` definitions (filtered to read-only tools in plan mode)
3. Collect text chunks (display immediately) and function calls
4. Execute all tool calls in parallel (`Promise.all`); skill activations inject content into context; write tools are blocked when `readOnly` is set (plan mode)
   - Before each execution, check `tool.requiresConfirmation(args)`; if true, invoke `confirmFn` (interactive y/n/always dialog in REPL; auto-deny in non-interactive mode unless `--yes`)
5. Append event-driven reminders to the last tool result (e.g. after `edit` → "run tests")
6. Feed results back as a user message; repeat from step 2 until no function calls
7. **Safety guards**: max-turns limit (default 50, `--max-turns` to override); stuck-loop detection aborts after 3 identical consecutive call signatures; env-error-loop detection aborts after 3 consecutive turns with the same OS-level error (EPERM, EACCES, ENOSPC, etc.)

**Plan mode** (`Agent.run(input, "plan")`): restricts tools to `read/glob/grep/think`, appends a plan-specific system prompt suffix, and sets `readOnly` on the executor so write tools are blocked at two layers. The REPL's `/plan <task>` command runs a plan pass, then shows `[@clack/prompts select]` Approve / Edit / Cancel before switching to react mode for execution.

**Provider abstraction**: `LLMClient` (in `providers/client.ts`) is the single interface the Agent Core depends on. `schema.ts` converts `Tool` objects to generic `ToolDefinition` (plain JSONSchema). Each provider client translates `ToolDefinition[]` and `Message[]` into its own wire format internally — Gemini converts types to uppercase and uses `functionCall`/`functionResponse`; Anthropic maps `role: "model"` → `"assistant"` and uses `tool_use`/`tool_result` blocks. `providers/registry.ts` holds the `PRESETS` table describing every provider (wire format, base URL, API-key env vars, model context windows, capabilities); `createClient()` and `detectProvider()` read from it, so **adding a provider means editing one table, not four call sites**. API key resolution (env vars + config file) happens in `cli/keys.ts` — the library layer never reads `process.env` or config files.

**OSS + local models (B6)**: Kimi, GLM, DeepSeek, Qwen, OpenRouter, and Ollama all reuse the OpenAI wire client. Two behaviours are specific to them and opt-in per preset: `salvage.ts` recovers tool calls that open-weight models emit as bare or fenced JSON in message content (only when a turn produced no structured calls, and only for a name that was actually offered), and `ollama-discovery.ts` queries `/api/tags` for a local model's true context window, which is routinely _smaller_ than the static default. See [`docs/design/b6-oss-models.md`](docs/design/b6-oss-models.md).

**Thinking models + `thoughtSignature`**: Gemini thinking models (e.g. `gemini-3.1-*`) require `thoughtSignature` to be captured from each `functionCall` part and echoed back in the corresponding `functionResponse`. This is threaded through `FunctionCallPart` → `FunctionResultPart` → the API request in `gemini.ts`. The Anthropic client ignores this field.

**Skill system**: Skills are `SKILL.md` files (YAML frontmatter + Markdown instructions) injected into the agent context on activation. They follow the [Agent Skills open standard](https://agentskills.io). Discovery priority: project `.rubycli/skills/` → project `.agents/skills/` → user `~/.rubycli/skills/` → bundled built-ins. Invoke with `/skill-name [args]` or the model calls `activate_skill`. See [`docs/skills.md`](docs/skills.md) for the full authoring guide.

**When adding, removing, or renaming a built-in skill**, update all four places: `docs/skills.md` (built-in table), `docs/architecture.md` (skill list + file tree), and the `builtin/` comment in both `CLAUDE.md` and `AGENTS.md`.

## Key Conventions

- All tools return `{ success: boolean; output: string; error?: string }`
- Tools declare `requiresConfirmation?(args) => boolean` on their interface; the executor calls `confirmFn` when it returns true. Bash requires confirmation for any command not in its `SAFE_COMMANDS` allowlist; `write`/`edit`/`multi_edit` require it for paths that (symlink-resolved) escape `process.cwd()`; `read`/`grep` require it for out-of-cwd or credential-basename paths; `glob`/`ls` for out-of-cwd paths (see `src/tools/file/paths.ts`). Under `--yes`, the user's deny rules plus a built-in catastrophic blocklist are still enforced (`createAutoApproveConfirmFn`). Grants (`permissions.allow`) are honoured only from the global user config — project-scoped `.rubycli/settings.json` allow entries are ignored as untrusted.
- `edit` tool requires `old_string` to appear exactly once — fails with a clear error if ambiguous
- Prettier `printWidth: 100`, double quotes, trailing commas — run `npm run format` before committing
- ESLint: `@typescript-eslint/recommended` + no unused vars (underscore prefix to suppress)

**Before submitting any change**, run:

```bash
npm run typecheck && npm run lint && npm run format:check && npm test
```

**Full engineering practices are in [`docs/engineering-practices.md`](docs/engineering-practices.md).** Check it before writing code. Key rules:

- Colocate tests next to source (`context.ts` → `context.test.ts`)
- Each layer owns its concern — `providers/` never touches filesystem, `tools/` never imports provider SDKs
- No circular imports: `cli → core/providers/tools/skills/state`
- `core/` and `providers/` must never import from `cli/` or `state/` — API keys and config are resolved by the CLI layer and passed as constructor arguments
- Mock at system boundaries only; use real filesystem for file tool tests
- Document non-obvious decisions in `docs/`

## Issue Management & Branching

- **Always check for a related GitHub issue.** If your work addresses an issue, format your commit message to include `Closes #<issue_number>` (if fully resolved) or `Part of #<issue_number>` (if partial).
- **If you forget to link an issue in the commit message**, use the GitHub CLI to comment on the issue with the commit hash.
- **After completing each phase of a multi-phase issue**, post a comment on the GitHub issue summarising what landed (commit hash, what changed, what remains open). Don't wait until the issue is fully closed — intermediate updates keep the issue as the canonical record of progress.
- **Before starting a complex or risky task**, explicitly ask the user if they would prefer you to create a feature branch (`git checkout -b feature/issue-123`) instead of committing directly to `main`. Small, well-scoped fixes should be committed directly to `main`.
- **After merging a milestone covered by a design doc** (`docs/design/<milestone>.md`), update its `_Status:` line from `"Ready for implementation"` to `"Implemented — merged in <short-sha> (<date>)"`. Do this in the same PR that ships the feature, or immediately after merge as a follow-up commit. The status line must never read "Ready for implementation" for code that is already on `main`.

## Configuration

- `.env` — third-party provider keys (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, …). RubyCLI Cloud needs no `.env` entry.
- `RUBY_API_KEY` — RubyCLI API key (highest priority, never auto-persisted). Legacy alias `RUBYCLI_API_KEY` is also honoured.
- `RUBYCLI_BASE_URL` / `RUBYCLI_MODEL` / `RUBYCLI_DEBUG=1` — endpoint, model and debug overrides
- `RUBYCLI_SYSTEM_MD` — path to a Markdown file that overrides the default system instruction (for prompt hill-climbing)
- `RUBYCLI_MAX_TOOL_OUTPUT` — max chars before bash/grep/glob output is middle-truncated (default: 20 000)
- `RUBYCLI_SANDBOX`, `RUBYCLI_SNAPSHOT`, `RUBYCLI_WEB_FETCH_ALLOW_PRIVATE` — behaviour toggles
- `~/.rubycli/config.json` — persisted user config (model, temperature, historySize, etc.)
- `~/.rubycli/projects/<encoded-cwd>/<session-id>.jsonl` — session conversation logs
- `~/.rubycli/mcp.json` — MCP server definitions

Every `RUBYCLI_*` variable also accepts its legacy `OPENCLI_*` name, so pre-rename setups keep working.

- `.gitignore` excludes `.env` and `dist/`

## Session Management

Sessions are JSONL logs stored globally (not in the project directory):

```bash
ruby sessions                 # list sessions for current directory
ruby --resume                 # resume the most recent session
ruby --session <id>           # resume a specific session by ID
```

Session ID format: `YYYY-MM-DDTHH-mm-ss` (human-readable, lexicographically sortable).
