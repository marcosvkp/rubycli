# Agent workflows

RubyCLI exposes a small workflow DSL for hosts that can safely launch child agents. The DSL is
available from `@rubyclii/cli` and can be registered as the `workflow` tool with
`createDefaultRegistry(..., { workflow })` or `createWorkflowTool(...)`.

```ts
import { createDefaultRegistry, type WorkflowAgentRequest } from "@rubyclii/cli";

const runExplorer = async (request: WorkflowAgentRequest): Promise<string> => {
  // Create a child Agent with the host's selected model and read-only tool set.
  return runChildAgent(request);
};

const registry = createDefaultRegistry(model, runner, {
  workflow: { runAgent: runExplorer },
});
```

Hosts can also supply `runWorkerInWorktree` and `confirmWorker`. The workflow executor refuses to
start a worker unless both are present, asks for approval once per worker, serializes those approval
prompts, and calls the worker runner only after approval. The worker runner must create and use an
isolated worktree; the workflow layer intentionally does not know how a host manages worktrees,
model catalogs, or user approval UI. Model availability and reasoning-effort support must be
validated by the host callback before launch.

## DSL

The tool accepts one expression made from these calls and JSON-like literal data:

```js
pipeline(
  phase(
    "Research",
    parallel(
      agent({ name: "api-scout", prompt: "Find the existing API boundaries." }),
      agent({
        name: "test-scout",
        prompt: "Find relevant tests and report gaps.",
        resultSchema: {
          type: "object",
          properties: { files: { type: "array", items: { type: "string" } } },
          required: ["files"],
          additionalProperties: false,
        },
      }),
    ),
  ),
  log("Research finished; implementation can begin."),
  phase(
    "Implementation",
    agent({
      name: "implementer",
      role: "worker",
      prompt: "Implement the agreed changes.",
      model: "ruby-smart",
      reasoningEffort: "high",
      maxTurns: 20,
      instructions: "Keep the public API backward compatible.",
    }),
  ),
);
```

- `agent({ name, prompt, role?, model?, reasoningEffort?, instructions?, maxTurns?, resultSchema? })`
  declares one child. Role defaults to `explorer`; `worker` requires the host callbacks described
  above. A pipeline passes earlier outputs to later agents both in `request.inputs` and as a clearly
  marked untrusted-data section appended to the prompt.
- `parallel(...steps)` runs independent children concurrently, bounded by `maxConcurrency` (default
  3, hard maximum 8). All children receive the same input snapshot, so a faster sibling cannot
  change another sibling's prompt.
- `pipeline(...steps)` runs children in order and stops after a failure.
- `phase(name, ...steps)` reports phase start/end events and runs its children in order.
- `log(message)` emits a progress event without launching an agent.

An agent with `resultSchema` must return raw JSON or one fenced JSON block. Ajv validates the parsed
value against JSON Schema (draft-07); invalid JSON, an invalid schema, or a schema mismatch fails
the workflow with a specific error. Structured values are available to later pipeline agents and
are included in the final result map keyed by agent name. Names must be unique within one workflow.

## Restricted script language

The `workflow` tool does **not** use `eval`, `Function`, or `node:vm`. A parser accepts only the five
DSL call names, nested calls, object/array literals, strings, finite numbers, booleans, `null`, and
comments. It rejects declarations, property access, operators, imports, arbitrary identifiers, and
all other executable JavaScript. This is intentionally a JavaScript-like expression language, not
general-purpose JavaScript, so model-generated scripts cannot get a host object or filesystem
capability from the interpreter.

The parser and executor cap source size, step count, nesting, prompt/instruction/schema/result
sizes, and concurrency. Workflow callbacks remain a trusted host boundary: they are responsible for
constructing child agents with the proper tool set, validating catalog models, enforcing approval,
and isolating worker writes in worktrees.

## API

- `parseWorkflowScript(source)` parses and validates a DSL expression.
- `agent`, `parallel`, `pipeline`, `phase`, and `log` are typed builders for trusted TypeScript
  callers; they produce the same nodes as the parser.
- `executeWorkflow(node, options)` runs a node and returns `{ results, logs }`.
- `createWorkflowTool(options)` creates a normal RubyCLI `Tool`; use it only when the host has
  wired a child-agent runner.
- `WorkflowAgentRunner`, `WorkflowWorkerApproval`, and `WorkflowAgentRequest` define the adapter
  contract between the library and its host.

Workflow execution is opt-in in `createDefaultRegistry` through the `workflow` option, so existing
embedders do not unexpectedly gain a tool that has no configured child-agent policy.
