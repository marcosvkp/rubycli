import chalk from "chalk";
import type { Agent } from "../core/agent.js";
import type { SkillRegistry } from "../skills/registry.js";
import { loadSkillFile, processBody } from "../skills/loader.js";
import { join } from "node:path";
import { readLine, loadHistory, saveHistory, type SlashCommand } from "./input.js";
import { expandMentions } from "./mentions.js";
import { probeServer } from "./mcp-cmd.js";
import { loadMcpConfig } from "../mcp/config.js";
import { AGENT_DIR } from "../state/config.js";
import { Session } from "../state/session.js";
import { printSkillActivated, printError, printInfo } from "./renderer.js";
import { createConfirmFn } from "./confirm.js";
import { runAgentTurn } from "./runner.js";
import { runPlanFlow } from "./plan.js";
import type { SnapshotManager } from "../state/snapshot.js";
import { fetchRemoteModels, remoteContextWindow, type RemoteModel } from "./models.js";
import { loadGoal, setGoal, setGoalStatus, clearGoal, noteGoal, type Goal } from "../state/goal.js";
import { sessionStatus } from "./status-state.js";
import { activateFooter, releaseFooter, updateFooter } from "./status-footer.js";
import { createClient, createCompactionClient } from "../providers/factory.js";
import { redactRubyKey } from "../rubycli.js";

/** Session-scoped connection info the REPL needs for /model switching. */
export interface ReplConnection {
  apiKey?: string;
  provider: string;
  baseUrl: string;
  contextWindow?: number;
  temperature?: number;
}

// Built-in slash commands (always available)
const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: "help", description: "list available skills and commands" },
  { name: "plan", description: "explore and draft a plan, then approve before executing" },
  { name: "compact", description: "summarize older conversation history to free context" },
  { name: "context", description: "show current token usage vs. context window" },
  { name: "model", description: "show or switch the session model (lists API models)" },
  { name: "effort", description: "show or set reasoning effort: low | medium | high" },
  { name: "goal", description: "set, show, pause, resume or clear the session goal" },
  { name: "auto", description: "toggle auto-mode (keep working without pausing)" },
  { name: "rewind", description: "undo agent file changes since last snapshot" },
  { name: "undo", description: "remove the last user message and agent response from history" },
  { name: "clear", description: "clear conversation history" },
  { name: "exit", description: "exit the agent" },
];

