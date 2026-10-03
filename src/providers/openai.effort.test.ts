import { describe, expect, it, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { OpenAIClient } from "./openai.js";

/**
 * reasoning_effort must reach the wire for reasoning models and stay absent
 * otherwise. A mock [OI]-compatible SSE server captures the request body.
 */

let server: http.Server;
let port = 0;
const bodies: Record<string, unknown>[] = [];

function sseChunk(delta: object, finish: string | null, usage?: object): string {
  return (
    "data: " +
    JSON.stringify({
      id: "1",
      object: "chat.completion.chunk",
      created: 1,
      model: "x",
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...(usage ? { usage } : {}),
    }) +
    "\n\n"
  );
}

const TEXT_REPLY =
  sseChunk({ content: "ok" }, "stop", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }) +
  "data: [DONE]\n\n";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [] }));
        return;
      }
      bodies.push(JSON.parse(body || "{}"));
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(TEXT_REPLY);
    });
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function makeClient(model: string, effort?: "low" | "medium" | "high"): OpenAIClient {
  return new OpenAIClient("test-key", model, {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    reasoningEffort: effort,
  });
}

async function collect(client: OpenAIClient): Promise<void> {
  for await (const _ of client.stream(
    [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
    "sys",
    [],
  )) {
    // drain
  }
}

describe("OpenAI reasoning_effort", () => {
  it("sends reasoning_effort for reasoning models", async () => {
    await collect(makeClient("ruby-thinking", "high"));
    const last = bodies[bodies.length - 1];
    expect(last.reasoning_effort).toBe("high");
  });

  it("omits reasoning_effort for non-reasoning models even when set", async () => {
    await collect(makeClient("ruby-auto", "low"));
    const last = bodies[bodies.length - 1];
    expect(last.reasoning_effort).toBeUndefined();
  });

  it("omits reasoning_effort when unset", async () => {
    await collect(makeClient("ruby-thinking", undefined));
    const last = bodies[bodies.length - 1];
    expect(last.reasoning_effort).toBeUndefined();
  });

  it("forwards low and medium too", async () => {
    await collect(makeClient("o3-mini", "low"));
    await collect(makeClient("o3-mini", "medium"));
    expect(bodies[bodies.length - 2].reasoning_effort).toBe("low");
    expect(bodies[bodies.length - 1].reasoning_effort).toBe("medium");
  });
});
