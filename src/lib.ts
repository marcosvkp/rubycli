/**
 * Public library surface for embedding the RubyCLI agent engine.
 *
 * The CLI (`src/cli/`) is a thin host on top of these modules: it resolves the
 * API key, wires the pieces together and renders to a terminal. A different host
 * — the Ruby Desktop Electron app, for instance — imports this entry point and
 * supplies its own rendering, its own `ConfirmFn`, and its own tool registry
 * additions.
 *
 * Two rules keep that possible, and both are enforced by the layer conventions in
 * AGENTS.md rather than by this file:
 *
 *   1. Nothing here imports `src/cli/`. The terminal UI depends on `@clack/prompts`
 *      and a TTY; a GUI host must not drag that in. Interactive permission prompts
 *      are injected as `ConfirmFn` instead.
 *   2. Nothing here reads `process.env`. API keys, base URLs and models are passed
 *      in by the host as constructor arguments, so a host can source them from
 *      anywhere (keychain, config file, remote vault).
 *
 * Import from `@rubyclii/cli` — the `exports` map in package.json points "." here.
 */

// --- Agent loop -------------------------------------------------------------
export { Agent } from "./core/agent.js";
export type { AgentEvent, AgentRunMode } from "./core/agent.js";
export { ContextManager } from "./core/context.js";

// --- Permissions (the GUI seam) ---------------------------------------------
// `ConfirmFn` is the injection point that lets a host replace the terminal
// y/n/always prompt with, say, a modal dialog. `PermissionMode` drives the
// normal / accept-edits / plan distinction.
export { executeCalls, truncateOutput } from "./core/executor.js";
export type { ConfirmFn, ExecutionResult, ExecutorDeps, PermissionMode } from "./core/executor.js";

// --- Context management -----------------------------------------------------
export { compactHistory, contextWindowFor, COMPACTION_TARGET_TOKENS } from "./core/compact.js";
export type { CompactResult } from "./core/compact.js";
export { loadSystemInstruction, DEFAULT_SYSTEM_INSTRUCTION } from "./core/prompt.js";
export type { ProjectDoc, SystemInstructionContext } from "./core/prompt.js";

// --- Observability (token and turn metrics) ---------------------------------
export type { ObservabilityEvent, ObservabilityHandler } from "./core/observability.js";

// --- Providers --------------------------------------------------------------
// The RubyCLI preset lives in the registry, so a host can enumerate providers,
// read a model's context window, and route a model name without hardcoding any
// of it. See the `isRubyCatalogModel` note in cli/models.ts for why routing
// needs the host to know whether a Ruby key is configured.
export {
  createClient,
  createCompactionClient,
  detectProvider,
  hasNativeThinking,
} from "./providers/factory.js";
export type { Provider } from "./providers/factory.js";
export {
  PRESETS,
  DEFAULT_PROVIDER,
  DEFAULT_CONTEXT_WINDOW,
  getPreset,
  listProviderIds,
  isKnownProvider,
  detectProviderFromRegistry,
  findModelInfo,
  looksLikeLocalModelName,
  providerDetectionWarning,
} from "./providers/registry.js";
export type { ModelInfo, ProviderPreset, WireFormat } from "./providers/registry.js";
export type { LLMClient } from "./providers/client.js";
export type {
  FunctionCallPart,
  FunctionResultPart,
  Message,
  MessagePart,
  Role,
  StreamEvent,
  TextPart,
  ToolDefinition,
  ToolResult,
} from "./providers/types.js";

// --- Model catalog ----------------------------------------------------------
// `GET /v1/models`. A host needs this to build a model picker and to learn each
// model's real context window, which the static registry table can only guess at.
export {
  fetchRemoteModels,
  remoteContextWindow,
  remoteMaxOutputTokens,
  isRubyCatalogModel,
} from "./providers/catalog.js";
export type { FetchModelsResult, RemoteModel } from "./providers/catalog.js";

// --- Tools ------------------------------------------------------------------
export { createDefaultRegistry } from "./tools/index.js";
export { ToolRegistry } from "./tools/registry.js";
export type { JSONSchema, Tool, ToolExecutionContext, ToolRunner } from "./tools/base.js";
export type { SpawnSubAgentFn } from "./tools/task/subagent.js";
export { createSandboxRunner } from "./tools/exec/sandbox/index.js";
export type { SandboxMode, SandboxRunner } from "./tools/exec/sandbox/types.js";

// --- MCP --------------------------------------------------------------------
export { McpManager } from "./mcp/manager.js";
export { McpClient } from "./mcp/client.js";
export { loadMcpConfig } from "./mcp/config.js";
export { mcpToolToTool } from "./mcp/adapter.js";
export type { McpClientOpts } from "./mcp/client.js";
export type { McpConfig, McpServerConfig, McpToolInfo } from "./mcp/types.js";

// --- Skills -----------------------------------------------------------------
export { SkillRegistry } from "./skills/registry.js";
export type { SkillEntry } from "./skills/registry.js";

// --- State: sessions, goals, snapshots, settings ----------------------------
export { Session } from "./state/session.js";
export type { SessionEntry, SessionSummary } from "./state/session.js";
export { loadGoal, setGoal, noteGoal, setGoalStatus, clearGoal } from "./state/goal.js";
export type { Goal, GoalStatus } from "./state/goal.js";
export { SnapshotManager } from "./state/snapshot.js";
export type { RewindResult } from "./state/snapshot.js";
export { loadSettings, saveSettings } from "./state/settings.js";
export type { Settings } from "./state/settings.js";
export { loadConfig, saveConfig, AGENT_DIR } from "./state/config.js";
export type { Config, Permissions } from "./state/config.js";

// --- Product constants ------------------------------------------------------
// Branding, default endpoint and the accepted API-key env var names. Kept in
// one place so a host renders the same product identity as the CLI.
export {
  PRODUCT_NAME,
  CLI_COMMAND,
  NPM_PACKAGE,
  AGENT_DIR_NAME,
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
  API_KEY_ENV,
  API_KEY_ENVS,
  DEBUG_ENV,
  MODEL_ENV,
  BASE_URL_ENV,
  findApiKeyInEnv,
  readApiKeyFromEnv,
  maskApiKey,
  redactRubyKey,
} from "./rubycli.js";
