# Prompt-injection defenses

_Status: Implemented — provenance-tracking confirmation bump shipped in #309 (merged 2026-08-16, v0.1.4.x). Layers 1–5 previously merged with their advisories._

## Problem

OpenCLI has no structural separation between trusted instructions (the user's messages) and untrusted data (file `read` contents, `web_fetch` bodies, `grep`/`glob` matches, MCP tool results, skill bodies). All of it is concatenated into the conversation and treated by the LLM as instructions.

The only mitigation prior to this work was a soft system-prompt rule ("Never read ... credentials"). A soft rule is not a security control: content inside tool output (a hostile repo's `README.md`, a fetched web page, an MCP tool response) can issue directives the model will follow. This is the root enabler that turned the read/symlink, `web_fetch`, and `--yes` findings into remotely exploitable chains.

## Threat model

- **Hostile repository.** Victim clones a repo and runs `opencli` in it. Repo files (`README`, source comments, `.opencli/`) carry injected instructions.
- **Fetched content.** The agent (or a prompt) calls `web_fetch` on an attacker-controlled URL; the response body carries injected instructions.
- **MCP tool output.** A compromised or malicious MCP server returns tool results containing injected instructions.
- **Goal of the adversary.** Read a secret (`~/.ssh/id_rsa`, `~/.aws/credentials`, a cloud-metadata response) and exfiltrate it via `web_fetch`; run a destructive shell command; modify files outside the project; or plant persistence.

## Defense in depth

This advisory lands the prompt-level framing and documents the layered strategy. The structural layers — which actually bound the blast radius independent of the model — ship in companion advisories:

1. **Read-path restriction** (GHSA-5v6f-c99j-7m36): `read`, `grep`, `glob`, and `ls` all require confirmation for paths outside cwd or for credential basenames; `write`/`edit`/`multi_edit` use symlink-aware containment. An injected agent cannot silently read `~/.ssh/id_rsa` — and `grep` is gated the same way, because it returns matching *lines* and is therefore an equivalent exfiltration primitive.
2. **`web_fetch` host guard** (GHSA-9gqj-5w58-2j6v): SSRF/private/loopback/link-local hosts are blocked, and HTTP redirects are re-validated per hop, closing the cloud-metadata and internal-service **read** vector. This does **not** close exfiltration — see "Open problem: exfiltration" below.
3. **`--yes` deny + blocklist** (GHSA-hx58-45j4-fr7m): catastrophic commands and the user's deny list are honoured even under `--yes`.
4. **Session-log redaction** (GHSA-x245-5r32-45m5): secrets that do reach the log are masked.
5. **System-prompt framing** (this advisory, soft): tell the model tool output is data. Reinforces 1–4 but is not relied upon alone.

## What landed here

- A new `## Untrusted content` section in `DEFAULT_SYSTEM_INSTRUCTION` (`src/core/prompt.ts`) that frames tool output as data, names prompt injection, and instructs the model to surface — not obey — actions requested only by untrusted content.

> ⚠ This is prompt text. Its effectiveness is **model-dependent** and is **not** verified by the unit test, which only asserts the text is *present*. Do not mistake the passing test for evidence that the framing actually changes model behaviour. The structural layers (1–4) are what bound the blast radius; this layer is reinforcement only.

## Open problem: exfiltration — now bounded by the bump (#309)

Before the bump shipped, none of the structural layers gated "send data out": `web_fetch` to a *public* attacker-controlled host was allowed by design, and the `auto` sandbox permits outbound network. The provenance-tracking confirmation bump (below, now implemented) is the mechanism that addresses it — while the current turn has consumed untrusted content (out-of-project reads, `web_fetch`, MCP results), `web_fetch`/`bash`/`write`/`edit`/`multi_edit`/`mcp__*` are forced through the HITL gate, so a `web_fetch` following content consumption is exactly the signal that now prompts. Residual gap: the bump is turn-scoped and HITL-gated, not a hard block — a user who reflexively approves still exfiltrates; and content the model legitimately reads from *inside* the project (a hostile repo's own files, injected) arms nothing until combined with an out-of-project read or fetch. Fully closing that requires taint-tracking at the content level, which remains out of scope.

## Provenance-tracking confirmation bump (implemented in #309)

The strongest structural defense — now shipped. What landed:

- Tag each `function_result` with the *source* of the data it returned: `read` (path inside vs. outside cwd), `web_fetch` (host), `mcp__*`.
- Track a per-turn (or per-session) flag: "this turn consumed untrusted content" (any `read` outside cwd, any `web_fetch`, any MCP result).
- While that flag is set, raise `write`/`edit`/`multi_edit`/`bash` to `requiresConfirmation=true` in the executor, regardless of their own predicates. So an action that only makes sense because untrusted content asked for it always hits the HITL gate.

Implementation notes (as landed):

- `FunctionResultPart.untrusted` (`src/providers/types.ts`) tags results from `web_fetch`, `mcp__*`, and `read`/`grep` of out-of-project or credential paths (`isUntrustedSource`, `src/core/executor.ts`). Internal-only; providers never serialize it.
- The agent loop latches "consumed untrusted this turn" from tagged results and threads it into `ExecutorDeps.untrustedConsumed`; the latch resets on the next `run()` (next user message).
- `bumpRequired()` forces `web_fetch`/`bash`/`write`/`edit`/`multi_edit`/`mcp__*` through the confirmation gate while the latch is set.
- Same-batch race closed: a batch containing an out-of-project `read`/`grep` arms the bump for the whole batch before dispatch (a parallel `[read ~/.aws/credentials, web_fetch …]` cannot slip through). A turn's *first* outbound fetch stays prompt-free — the bump gates what follows consumption, not the initial request.

This shipped as its own PR (#309) with dedicated review + tests, deliberately separate from the advisory: it touches the executor and the message types. The companion layers close the destructive paths and the secret-read / private-endpoint paths; the bump constrains exfiltration to public hosts (see "Open problem" above for the residual, accepted gap).

## What is out of scope

- Fully solving prompt injection is an open research problem. The goal of this work is **bounding the blast radius** so an injected agent cannot reach secrets, private endpoints, or destructive commands without an explicit user prompt — not guaranteeing the model ignores injected text.
- Sandboxed execution (`--sandbox strict`) remains the recommendation for real isolation; the auto-sandbox network allowance is documented separately (`docs/design/a7-sandbox-loosen-auto.md`).

## References

- Advisory: GHSA-v5f9-ffp2-x7p3
- Companion structural fixes: GHSA-5v6f-c99j-7m36, GHSA-9gqj-5w58-2j6v, GHSA-hx58-45j4-fr7m, GHSA-x245-5r32-45m5
- `src/core/prompt.ts` (`DEFAULT_SYSTEM_INSTRUCTION`, `## Untrusted content`)
- `src/core/executor.ts` (future home of the confirmation bump)
