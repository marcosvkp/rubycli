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

Or run from a clone of this repository:

```bash
npm install
npm run build
npm link
```

## Usage

```bash
ruby
```

starts the interactive agent. One-shot prompts:

```bash
ruby run "Analyze this project and find possible bugs"
```

## API Key

On first run you will be prompted to paste your RubyCLI API key. It is
validated against the RubyCLI API and stored locally at
`~/.rubycli/config.json` (never committed, never logged in full).

You can also provide the key via environment variable — useful for CI/CD.
An env-provided key is never persisted automatically:

```bash
export RUBYCLI_API_KEY=ruby_sk_...
```

Priority: `RUBYCLI_API_KEY` env var → local config → interactive prompt.

## Configuration

Most users need nothing beyond the API key. Advanced overrides:

```bash
ruby config --api-key <key>      # set the API key
ruby config --model <model>      # set the default model (default: ruby-auto)
ruby config --base-url <url>     # custom API endpoint
ruby model <model>               # shortcut to set the default model
```

Environment variables:

| Variable           | Purpose                              |
| ------------------ | ------------------------------------ |
| `RUBYCLI_API_KEY`  | API key (highest priority)           |
| `RUBYCLI_BASE_URL` | Override the API endpoint            |
| `RUBYCLI_MODEL`    | Override the default model           |
| `RUBYCLI_DEBUG=1`  | Debug output (endpoint, timing, usage — never the key) |

The default model is `ruby-auto` — the RubyCLI backend routes it to the best
available provider. You never need to pick a provider.

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
