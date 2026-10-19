export { readTool } from "./file/read.js";
export { writeTool } from "./file/write.js";
export { editTool } from "./file/edit.js";
export { multiEditTool } from "./file/multi-edit.js";
export { globTool } from "./file/glob.js";
export { grepTool } from "./file/grep.js";
export { lsTool } from "./file/ls.js";
export { createBashTool } from "./exec/bash.js";
export { thinkTool } from "./think.js";
export { webFetchTool } from "./web/fetch.js";
export { webSearchTool } from "./web/search.js";
export { createImageTools } from "./image-generation.js";
export type { ImageGenerationToolOptions } from "./image-generation.js";
export { todoWriteTool, todoReadTool } from "./task/todo.js";
export { createTaskTool, type SpawnSubAgentFn } from "./task/subagent.js";
export { createAskUserTool, type AskUserFn } from "./task/ask-user.js";
export {
  agent,
  parallel,
  pipeline,
  phase,
  log,
  parseWorkflowScript,
  executeWorkflow,
  createWorkflowTool,
} from "./task/workflow.js";
export type {
  WorkflowAgentConfig,
  WorkflowAgentRequest,
  WorkflowAgentRunner,
  WorkflowWorkerApproval,
  WorkflowResultSchema,
  WorkflowStep,
  WorkflowEvent,
  WorkflowRunOptions,
  WorkflowRunResult,
  CreateWorkflowToolOptions,
} from "./task/workflow.js";
export { ToolRegistry } from "./registry.js";
export type { Tool } from "./base.js";

import { ToolRegistry } from "./registry.js";
import { readTool } from "./file/read.js";
import { writeTool } from "./file/write.js";
import { editTool } from "./file/edit.js";
import { multiEditTool } from "./file/multi-edit.js";
import { globTool } from "./file/glob.js";
import { grepTool } from "./file/grep.js";
import { lsTool } from "./file/ls.js";
import { createBashTool } from "./exec/bash.js";
import { thinkTool } from "./think.js";
import { webFetchTool } from "./web/fetch.js";
import { webSearchTool } from "./web/search.js";
import { createImageTools, type ImageGenerationToolOptions } from "./image-generation.js";
import { todoWriteTool, todoReadTool } from "./task/todo.js";
import { createTaskTool, type SpawnSubAgentFn } from "./task/subagent.js";
import { createAskUserTool, type AskUserFn } from "./task/ask-user.js";
import { createWorkflowTool, type CreateWorkflowToolOptions } from "./task/workflow.js";
import { scopeToolToWorkspace } from "./file/workspace.js";
import { hasNativeThinking } from "../providers/factory.js";
import { PassthroughRunner } from "./exec/sandbox/passthrough.js";
import type { SandboxRunner } from "./exec/sandbox/types.js";

/**
 * Creates a tool registry with all built-in tools.
 * When a model name is provided, the `think` tool is omitted for models
 * with native thinking/reasoning (e.g. Gemini 2.5+) since their built-in
 * reasoning is cheaper and faster than a tool-call round-trip.
 */
export function createDefaultRegistry(
  model?: string,
  runner?: SandboxRunner,
  opts?: {
    spawnSubAgent?: SpawnSubAgentFn;
    askUser?: AskUserFn;
    workflow?: CreateWorkflowToolOptions;
    includeTask?: boolean;
    workspaceRoot?: string;
    imageGeneration?: ImageGenerationToolOptions;
  },
): ToolRegistry {
  const registry = new ToolRegistry();
  const effectiveRunner = runner ?? new PassthroughRunner("off");
  const fileTools = [readTool, writeTool, editTool, multiEditTool, globTool, grepTool, lsTool];
  const tools = [
    ...(opts?.workspaceRoot
      ? fileTools.map((tool) => scopeToolToWorkspace(tool, opts.workspaceRoot!))
      : fileTools),
    createBashTool(effectiveRunner, opts?.workspaceRoot),
    webFetchTool,
    webSearchTool,
    todoWriteTool,
    todoReadTool,
    createAskUserTool(opts?.askUser),
  ];

  if (opts?.includeTask !== false) tools.push(createTaskTool(opts?.spawnSubAgent));
  if (opts?.workflow) tools.push(createWorkflowTool(opts.workflow));
  if (opts?.imageGeneration) tools.push(...createImageTools(opts.imageGeneration));

  if (!model || !hasNativeThinking(model)) {
    tools.push(thinkTool);
  }

  registry.registerAll(tools);
  return registry;
}
