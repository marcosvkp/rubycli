import { Command, InvalidArgumentError } from "commander";
import { createInterface } from "node:readline";
import { createClient, createCompactionClient, detectProvider } from "../providers/factory.js";
import {
  isKnownProvider,
  listProviderIds,
  providerDetectionWarning,
} from "../providers/registry.js";
import { resolveContextWindow } from "./context-window.js";
import { fetchRemoteModels, remoteContextWindow } from "./models.js";
import { Agent } from "../core/agent.js";
import { createDefaultRegistry } from "../tools/index.js";
import { SkillRegistry } from "../skills/registry.js";
import { loadConfig, saveConfig, AGENT_DIR } from "../state/config.js";
import { Session } from "../state/session.js";
import { loadSystemInstruction } from "../core/prompt.js";
import { resolveApiKey } from "./keys.js";
import { runRepl } from "./repl.js";
import { createConfirmFn, createAutoApproveConfirmFn } from "./confirm.js";
import { printError, printInfo } from "./renderer.js";
import type { ObservabilityEvent } from "../core/observability.js";
import { createSandboxRunner } from "../tools/exec/sandbox/index.js";
import type { SandboxMode } from "../tools/exec/sandbox/types.js";
import type { Config } from "../state/config.js";
import { loadMcpConfig } from "../mcp/config.js";
import { McpManager } from "../mcp/manager.js";
import { registerMcpCommand } from "./mcp-cmd.js";
import { SnapshotManager } from "../state/snapshot.js";
import pkg from "../../package.json";
import { looksLikeActionablePlan } from "./plan.js";
import {
  PRODUCT_NAME,
  CLI_COMMAND,
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
  API_KEY_ENV,
  DEBUG_ENV,
  MODEL_ENV,
  BASE_URL_ENV,
  redactRubyKey,
} from "../rubycli.js";

function parseTurns(raw: string): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1)
    throw new InvalidArgumentError("--max-turns must be a positive integer");
  return n;
}

function parseTemperature(raw: string): number {
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0 || n > 2)
    throw new InvalidArgumentError("--temperature must be between 0 and 2");
  return n;
}

const program = new Command();

program
  .name(CLI_COMMAND)
  .description(`${PRODUCT_NAME} — AI coding agent powered by RubyCLI Cloud`)
  .version(pkg.version);

program
  .command("chat", { isDefault: true })
  .description("Start an interactive chat session")
  .option("-m, --model <model>", `Model to use (default: ${DEFAULT_MODEL})`)
  .option("-r, --resume", "Resume the most recent session")
  .option("-s, --session <id>", "Resume a specific session by ID")
  .option("--max-turns <n>", "Maximum agent iterations per prompt (default: 50)", parseTurns)
  .option("--debug", "Emit structured observability events to stderr as JSON")
  .option("--sandbox <mode>", "Sandbox mode for bash tool: auto | strict | off (default: auto)")
  .option(
    "--provider <provider>",
    "Override provider detection (default: rubycli; advanced use only)",
  )
  .option("--base-url <url>", "Custom RubyCLI API base URL (advanced use only)")
  .action(async (opts) => {
    const sessionId = opts.session ?? (opts.resume ? "latest" : undefined);
    await startChat(
      opts.model,
      sessionId,
      opts.maxTurns,
      opts.debug as boolean | undefined,
      opts.sandbox as string | undefined,
      opts.provider as string | undefined,
      opts.baseUrl as string | undefined,
    );
  });

program
  .command("sessions")
  .description("List recent sessions for the current directory")
  .action(async () => {
    const sessions = await Session.list();
    if (sessions.length === 0) {
      printInfo("No sessions found for this directory.");
      return;
    }
    printInfo(`Sessions for ${process.cwd()}:\n`);
    for (const s of sessions) {
      const preview = s.firstUserMessage ? `  "${s.firstUserMessage}"` : "";
      process.stderr.write(`  ${s.id}${preview ? `\n  ${preview}` : ""}\n\n`);
    }
  });

program
  .command("run <prompt>")
  .description("Run a single prompt and exit")
  .option("-m, --model <model>", "Model to use")
  .option("--max-turns <n>", "Maximum agent iterations (default: 50)", parseTurns)
  .option("--plan", "Run a read-only planning pass first, then auto-execute the plan")
  .option("--yes", "Auto-approve all tool confirmations (skip interactive prompts)")
  .option("--debug", "Emit structured observability events to stderr as JSON")
  .option("--sandbox <mode>", "Sandbox mode for bash tool: auto | strict | off (default: auto)")
  .option("--provider <provider>", "Override provider detection (advanced use only)")
  .option("--base-url <url>", "Custom RubyCLI API base URL (advanced use only)")
  .option("--temperature <float>", "LLM temperature (use 0 for determinism)", parseTemperature)
  .action(async (prompt: string, opts) => {
    await runSingle(
      prompt,
      opts.model,
      opts.maxTurns,
      opts.plan as boolean | undefined,
      opts.yes as boolean | undefined,
      opts.debug as boolean | undefined,
      opts.sandbox as string | undefined,
      opts.provider as string | undefined,
      opts.baseUrl as string | undefined,
      opts.temperature as number | undefined,
    );
  });

