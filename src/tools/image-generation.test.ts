import { describe, expect, it, vi } from "vitest";
import { createImageTools } from "./image-generation.js";

const imageBase64 = "iVBORw0KGgo=";

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("image generation tools", () => {
  it("quotes cost, requires a matching fresh quote, and returns base64 separately", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/images/quote")) {
        return response({
          data: {
            quote: {
              estimatedCredits: "12",
              minEstimatedCredits: "10",
              maxEstimatedCredits: "18",
            },
          },
        });
      }
      return response({
        data: [{ b64_json: imageBase64 }],
        media_type: "image/png",
        usage: { credits: 14 },
      });
    }) as typeof fetch;
    const [, quote, generate] = createImageTools({
      apiKey: "test-secret",
      fetcher,
    });

    const params = { model: "image-model", size: "1024x1024", quality: "standard", n: 1 };
    const missingQuote = await generate.execute({ ...params, prompt: "A forest" });
    expect(missingQuote.success).toBe(false);
    expect(calls).toHaveLength(0);

    const estimate = await quote.execute(params);
    expect(estimate.success).toBe(true);
    expect(estimate.output).toContain("12 créditos");
    expect(estimate.output).toContain("10–18 créditos");
    expect(calls[0].url).toBe("https://app.rubycli.cloud/v1/images/quote");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer test-secret");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      ...params,
      referenceCount: 0,
    });

    const result = await generate.execute({
      ...params,
      prompt: "A forest at sunset",
      resolution: "1K",
      aspect_ratio: "16:9",
    });
    expect(result.success).toBe(true);
    expect(generate.requiresConfirmation?.({})).toBe(true);
    expect(result.output).toContain("12 créditos");
    expect(result.output).toContain("Consumo informado pela API: 14 RU.");
    expect(result.output).not.toContain(imageBase64);
    expect(result.images).toEqual([
      { mimeType: "image/png", base64: imageBase64, alt: "Imagem gerada 1" },
    ]);
    expect(calls[1].url).toBe("https://app.rubycli.cloud/v1/images/generations");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      ...params,
      prompt: "A forest at sunset",
      resolution: "1K",
      aspect_ratio: "16:9",
    });
  });

  it("lists account image models from the dedicated catalog endpoint", async () => {
    const fetcher = vi.fn(async () =>
      response({
        data: [
          {
            id: "qwen/qwen-image-2.1-turbo",
            name: "Qwen Image 2.1 Turbo",
            supports_edit: true,
            sizes: ["1024x1024", "2048x2048"],
            variants: [
              { size: "1024x1024", quality: "standard" },
              { size: "2048x2048", quality: "standard" },
            ],
          },
        ],
      }),
    ) as unknown as typeof fetch;
    const [models] = createImageTools({ apiKey: "test-secret", fetcher });

    const result = await models.execute({});

    expect(result.success).toBe(true);
    expect(result.output).toContain("qwen/qwen-image-2.1-turbo");
    expect(result.output).toContain("edição: true");
    expect(result.output).toContain("variantes: 1024x1024/standard, 2048x2048/standard");
    expect(fetcher).toHaveBeenCalledWith(
      "https://app.rubycli.cloud/v1/images/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer test-secret" }),
      }),
    );
  });

  it("redacts a key echoed by the provider error response", async () => {
    const secret = "ruby-secret";
    const fetcher = vi.fn(async () =>
      response({ error: { message: `Request failed for ${secret}` } }, 502),
    ) as unknown as typeof fetch;
    const [, quote] = createImageTools({ apiKey: secret, fetcher });

    const result = await quote.execute({ model: "image-model" });

    expect(result.success).toBe(false);
    expect(result.error).not.toContain(secret);
    expect(result.error).toContain("[redacted]");
  });

  it("rejects a response whose MIME type does not match its bytes", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith("/images/quote")
        ? response({ estimatedCredits: 1, minEstimatedCredits: 1, maxEstimatedCredits: 1 })
        : response({ data: [{ b64_json: imageBase64 }], media_type: "image/jpeg" }),
    ) as typeof fetch;
    const [, quote, generate] = createImageTools({ apiKey: "key", fetcher });

    await quote.execute({ model: "image-model" });
    const result = await generate.execute({ model: "image-model", prompt: "A forest" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("bytes não corresponde");
    expect(result.images).toBeUndefined();
  });
});