export async function runRepl(
  agent: Agent,
  skills: SkillRegistry,
  resumeSessionId?: string,
  onExit?: () => Promise<void>,
  snapshotManager?: SnapshotManager,
  connection?: ReplConnection,
): Promise<void> {
  const { confirmFn, forcesConfirmation } = await createConfirmFn();
  agent.setConfirmFn(confirmFn);
  agent.setForcesConfirmationFn(forcesConfirmation);
  printInfo(`RubyCLI — type /help for commands, Ctrl+C to exit\n`);

  let session: Session;
  if (resumeSessionId) {
    const { session: s, messages } = await Session.loadMessages(resumeSessionId);
    session = s;
    agent.restoreMessages(messages);
    printInfo(`Resumed session ${s.id} (${messages.length} messages restored)\n`);
  } else {
    session = await Session.create();
  }
  agent.setSessionTmpDir(session.tmpDir);

  const cwd = process.cwd();
  let autoMode = false;
  sessionStatus.autoMode = false;
  const existingGoal = await loadGoal(cwd);
  if (existingGoal && existingGoal.status === "active") {
    printInfo(`Active goal: ${existingGoal.text} (see /goal, toggle with /auto)\n`);
  }
  const history = await loadHistory(cwd);
  const skillCommands: SlashCommand[] = skills
    .list()
    .map((s) => ({ name: s.name, description: s.description }));
  const allCommands = [...BUILTIN_COMMANDS, ...skillCommands];

  // Permission mode indicator, cycled with Shift+Tab (normal → acceptEdits → plan).
  const modeLabel = (): string => {
    switch (agent.getPermissionMode()) {
      case "acceptEdits":
        return chalk.yellow("[accept] ");
      case "plan":
        return chalk.cyan("[plan] ");
      default:
        return "";
    }
  };
  const cycleMode = (): string => {
    const order = ["normal", "acceptEdits", "plan"] as const;
    const next = order[(order.indexOf(agent.getPermissionMode()) + 1) % order.length];
    agent.setPermissionMode(next);
    return next === "acceptEdits"
      ? "accept edits (file edits run without prompting)"
      : next === "plan"
        ? "plan (read-only)"
        : "normal (prompt for edits)";
  };

  // Compact status display, [CC]-style:
  //   header: model · context 23% · 31.4k/200k · 87 tok/s
  //   footer: » auto mode · 1 local agent · shift+tab to change
  // Segments without data are dropped; the bar grows as the session runs.
  // When the pinned footer is active it owns both rows (fixed at the bottom
  // of the screen); otherwise the header is drawn inline above the prompt.
  const formatCount = (n: number): string =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}m`
      : n >= 1000
        ? `${(n / 1000).toFixed(1)}k`
        : `${n}`;
  const statusBar = (): string => {
    const segs: string[] = [];
    const stats = agent.getContextStats();
    const model = sessionStatus.model || agent.getModel();
    if (model) segs.push(chalk.magentaBright(model));
    const window = sessionStatus.contextWindow ?? stats.contextWindow;
    const used = sessionStatus.contextUsed ?? stats.estimatedTokens;
    if (window > 0) {
      const pct = Math.min(100, Math.round((used / window) * 100));
      segs.push(
        chalk.dim("context ") +
          chalk.yellow(`${pct}%`) +
          chalk.dim(` · ${formatCount(used)} / ${formatCount(window)}`),
      );
    }
    if (sessionStatus.tokensPerSecond !== undefined) {
      segs.push(chalk.green(`${sessionStatus.tokensPerSecond.toFixed(0)} tok/s`));
    }
    return segs.join(chalk.dim(" · "));
  };
  const footerBar = (): string => {
    const segs: string[] = [];
    const mode = agent.getPermissionMode();
    if (mode === "acceptEdits") segs.push(chalk.yellow("accept edits"));
    else if (mode === "plan") segs.push(chalk.cyan("plan mode"));
    if (sessionStatus.autoMode) segs.push(chalk.yellow("» auto mode"));
    if (sessionStatus.activeAgents > 0) {
      segs.push(
        chalk.cyan(
          `${sessionStatus.activeAgents} local agent${sessionStatus.activeAgents === 1 ? "" : "s"}`,
        ),
      );
    }
    segs.push(chalk.dim("shift+tab to change"));
    return segs.join(chalk.dim(" · "));
  };

  // Pin the footer for the whole session (no-op when piped). It stays fixed
  // at the bottom while streamed output scrolls above it.
  activateFooter();
  updateFooter(statusBar(), footerBar());
  // Release on signal-driven exits too (the normal path releases after the loop).
  process.once("SIGINT", () => releaseFooter());
  process.once("SIGTERM", () => releaseFooter());

  while (true) {
    const raw = await readLine(history, allCommands, {
      onExit,
      onCycleMode: cycleMode,
      promptLabel: modeLabel,
      statusBar,
      footerBar,
    });

    // EOF (Ctrl+D)
    if (raw === null) break;

    const rawInput = raw.trim();
    if (!rawInput) continue;

    // Persist original input to history (skip duplicates at the top)
    if (history[0] !== rawInput) {
      history.unshift(rawInput);
    }

    // Expand @file/@glob mentions before passing to agent or slash commands
    const { expanded, warnings } = await expandMentions(rawInput, cwd);
    for (const w of warnings) printInfo(w);
    const input = expanded;

    // NOTE: user messages are logged at the point they actually reach the agent
    // (just before runPlanFlow / runAgentTurn below). Logging here would persist
    // REPL-only commands like /exit, /help, /clear as user content — resumed
    // sessions would then replay them as consecutive user messages and the
    // provider would reject with INVALID_ARGUMENT (role alternation violated).

    // Built-in commands
    if (input === "/help") {
      printCommandList(allCommands, skills);
      continue;
    }
    if (input === "/clear") {
      agent.clearHistory();
      printInfo("History cleared.");
      continue;
    }
    if (input === "/undo") {
      const removed = agent.undoLastTurn();
      if (removed === 0) {
        printInfo("Nothing to undo — conversation is empty.");
      } else {
        printInfo(`Undid last turn (${removed} message${removed === 1 ? "" : "s"} removed).`);
      }
      continue;
    }
    if (input === "/exit" || input === "/quit") {
      break;
    }

    // /plan <task> — read-only planning pass with user approval before execution
    if (input === "/plan" || input.startsWith("/plan ")) {
      const planPrompt = input.slice(5).trim();
      if (!planPrompt) {
        printError("Usage: /plan <task description>");
        continue;
      }
      void session.log({ type: "user", content: planPrompt });
      await runPlanFlow(agent, session, planPrompt);
      continue;
    }

    // /compact — summarize older conversation history to free context
    if (input === "/compact") {
      const stats = agent.getContextStats();
      if (stats.messageCount < 4) {
        printInfo("Nothing to compact — conversation is too short.");
        continue;
      }
      printInfo("Compacting conversation history…");
      try {
        const result = await agent.compact();
        if (result.messagesRemoved === 0) {
          printInfo("Nothing to compact — recent messages fill the full window.");
        } else {
          printInfo(
            `Compacted ${result.messagesRemoved} message(s) into a ${result.summaryLength}-char summary.`,
          );
        }
      } catch (err) {
        printError(`Compaction failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      continue;
    }

    // /context — show estimated token usage vs. context window
    if (input === "/context") {
      const { messageCount, estimatedTokens, contextWindow } = agent.getContextStats();
      const pct = Math.round((estimatedTokens / contextWindow) * 100);
      printInfo(
        `Est. tokens:  ~${estimatedTokens.toLocaleString()} / ${contextWindow.toLocaleString()}  (${pct}%)`,
      );
      printInfo(`Messages:     ${messageCount}`);
      continue;
    }

    // /model — show or switch the session model.
    // Bare "/model" lists API models (when a key is available) and the current
    // one; "/model <name-or-number>" switches for this session only.
    if (input === "/model" || input.startsWith("/model ")) {
      await handleModelCommand(agent, input.slice(6).trim(), connection);
      continue;
    }

    // /rewind — restore working tree to pre-write snapshot
    if (input === "/rewind") {
      if (snapshotManager && !snapshotManager.snapshotEnabled) {
        printInfo("Snapshot disabled (RUBYCLI_SNAPSHOT=off).");
      } else if (snapshotManager && !snapshotManager.gitAvailable) {
        printInfo("Rewind unavailable: not in a git repo, or git not installed.");
      } else if (!snapshotManager || !snapshotManager.hasSnapshot) {
        printInfo("No snapshot — no writes have happened this session.");
      } else {
        const result = await snapshotManager.rewind();
        if (result.ok) {
          if (result.restoredFiles.length === 0) {
            printInfo("Working tree already matches snapshot — nothing to restore.");
          } else {
            printInfo(`Rewound ${result.restoredFiles.length} file(s):`);
            for (const f of result.restoredFiles) {
              process.stderr.write(`  ${f}\n`);
            }
          }
        } else {
          printError(`Rewind failed: ${result.error}`);
          if (snapshotManager.lastSnapshotSha) {
            printError(
              `To recover manually: git restore --source ${snapshotManager.lastSnapshotSha} --worktree .`,
            );
          }
        }
      }
      continue;
    }

    // /mcp — quick MCP management from within the REPL
    if (input === "/mcp" || input.startsWith("/mcp ")) {
      const subArg = input.slice(4).trim();
      if (!subArg || subArg === "list") {
        const config = await loadMcpConfig(AGENT_DIR);
        if (!config || Object.keys(config.mcpServers).length === 0) {
          printInfo("No MCP servers configured. Run `ruby mcp add` to add one.\n");
        } else {
          for (const [name, cfg] of Object.entries(config.mcpServers)) {
            process.stderr.write(chalk.bold(name) + chalk.dim(` [${cfg.transport}]`) + "\n");
          }
        }
      } else if (subArg.startsWith("test ")) {
        const serverName = subArg.slice(5).trim();
        const config = await loadMcpConfig(AGENT_DIR);
        const serverConfig = config?.mcpServers[serverName];
        if (!serverConfig) {
          printError(`No server named '${serverName}' in mcp.json.`);
        } else {
          process.stderr.write(`[mcp] connecting to ${serverName}...\n`);
          const probe = await probeServer(serverName, serverConfig);
          if (probe.ok) {
            process.stderr.write(
              chalk.green(`[mcp] ✓ ok — ${probe.tools!.length} tools in ${probe.latencyMs}ms\n`),
            );
            for (const t of probe.tools!) {
              process.stderr.write(`       • ${t}\n`);
            }
          } else {
            printError(`[mcp] ✗ ${probe.error}`);
          }
        }
      } else {
        printError(`Unknown /mcp subcommand. Use /mcp or /mcp test <name>.`);
      }
      continue;
    }

    // /effort — reasoning effort for reasoning-capable models.
    // Bare "/effort" shows the current value; "/effort low|medium|high" sets it.
    if (input === "/effort" || input.startsWith("/effort ")) {
      const arg = input.slice(7).trim().toLowerCase();
      if (!arg) {
        const current = agent.getReasoningEffort();
        if (!agent.supportsReasoningEffort()) {
          printInfo(
            `Current model (${agent.getModel()}) has no reasoning controls — /effort has no effect.`,
          );
        } else {
          printInfo(
            `Reasoning effort: ${current ?? "default (medium)"} — set with /effort low|medium|high`,
          );
        }
      } else if (arg !== "low" && arg !== "medium" && arg !== "high") {
        printError("Usage: /effort low|medium|high");
      } else if (!agent.supportsReasoningEffort()) {
        printError(
          `Model '${agent.getModel()}' has no reasoning controls. Switch to a reasoning model first.`,
        );
      } else {
        agent.setReasoningEffort(
          arg,
          (model, effort) =>
            createClient(model, connection?.apiKey ?? "", {
              includeUsage: true,
              provider: connection?.provider ?? "rubycli",
              baseUrl: connection?.baseUrl,
              temperature: connection?.temperature,
              reasoningEffort: effort,
            }),
          (model, effort) =>
            createCompactionClient(model, connection?.apiKey ?? "", {
              provider: connection?.provider ?? "rubycli",
              baseUrl: connection?.baseUrl,
            }),
        );
        printInfo(`Reasoning effort set to ${arg} (session only).`);
      }
      continue;
    }

    // /goal — persistent session goal. The agent keeps working toward it
    // across turns; /goal with text sets it, bare /goal shows it.
    if (input === "/goal" || input.startsWith("/goal ")) {
      const goalArg = input.slice(5).trim();
      if (!goalArg) {
        const existing = await loadGoal(cwd);
        if (!existing) {
          printInfo("No goal set. Usage: /goal <what you want to achieve>");
        } else {
          printGoal(existing);
        }
      } else if (goalArg === "done" || goalArg === "complete") {
        const g = await setGoalStatus("complete");
        printInfo(g ? `Goal completed: ${g.text}` : "No goal set.");
      } else if (goalArg === "pause") {
        const g = await setGoalStatus("paused");
        printInfo(g ? "Goal paused." : "No goal set.");
      } else if (goalArg === "resume") {
        const g = await setGoalStatus("active");
        printInfo(g ? `Goal resumed: ${g.text}` : "No goal set.");
      } else if (goalArg === "clear") {
        await clearGoal();
        printInfo("Goal cleared.");
      } else {
        const g = await setGoal(goalArg);
        printInfo(`Goal set: ${g.text}`);
        printInfo("The agent will keep working toward it until /goal done.");
      }
      continue;
    }

    // /auto — toggle auto-mode: after each turn the agent continues on its
    // own toward the active goal instead of waiting for the next message.
    if (input === "/auto" || input.startsWith("/auto ")) {
      const autoArg = input.slice(5).trim();
      if (autoArg === "off") {
        autoMode = false;
        sessionStatus.autoMode = false;
        printInfo("Auto-mode off.");
      } else if (autoArg === "on" || !autoArg) {
        const g = await loadGoal(cwd);
        if (!g || g.status !== "active") {
          printInfo("Set a goal first: /goal <what you want to achieve>");
          autoMode = false;
          sessionStatus.autoMode = false;
        } else {
          autoMode = true;
          sessionStatus.autoMode = true;
          printInfo(`Auto-mode on — working toward: ${g.text}`);
        }
      } else {
        printError("Usage: /auto [on|off]");
      }
      continue;
    }

    // Skill invocation: /skill-name [args]
    let userMessage = input;
    if (input.startsWith("/")) {
      const [slashName, ...argParts] = input.slice(1).split(/\s+/);
      const args = argParts.join(" ");
      const entry = skills.get(slashName);

      if (!entry) {
        printError(`Unknown command: /${slashName}. Type /help to list available commands.`);
        continue;
      }

      const body = await loadAndProcess(entry.dir, args);
      if (!body) continue;

      agent.injectSkill(entry.name, body);
      printSkillActivated(entry.name);
      userMessage = args || `Please follow the ${entry.name} skill instructions.`;
    }

    void session.log({ type: "user", content: userMessage });
    await runAgentTurn(agent, session, userMessage);

    // Auto-mode: keep going toward the active goal without waiting for input.
    // Each iteration re-presents the goal with accumulated progress; the loop
    // stops when the goal is done/paused/cleared, or on turn errors.
    while (autoMode) {
      const g = await loadGoal(cwd);
      if (!g || g.status !== "active") {
        autoMode = false;
        sessionStatus.autoMode = false;
        printInfo("Auto-mode stopped — no active goal.");
        break;
      }
      const followUp =
        `Continue working toward the goal: ${g.text}\n` +
        (g.notes.length > 0 ? `Progress so far:\n- ${g.notes.join("\n- ")}\n` : "") +
        `If the goal is fully achieved, reply with exactly: GOAL_DONE and nothing else.`;
      const result = await runAgentTurn(agent, session, followUp);
      if (/^\s*GOAL_DONE\b/.test(result)) {
        await setGoalStatus("complete");
        autoMode = false;
        sessionStatus.autoMode = false;
        printInfo(`Goal completed: ${g.text}`);
        break;
      }
      if (/maximum iterations|identical tool calls/i.test(result)) {
        autoMode = false;
        sessionStatus.autoMode = false;
        printInfo("Auto-mode stopped — the last turn hit a guard. Review and resume with /auto.");
        break;
      }
      await noteGoal(result.slice(0, 500));
    }
  }

  await saveHistory(history, cwd);
  releaseFooter();
  process.stdout.write(chalk.gray("Goodbye.\n"));
}