program
  .command("config")
  .description("View or set configuration")
  .option("--api-key <key>", `Set your ${PRODUCT_NAME} API key`)
  .option("--model <model>", "Set the default model")
  .option("--base-url <url>", "Set a custom RubyCLI API base URL")
  .action(async (opts) => {
    if (opts.apiKey) {
      await saveConfig({ rubyApiKey: opts.apiKey });
      printInfo(`${PRODUCT_NAME} API key saved.`);
    }
    if (opts.model) {
      await saveConfig({ model: opts.model });
      printInfo(`Default model set to ${opts.model}.`);
    }
    if (opts.baseUrl) {
      await saveConfig({ baseUrl: opts.baseUrl });
      printInfo(`Base URL set to ${opts.baseUrl}.`);
    }
    if (!opts.apiKey && !opts.model && !opts.baseUrl) {
      const config = await loadConfig();
      console.log(
        JSON.stringify(
          {
            ...config,
            rubyApiKey: config.rubyApiKey ? "***" : undefined,
            geminiApiKey: config.geminiApiKey ? "***" : undefined,
            anthropicApiKey: config.anthropicApiKey ? "***" : undefined,
            openaiApiKey: config.openaiApiKey ? "***" : undefined,
          },
          null,
          2,
        ),
      );
    }
  });

program
  .command("model")
  .description("View or set the default model")
  .argument("[model]", "Model to set as default (omit to show current)")
  .action(async (model?: string) => {
    if (model) {
      await saveConfig({ model });
      printInfo(`Default model set to ${model}.`);
    } else {
      const config = await loadConfig();
      console.log(config.model);
    }
  });

registerMcpCommand(program);

