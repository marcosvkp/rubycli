# RubyCLI

An AI coding agent for your terminal, powered by RubyCLI Cloud. You describe
the task; the agent reads, edits, and runs code in your project until it's done.

> RubyCLI is derived from [OpenCLI](https://github.com/zjshen14/opencli) (MIT
> License) by Zhijie Shen. The upstream engine (agent loop, tools, MCP, skills,
> sessions) is reused here under the MIT license; all OpenCLI copyright notices
> are preserved.

## Install

Requires Node.js 20+.

```bash
npm install -g @rubyclii/cli
```

Or run without installing:

```bash
npx @rubyclii/cli
```

Verify the install:

```bash
ruby --version
```

## Quickstart

```bash
ruby
```

On first run you will be asked for your RubyCLI API key (get one from your
[RubyCLI Cloud dashboard](https://app.rubycli.cloud)). The key is validated
against the API and stored locally at `~/.rubycli/config.json` — never
committed, never logged in full.

Then just type what you want:

```text
> Analyze this project and find possible bugs
```

One-shot prompts (great for scripts and CI):

```bash
ruby run "Analyze this project and find possible bugs"
```

## API Key

Three ways to provide the key, in priority order:

1. **Environment variable** (best for CI/CD — never persisted automatically):

   ```bash
   export RUBYCLI_API_KEY=ruby_sk_...
   ```

2. **Local config** (saved by the first-run prompt or explicitly):

   ```bash
   ruby config --api-key <key>
   ```

3. **Interactive prompt** on first run.

Manage or rotate the key any time with `ruby config --api-key <new-key>`.

## Commands

| Command              | What it does                              |
| -------------------- | ----------------------------------------- |
| `ruby`               | Start the interactive agent (default)     |
| `ruby run "<prompt>"` | Run a single prompt and exit             |
| `ruby sessions`      | List recent sessions for the current dir  |
| `ruby config`        | View config (keys are masked)             |
| `ruby config --api-key <key>` | Save the API key               |
| `ruby config --model <model>` | Set the default model          |
| `ruby config --base-url <url>` | Custom API endpoint           |
| `ruby model [model]` | Show or set the default model             |
| `ruby mcp ...`       | Manage MCP servers (`list`, `add`, ...)   |

### In-session commands

Type `/help` inside a session for the live list.

| Slash command | What it does                                                  |
| ------------- | ------------------------------------------------------------- |
| `/init`       | Create or update the project guide (`AGENTS.md`)              |
| `/status`     | Connection, model, key source, permissions, project guide     |
| `/model`      | List API models / switch the session model                    |
| `/effort`     | Show or set reasoning effort (`low`/`medium`/`high`)          |
| `/cost`       | Token totals for this session                                 |
| `/diff`       | Uncommitted changes (`/diff full` for the patch)              |
| `/context`    | Token usage vs. context window                                |
| `/compact`    | Summarize history to free context                             |
| `/plan`       | Explore, draft a plan, approve, then execute                  |
| `/goal`       | Set a persistent goal (`/goal done`·`pause`·`resume`·`clear`) |
| `/auto`       | Keep working toward the goal without pausing                  |
| `/rewind`     | Undo the agent's file changes since the last snapshot         |
| `/undo`       | Remove the last exchange from history                         |
| `/clear`      | Clear conversation history                                    |
| `Shift+Tab`   | Cycle permission mode: normal → accept edits → plan          |

### Project guide

If your repository has an `AGENTS.md` (or `RUBYCLI.md` / `CLAUDE.md`), RubyCLI
loads it into the system prompt automatically, walking up from the current
directory. Run `/init` to generate one for an existing project.

## Configuration

Most users need nothing beyond the API key. Advanced overrides:

```bash
ruby config --api-key <key>      # set the API key
ruby config --model <model>      # set the default model (default: ruby-auto)
ruby config --base-url <url>     # custom API endpoint
ruby model <model>               # shortcut to set the default model
```

Environment variables:

| Variable           | Purpose                                              |
| ------------------ | ---------------------------------------------------- |
| `RUBYCLI_API_KEY`  | API key (highest priority, never auto-persisted)     |
| `RUBYCLI_BASE_URL` | Override the API endpoint (default: `https://app.rubycli.cloud/v1`) |
| `RUBYCLI_MODEL`    | Override the default model                           |
| `RUBYCLI_DEBUG=1`  | Debug output (endpoint, timing, usage — never the key) |

The default model is `ruby-auto` — the RubyCLI backend routes it to the best
available provider. You never need to pick a provider.

After each response the CLI prints a compact status line:

```text
ruby-auto │ 31.4k/200k │ ↑31.3k ↓1.1k │ 87 tok/s │ TTFT 420ms
```

(model │ context used/limit │ input/output tokens │ generation speed │ time to first token)

## Development

```bash
npm install            # install dependencies
npm run dev            # run the CLI from source (auto-loads .env)
npm test               # run test suite (vitest)
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run format         # prettier
npm run build          # bundle to dist/
```

## Upstream

This project is a fork of [OpenCLI](https://github.com/zjshen14/opencli)
(MIT License, Copyright (c) 2025 Zhijie Shen). See [LICENSE](LICENSE) for the
full license text, which retains the original copyright notice.

## License

MIT — see [LICENSE](LICENSE).