// ── /model ────────────────────────────────────────────────────────────────────

/**
 * Show or switch the session model.
 *
 * - `/model` → lists models from GET <baseUrl>/models (when an API key is
 *   available) with the current one marked; falls back to the current model
 *   alone when the list can't be fetched.
 * - `/model <name-or-number>` → switches the session to that model without
 *   touching the persisted default. Numbers refer to the last listing order.
 */
async function handleModelCommand(
  agent: Agent,
  arg: string,
  connection?: ReplConnection,
): Promise<void> {
  const current = agent.getModel();

  if (!arg) {
    const { models, error } = connection
      ? await fetchRemoteModels(connection.baseUrl, connection.apiKey)
      : { models: [], error: "No connection info." };
    if (models.length === 0) {
      printInfo(`Current model: ${current}`);
      if (error) printInfo(`(could not list API models: ${redactRubyKey(error)})`);
      printInfo(`Usage: /model <name>`);
      return;
    }
    printInfo("Available models:");
    models.forEach((m, i) => {
      const marker = m.id === current ? chalk.green("●") : " ";
      process.stderr.write(`${marker} ${chalk.bold(`${i + 1}.`)} ${formatModelEntry(m)}\n`);
    });
    printInfo(`\nCurrent: ${current} — switch with /model <name-or-number>`);
    return;
  }

  // Resolve numeric shortcuts against a fresh listing; otherwise take the arg as-is.
  // The API-reported context window (when present) travels with the pick so the
  // status line reflects the real limit instead of the registry default.
  let target = arg;
  let targetWindow: number | undefined;
  if (/^\d+$/.test(arg) && connection) {
    const { models } = await fetchRemoteModels(connection.baseUrl, connection.apiKey);
    const picked = models[parseInt(arg, 10) - 1];
    if (!picked) {
      printError(`No model #${arg}. Run /model to see the list.`);
      return;
    }
    target = picked.id;
    targetWindow = remoteContextWindow(picked);
  } else if (connection) {
    const { models } = await fetchRemoteModels(connection.baseUrl, connection.apiKey);
    targetWindow = remoteContextWindow(
      models.find((m) => m.id === target) ?? ({ id: target } as RemoteModel),
    );
  }

  try {
    const provider = connection?.provider ?? "rubycli";
    const client = createClient(target, connection?.apiKey ?? "", {
      includeUsage: true,
      maxTokens: undefined,
      provider,
      baseUrl: connection?.baseUrl,
      temperature: connection?.temperature,
    });
    const compactionClient = createCompactionClient(target, connection?.apiKey ?? "", {
      provider,
      baseUrl: connection?.baseUrl,
    });
    // Precedence: API-reported window > startup-resolved window > registry default.
    agent.setModel(
      target,
      client,
      compactionClient,
      targetWindow ?? connection?.contextWindow,
      provider,
    );
    printInfo(`Switched to ${target} (session only — default unchanged).`);
  } catch (err) {
    printError(
      `Could not switch model: ${redactRubyKey(err instanceof Error ? err.message : String(err))}`,
    );
  }
}

