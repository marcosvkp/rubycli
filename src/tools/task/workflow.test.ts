import { describe, expect, it, vi } from "vitest";
import {
  WorkflowSemaphore,
  agent,
  createWorkflowTool,
  executeWorkflow,
  parallel,
  parseWorkflowScript,
  pipeline,
} from "./workflow.js";

describe("workflow DSL", () => {
  it("parses nested calls and JSON-like options", () => {
    const result = parseWorkflowScript(
      `pipeline(phase("Research", parallel(agent({ name: "a", prompt: "inspect" }), ` +
        `agent({ name: "b", prompt: "tests", resultSchema: { type: "object", required: ["ok"] } }))), ` +
        `log("ready"))`,
    );

    expect(result.kind).toBe("pipeline");
  });

  it.each([
    `process.exit()`,
    `agent({ name: "x", prompt: "go" }).constructor("return process")()`,
    `pipeline(agent({ name: "x", prompt: "go" })); process.exit()`,
    `parallel(...agents)`,
    `agent({ name: "x", prompt: ` + "`template`" + ` })`,
    `agent({ name: "x", prompt: "go", __proto__: {} })`,
  ])("rejects executable JavaScript: %s", (script) => {
    expect(() => parseWorkflowScript(script)).toThrow();
  });

  it("runs pipeline agents in order and passes earlier outputs as untrusted context", async () => {
    const prompts: string[] = [];
    const definition = pipeline(
      agent({ name: "research", prompt: "Find the API", resultSchema: { type: "object" } }),
      agent({ name: "implement", prompt: "Use the findings" }),
    );

    const result = await executeWorkflow(definition, {
      runAgent: async (request) => {
        prompts.push(request.prompt);
        if (request.name === "research") return '{"endpoint":"/items"}';
        expect(request.inputs).toEqual({ research: { endpoint: "/items" } });
        return "done";
      },
    });

    expect(result.results).toEqual({ research: { endpoint: "/items" }, implement: "done" });
    expect(prompts[1]).toContain("untrusted reference data");
  });

  it("fails a workflow when a structured result violates its JSON Schema", async () => {
    await expect(
      executeWorkflow(
        agent({
          name: "research",
          prompt: "Return JSON",
          resultSchema: {
            type: "object",
            properties: { count: { type: "integer" } },
            required: ["count"],
            additionalProperties: false,
          },
        }),
        { runAgent: async () => '{"count":"many"}' },
      ),
    ).rejects.toThrow("does not match its JSON Schema");
  });

  it("validates standard JSON Schema formats", async () => {
    await expect(
      executeWorkflow(
        agent({
          name: "contact",
          prompt: "Return an email address",
          resultSchema: {
            type: "object",
            properties: { email: { type: "string", format: "email" } },
            required: ["email"],
          },
        }),
        { runAgent: async () => '{"email":"not an email"}' },
      ),
    ).rejects.toThrow("does not match its JSON Schema");
  });

  it("requires explicit approval and an isolated-worktree callback for workers", async () => {
    const worker = agent({ name: "worker", prompt: "edit files", role: "worker" });
    const runWorker = vi.fn(async () => "finished");

    await expect(executeWorkflow(worker, {})).rejects.toThrow("confirmation callback");
    await expect(
      executeWorkflow(worker, {
        runWorkerInWorktree: runWorker,
        confirmWorker: async () => false,
      }),
    ).rejects.toThrow("was not approved");
    expect(runWorker).not.toHaveBeenCalled();

    const order: string[] = [];
    const result = await executeWorkflow(worker, {
      runWorkerInWorktree: async () => {
        order.push("run");
        return "finished";
      },
      confirmWorker: async () => {
        order.push("confirm");
        return true;
      },
    });
    expect(result.results.worker).toBe("finished");
    expect(order).toEqual(["confirm", "run"]);
  });

  it("gives parallel siblings the same start-of-group input snapshot", async () => {
    const captured: Record<string, Record<string, unknown>> = {};
    const result = await executeWorkflow(
      pipeline(
        agent({ name: "prior", prompt: "first" }),
        parallel(
          pipeline(
            agent({ name: "branch-first", prompt: "fast" }),
            agent({ name: "branch-second", prompt: "next" }),
          ),
          agent({ name: "queued", prompt: "queued" }),
        ),
      ),
      {
        maxConcurrency: 1,
        runAgent: async (request) => {
          captured[request.name] = { ...request.inputs };
          return request.name === "prior" ? "prior output" : `${request.name} output`;
        },
      },
    );

    expect(captured.prior).toEqual({});
    expect(captured["branch-first"]).toEqual({ prior: "prior output" });
    expect(captured["branch-second"]).toEqual({
      prior: "prior output",
      "branch-first": "branch-first output",
    });
    expect(captured.queued).toEqual({ prior: "prior output" });
    expect(result.results.queued).toBe("queued output");
  });

  it("never exceeds the configured parallel agent limit", async () => {
    const starts: string[] = [];
    const releases = new Map<string, () => void>();
    let active = 0;
    let highWater = 0;
    let resolveSecondStarted = (): void => {};
    let resolveThirdStarted = (): void => {};
    const secondStarted = new Promise<void>((resolve) => {
      resolveSecondStarted = resolve;
    });
    const thirdStarted = new Promise<void>((resolve) => {
      resolveThirdStarted = resolve;
    });

    const execution = executeWorkflow(
      parallel(
        agent({ name: "one", prompt: "one" }),
        agent({ name: "two", prompt: "two" }),
        agent({ name: "three", prompt: "three" }),
      ),
      {
        maxConcurrency: 2,
        runAgent: async (request) => {
          starts.push(request.name);
          active += 1;
          highWater = Math.max(highWater, active);
          if (starts.length === 2) resolveSecondStarted();
          if (starts.length === 3) resolveThirdStarted();
          await new Promise<void>((resolve) => {
            releases.set(request.name, () => {
              active -= 1;
              resolve();
            });
          });
          return request.name;
        },
      },
    );

    await secondStarted;
    expect(starts).toHaveLength(2);
    releases.get("one")?.();
    await thirdStarted;
    expect(highWater).toBe(2);
    releases.get("two")?.();
    releases.get("three")?.();
    await execution;
  });

  it("reserves a released slot for the oldest waiter before accepting a new caller", async () => {
    const semaphore = new WorkflowSemaphore(1);
    let occupied = 0;
    let highWater = 0;
    const acquire = async (): Promise<() => void> => {
      const releaseSlot = await semaphore.acquire();
      occupied += 1;
      highWater = Math.max(highWater, occupied);
      return () => {
        occupied -= 1;
        releaseSlot();
      };
    };

    const releaseFirst = await acquire();
    const second = acquire();
    releaseFirst();
    const third = acquire();
    const releaseSecond = await second;
    expect(highWater).toBe(1);
    releaseSecond();
    const releaseThird = await third;
    expect(highWater).toBe(1);
    releaseThird();
  });

  it("fails closed when the host has not configured an explorer runner", async () => {
    const tool = createWorkflowTool();
    const result = await tool.execute({
      script: `agent({ name: "scout", prompt: "inspect" })`,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Explorer execution is not configured");
  });
});