program.parseAsync(process.argv).catch((err) => {
  printError(redactRubyKey(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});

async function startChat(
  modelOverride?: string,
  resumeSessionId?: string,
  maxTurns?: number,
  debug?: boolean,
  sandboxFlag?: string,
  providerOverride?: string,
  baseUrlOverride?: string,
): Promise<void> {
  const {
    agent,
    skills,
    mcpManager,
    snapshotManager,
    model,
    apiKey,
    provider,
    baseUrl,
    contextWindow,
    effectiveTemperature,
  } = await createAgent(
    modelOverride,
    maxTurns,
    debug,
    sandboxFlag,
    providerOverride,
    baseUrlOverride,
  );

  const cleanup = async () => {
    await mcpManager.disconnectAll();
  };

  // Ctrl+C in the REPL calls onExit for graceful MCP subprocess shutdown
  const onExit = async () => {
    await cleanup();
    process.exit(0);
  };

  // SIGTERM / SIGINT (signal-driven exit) also need graceful cleanup
  process.once("SIGTERM", () => void onExit());
  process.once("SIGINT", () => void onExit());

  process.stdout.write(`\n${PRODUCT_NAME}\n\n${model}\n\n`);
  await runRepl(agent, skills, resumeSessionId, onExit, snapshotManager, {
    apiKey,
    provider,
    baseUrl,
    contextWindow,
    temperature: effectiveTemperature,
  });
  await cleanup(); // normal exit (Ctrl+D or /exit)
}

async function runSingle(
  prompt: string,
  modelOverride?: string,
  maxTurns?: number,
  planMode?: boolean,
  autoApprove?: boolean,
  debug?: boolean,
  sandboxFlag?: string,
  providerOverride?: string,
  baseUrlOverride?: string,
  temperature?: number,
): Promise<void> {
  const { agent, mcpManager } = await createAgent(
    modelOverride,
    maxTurns,
    debug,
    sandboxFlag,
    providerOverride,
    baseUrlOverride,
    temperature,
  );
  if (autoApprove) {
    // --yes auto-approves tool calls, but STILL honours the user's deny patterns and
    // a built-in catastrophic blocklist (rm -rf /, curl|sh, fork bombs). Previously
    // --yes replaced confirmFn with () => "allow", bypassing permissions.deny.
    // See GHSA-hx58-45j4-fr7m.
    agent.setConfirmFn(await createAutoApproveConfirmFn());
  } else if (process.stdin.isTTY) {
    const { confirmFn, forcesConfirmation } = await createConfirmFn();
    agent.setConfirmFn(confirmFn);
    agent.setForcesConfirmationFn(forcesConfirmation);
  }
  // no confirmFn → executor auto-denies tools that require confirmation

  const stream = async (input: string, mode: "react" | "plan") => {
    let text = "";
    for await (const event of agent.run(input, mode)) {
      if (event.type === "text") {
        process.stdout.write(event.text);
        text += event.text;
      }
      if (event.type === "error") process.stderr.write(`Error: ${redactRubyKey(event.message)}\n`);
      if (event.type === "done") process.stdout.write("\n");
    }
    return text;
  };

  const sigCleanup = async () => {
    await mcpManager.disconnectAll();
    process.exit(0);
  };
  const sigHandler = () => void sigCleanup();
  process.once("SIGINT", sigHandler);
  process.once("SIGTERM", sigHandler);

  try {
    if (planMode) {
      const planText = await stream(prompt, "plan");
      if (planText.trim() && looksLikeActionablePlan(planText)) {
        process.stderr.write("\nExecuting plan…\n");
        await stream(
          `I have approved the following plan. Execute it step by step:\n\n${planText}`,
          "react",
        );
      }
    } else {
      await stream(prompt, "react");
    }
  } finally {
    process.off("SIGINT", sigHandler);
    process.off("SIGTERM", sigHandler);
    await mcpManager.disconnectAll();
  }
}

function makeDebugHandler(): (event: ObservabilityEvent) => void {
  return (event) => process.stderr.write(redactRubyKey(JSON.stringify(event)) + "\n");
}

/**
 * Look up the startup model's real context window from GET <baseUrl>/models.
 * Returns the API-reported window on a hit, otherwise the pre-resolved value.
 * Silent on any failure — context-window resolution must never block startup.
 */
async function resolveLiveContextWindow(
  model: string,
  baseUrl: string,
  apiKey: string,
  fallback: number | undefined,
): Promise<number | undefined> {
  try {
    const { models } = await fetchRemoteModels(baseUrl, apiKey);
    const hit = models.find((m) => m.id === model);
    return (hit && remoteContextWindow(hit)) ?? fallback;
  } catch {
    return fallback;
  }
}

function resolveSandboxMode(flagValue: string | undefined, config: Config): SandboxMode {
  const raw =
    flagValue ??
    process.env.RUBYCLI_SANDBOX ??
    process.env.OPENCLI_SANDBOX ??
    config.sandbox ??
    "auto";
  if (raw === "auto" || raw === "strict" || raw === "off") return raw;
  throw new Error(`Invalid --sandbox value '${raw}'. Valid values: auto, strict, off`);
}

function resolveProvider(flag: string | undefined, config: Config, model: string): string {
  const raw = flag ?? config.provider;
  if (raw !== undefined) {
    if (isKnownProvider(raw)) return raw;
    throw new Error(
      `Invalid --provider value '${raw}'. Valid values: ${listProviderIds().join(", ")}`,
    );
  }
  // RubyCLI is the default product experience — only models outside the ruby-*
  // namespace fall through to registry detection (advanced use).
  if (model.startsWith("ruby-")) return "rubycli";
  const detected = detectProvider(model);
  const warning = providerDetectionWarning(model, detected);
  if (warning) process.stderr.write(`[${CLI_COMMAND}] warn: ${redactRubyKey(warning)}\n`);
  return detected;
}

/**
 * Resolve the RubyCLI API key with the documented priority:
 *   1. RUBYCLI_API_KEY env var (never auto-persisted)
 *   2. persisted local config (~/.rubycli/config.json)
 *   3. interactive prompt (first run onboarding)
 *
 * For the rubycli provider this replaces the generic resolveApiKey throw with
 * an onboarding flow; other providers keep the legacy behaviour.
 */
async function resolveRubyApiKey(config: Config, provider: string): Promise<string> {
  if (provider !== "rubycli") return resolveApiKey(provider, config);

  const fromEnv = process.env[API_KEY_ENV];
  if (fromEnv) return fromEnv;
  if (config.rubyApiKey) return config.rubyApiKey;

  // Interactive onboarding — only when attached to a TTY.
  if (!process.stdin.isTTY) {
    throw new Error(
      `No ${PRODUCT_NAME} API key configured. Set ${API_KEY_ENV}, ` +
        `or run '${CLI_COMMAND}' interactively to configure one.`,
    );
  }

  process.stdout.write(`\n${PRODUCT_NAME}\n\nNo API key configured.\n\n`);
  const key = await promptForApiKey();
  process.stdout.write("\nValidating API key...\n");

  const baseUrl = process.env[BASE_URL_ENV] ?? config.baseUrl ?? DEFAULT_BASE_URL;
  const valid = await validateApiKey(baseUrl, key);
  if (!valid) {
    throw new Error(`Invalid ${PRODUCT_NAME} API key. Please try again.`);
  }

  await saveConfig({ rubyApiKey: key });
  process.stdout.write(`✓ API key configured\n\nStarting ${PRODUCT_NAME}...\n`);
  return key;
}

function promptForApiKey(): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(`Enter your ${PRODUCT_NAME} API key:\n> `);
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question("", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Lightweight key validation: GET <baseUrl>/models with the key.
 * Any 2xx counts as valid; 401/403 means invalid; anything else (network
 * errors, 5xx) is treated as "cannot validate" → invalid with a clear error.
 */
async function validateApiKey(baseUrl: string, key: string): Promise<boolean> {
  try {
    const url = baseUrl.replace(/\/+$/, "") + "/models";
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function createAgent(
  modelOverride?: string,
  maxTurns?: number,
  debug?: boolean,
  sandboxFlag?: string,
  providerOverride?: string,
  baseUrlOverride?: string,
  temperature?: number,
) {
  const config = await loadConfig();
  const model = process.env[MODEL_ENV] ?? modelOverride ?? config.model ?? DEFAULT_MODEL;

  const sandboxMode = resolveSandboxMode(sandboxFlag, config);
  const runner = createSandboxRunner(sandboxMode, process.cwd());
  if (runner.warning) {
    process.stderr.write(`[${CLI_COMMAND}] warn: ${runner.warning}\n`);
  }

  const provider = resolveProvider(providerOverride, config, model);
  const baseUrl =
    process.env[BASE_URL_ENV] ?? baseUrlOverride ?? config.baseUrl ?? DEFAULT_BASE_URL;
  const debugOn = debug ?? process.env[DEBUG_ENV] === "1";
  const apiKey = await resolveRubyApiKey(config, provider);
  // Fixes #251: config.temperature was previously ignored unless --temperature was passed.
  const effectiveTemperature = temperature ?? config.temperature;
  if (debugOn) {
    process.stderr.write(
      `[${CLI_COMMAND}] debug: provider=${provider} model=${model} endpoint=${baseUrl}\n`,
    );
  }
  const client = createClient(model, apiKey, {
    includeUsage: true,
    maxTokens: config.maxTokens,
    provider,
    baseUrl,
    temperature: effectiveTemperature,
    onWarn: debugOn ? (msg) => process.stderr.write(`[${CLI_COMMAND}] warn: ${msg}\n`) : undefined,
  });
  const tools = createDefaultRegistry(model, runner);

  // Load and connect MCP servers, registering their tools into the registry
  const mcpConfig = await loadMcpConfig(AGENT_DIR);
  const mcpManager = await McpManager.create(mcpConfig ?? { mcpServers: {} });
  if (mcpManager.connectedCount > 0) {
    await mcpManager.registerTools(tools);
    process.stderr.write(`[mcp] ${mcpManager.connectedCount} server(s) connected\n`);
  }

  const skills = new SkillRegistry();
  await skills.discover();

  const snapshotManager = new SnapshotManager();

  const systemInstruction = await loadSystemInstruction();
  const compactionClient = createCompactionClient(model, apiKey, { provider, baseUrl });
  const { contextWindow: resolvedWindow, warnings } = await resolveContextWindow(
    model,
    provider,
    baseUrl,
    config,
  );
  // The live API list is authoritative for the context window when it reports one:
  // a static registry entry (or the 100k default) would otherwise under-report
  // models the registry doesn't know about yet.
  const contextWindow = await resolveLiveContextWindow(model, baseUrl, apiKey, resolvedWindow);
  for (const warning of warnings) {
    process.stderr.write(`[${CLI_COMMAND}] warn: ${redactRubyKey(warning)}\n`);
  }
  const agent = new Agent(client, tools, skills, systemInstruction, config.historySize, maxTurns, {
    model,
    onObservability: debugOn ? makeDebugHandler() : undefined,
    snapshotManager,
    compactionClient,
    autoCompact: config.autoCompact,
    contextWindow,
    provider,
  });
  return {
    agent,
    skills,
    mcpManager,
    snapshotManager,
    model,
    apiKey,
    provider,
    baseUrl,
    contextWindow,
    effectiveTemperature,
  };
}