/** One line for the /model list, with the real context window when the API reports it. */
function formatModelEntry(m: RemoteModel): string {
  const ctx = remoteContextWindow(m);
  if (ctx === undefined) return m.id;
  const label =
    ctx >= 1_000_000 ? `${(ctx / 1_000_000).toFixed(0)}M` : `${Math.round(ctx / 1000)}k`;
  return `${m.id} ${chalk.dim(`(${label} ctx)`)}`;
}

/** One-line summary of a goal for the REPL. */
function printGoal(g: Goal): void {
  const status =
    g.status === "active"
      ? chalk.green("active")
      : g.status === "paused"
        ? chalk.yellow("paused")
        : chalk.dim("complete");
  process.stderr.write(`${chalk.bold("Goal")} [${status}]: ${g.text}\n`);
  if (g.notes.length > 0) {
    process.stderr.write(chalk.dim(`  notes: ${g.notes.length}\n`));
  }
  process.stderr.write(
    chalk.dim("  /goal <text> set · /goal done|pause|resume|clear · /auto to keep working\n"),
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

function printCommandList(commands: SlashCommand[], skills: SkillRegistry): void {
  const builtins = commands.filter((c) => BUILTIN_COMMANDS.some((b) => b.name === c.name));
  const skillEntries = skills.list();

  printInfo("\nBuilt-in commands:");
  for (const c of builtins) {
    process.stderr.write(chalk.green(`  /${c.name}`) + chalk.gray(` — ${c.description}\n`));
  }

  if (skillEntries.length > 0) {
    printInfo("\nSkills:");
    for (const s of skillEntries) {
      process.stderr.write(chalk.magenta(`  /${s.name}`) + chalk.gray(` — ${s.description}\n`));
    }
  }

  process.stderr.write("\n");
}

async function loadAndProcess(skillDir: string, args: string): Promise<string | undefined> {
  try {
    const meta = await loadSkillFile(join(skillDir, "SKILL.md"));
    return processBody(meta.body, args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    printError(`Failed to load skill: ${message}`);
    return undefined;
  }
}
