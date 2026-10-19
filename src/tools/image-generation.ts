import { DEFAULT_BASE_URL } from "../rubycli.js";
import type { ToolImageArtifact, ToolResult } from "../providers/types.js";
import type { Tool } from "./base.js";

const MAX_PROMPT_LENGTH = 10_000;
const MAX_MODEL_LENGTH = 200;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_GENERATION_RESPONSE_BYTES = 48 * 1024 * 1024;
const QUOTE_TIMEOUT_MS = 20_000;
const GENERATION_TIMEOUT_MS = 180_000;
const IMAGE_MIME_TYPES = new Set<ToolImageArtifact["mimeType"]>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const QUOTE_CACHE_TTL_MS = 5 * 60_000;

export interface ImageGenerationToolOptions {
  apiKey: string;
  /** Defaults to RubyCLI's production API root. */
  baseUrl?: string;
  /** Injected at the network boundary for deterministic tests. */
  fetcher?: typeof fetch;
}

interface ImageRequest {
  model: string;
  size: string;
  quality: string;
  n: number;
}

interface ImageRequestResult {
  ok: boolean;
  status: number;
  payload?: Record<string, unknown>;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRequest(params: Record<string, unknown>): ImageRequest | string {
  const model = typeof params.model === "string" ? params.model.trim() : "";
  if (!model) return "Informe o id exato de um modelo de geração de imagens.";
  if (model.length > MAX_MODEL_LENGTH) return "O id do modelo é muito longo.";

  const size = typeof params.size === "string" ? params.size.trim() : "1024x1024";
  const dimensions = /^(\d{2,4})x(\d{2,4})$/.exec(size);
  if (
    !dimensions ||
    Number(dimensions[1]) < 1 ||
    Number(dimensions[2]) < 1 ||
    Number(dimensions[1]) > 4096 ||
    Number(dimensions[2]) > 4096
  ) {
    return "Tamanho inválido. Use o formato LARGURAxALTURA, com dimensões de até 4096 px.";
  }

  const quality = typeof params.quality === "string" ? params.quality.trim() : "standard";
  if (!quality || quality.length > 50) return "Qualidade inválida.";

  const n = params.n === undefined ? 1 : Number(params.n);
  if (!Number.isInteger(n) || n < 1 || n > MAX_IMAGES) {
    return `A quantidade deve ser um inteiro entre 1 e ${MAX_IMAGES}.`;
  }

  return { model, size, quality, n };
}

function responseError(
  payload: Record<string, unknown> | undefined,
  apiKey: string,
): string | undefined {
  const raw = payload?.error;
  const message = isRecord(raw) ? raw.message : raw;
  return typeof message === "string"
    ? (apiKey ? message.replaceAll(apiKey, "[redacted]") : message).slice(0, 400)
    : undefined;
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new Error("A resposta da API excedeu o limite de tamanho permitido.");
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error("A resposta da API excedeu o limite de tamanho permitido.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function postJson(
  options: ImageGenerationToolOptions,
  route: "quote" | "generations",
  body: Record<string, unknown>,
): Promise<ImageRequestResult> {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    route === "quote" ? QUOTE_TIMEOUT_MS : GENERATION_TIMEOUT_MS,
  );
  try {
    const response = await fetcher(`${baseUrl}/images/${route}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await readCapped(
      response,
      route === "quote" ? 256 * 1024 : MAX_GENERATION_RESPONSE_BYTES,
    );
    let payload: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed)) payload = parsed;
    } catch {
      // A bounded, non-JSON error response still maps to a useful status message.
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: responseError(payload, options.apiKey),
      };
    }
    if (!payload) {
      return { ok: false, status: response.status, error: "A API retornou JSON inválido." };
    }
    return { ok: true, status: response.status, payload };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? route === "quote"
          ? "A estimativa de créditos excedeu o tempo limite."
          : "A geração excedeu o tempo limite; verifique a conversa antes de repetir para evitar uma cobrança duplicada."
        : error instanceof Error
          ? error.message
          : String(error);
    return { ok: false, status: 0, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

async function getImageModels(options: ImageGenerationToolOptions): Promise<ImageRequestResult> {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS);
  try {
    const response = await fetcher(`${baseUrl}/images/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    const raw = await readCapped(response, 256 * 1024);
    let payload: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed)) payload = parsed;
    } catch {
      // A bounded, non-JSON error response still maps to a useful status message.
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: responseError(payload, options.apiKey),
      };
    }
    if (!payload) {
      return { ok: false, status: response.status, error: "A API retornou JSON inválido." };
    }
    return { ok: true, status: response.status, payload };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "A consulta dos modelos de imagem excedeu o tempo limite."
        : error instanceof Error
          ? error.message
          : String(error);
    return { ok: false, status: 0, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

function failure(result: ImageRequestResult, route: string): ToolResult {
  if (result.status === 401 || result.status === 403) {
    return {
      success: false,
      output: "",
      error: `A API Ruby recusou a solicitação de ${route} (HTTP ${result.status}); confira a chave, o acesso ao modelo e os créditos da conta.`,
    };
  }
  return {
    success: false,
    output: "",
    error:
      result.error ??
      (result.status
        ? `A solicitação de ${route} falhou (HTTP ${result.status}).`
        : `Não foi possível concluir ${route}.`),
  };
}

function numericField(payload: Record<string, unknown>, key: string): number | undefined {
  const aliases: Record<string, string[]> = {
    estimatedCredits: ["estimatedCredits", "estimated_credits"],
    minEstimatedCredits: ["minEstimatedCredits", "min_estimated_credits"],
    maxEstimatedCredits: ["maxEstimatedCredits", "max_estimated_credits"],
  };
  const names = aliases[key] ?? [key];
  const queue: Array<{ value: Record<string, unknown>; depth: number }> = [
    { value: payload, depth: 0 },
  ];
  const seen = new Set<object>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current.value)) continue;
    seen.add(current.value);
    for (const name of names) {
      const raw = current.value[name];
      const parsed =
        typeof raw === "number"
          ? raw
          : typeof raw === "string" && raw.trim()
            ? Number(raw)
            : Number.NaN;
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    if (current.depth >= 5) continue;
    for (const value of Object.values(current.value)) {
      if (isRecord(value)) queue.push({ value, depth: current.depth + 1 });
    }
  }
  return undefined;
}

function numericValue(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function imageModelsData(payload: Record<string, unknown>): unknown[] | undefined {
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.models)) return payload.models;
  if (isRecord(payload.data)) {
    if (Array.isArray(payload.data.models)) return payload.data.models;
    if (Array.isArray(payload.data.data)) return payload.data.data;
  }
  return undefined;
}

function imageModelSummary(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return `- ${value.trim().slice(0, 200)}`;
  if (!isRecord(value)) return undefined;

  const id = [value.id, value.model, value.model_id, value.modelId, value.slug].find(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  if (!id) return undefined;

  const fields = [
    ["nome", value.name ?? value.display_name ?? value.displayName ?? value.label],
    ["descrição", value.description],
    ["provider", value.provider ?? value.owned_by],
    ["recomendado", value.recommended],
    ["padrão", value.default],
    ["tamanhos", value.sizes ?? value.supported_sizes ?? value.supportedSizes],
    ["qualidades", value.qualities ?? value.supported_qualities ?? value.supportedQualities],
    ["edição", value.supports_edit ?? value.supportsEdit ?? value.editable],
    ["variantes", value.variants ?? value.configured_variants ?? value.configuredVariants],
  ] as const;
  const details = fields.flatMap(([label, raw]) => {
    if (typeof raw === "string" && raw.trim()) return [`${label}: ${raw.trim().slice(0, 300)}`];
    if (typeof raw === "number" || typeof raw === "boolean") return [`${label}: ${raw}`];
    if (
      Array.isArray(raw) &&
      raw.length <= 16 &&
      raw.every((item) => typeof item === "string" || typeof item === "number")
    ) {
      return [`${label}: ${raw.join(", ").slice(0, 300)}`];
    }
    if (label === "variantes" && Array.isArray(raw)) {
      const entries = raw.flatMap((item) => {
        if (!isRecord(item)) return [];
        const parts = [
          item.size,
          item.quality,
          item.resolution,
          item.aspect_ratio ?? item.aspectRatio,
        ].filter(
          (part): part is string | number => typeof part === "string" || typeof part === "number",
        );
        return parts.length ? [parts.join("/")] : [];
      });
      if (entries.length) return [`${label}: ${entries.slice(0, 8).join(", ").slice(0, 300)}`];
    }
    return [];
  });
  return `- ${id.trim().slice(0, 200)}${details.length ? ` — ${details.join("; ")}` : ""}`;
}

function matchesImageSignature(
  bytes: Uint8Array,
  mimeType: ToolImageArtifact["mimeType"],
): boolean {
  if (mimeType === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (mimeType === "image/jpeg")
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  );
}

const imageParameters = {
  type: "object",
  properties: {
    model: {
      type: "string",
      description: "Id exato do modelo Ruby habilitado para geração de imagens.",
    },
    size: {
      type: "string",
      description: "Tamanho no formato LARGURAxALTURA. Padrão: 1024x1024.",
    },
    quality: {
      type: "string",
      description: "Qualidade aceita pelo modelo. Padrão: standard.",
    },
    n: {
      type: "integer",
      description: `Quantidade de imagens, de 1 a ${MAX_IMAGES}. Padrão: 1.`,
    },
  },
  required: ["model"],
};

export function createImageTools(options: ImageGenerationToolOptions): Tool[] {
  const quotes = new Map<string, { expiresAt: number; output: string }>();
  const quoteKey = (request: ImageRequest): string =>
    JSON.stringify([request.model, request.size, request.quality, request.n]);

  const modelsTool: Tool = {
    name: "image_models",
    readonly: true,
    description:
      "List the image-generation models enabled for this Ruby account from GET /v1/images/models. Use this when the user asks to list image models or when no exact image model id has been provided. Do not search project files or use the chat model catalog for this.",
    parameters: { type: "object", properties: {} },
    async execute() {
      const result = await getImageModels(options);
      if (!result.ok || !result.payload) return failure(result, "listagem de modelos de imagem");
      const models = imageModelsData(result.payload);
      if (!models) {
        return {
          success: false,
          output: "",
          error: "A API não retornou a lista de modelos de imagem esperada em data ou models.",
        };
      }
      const summaries = models
        .map(imageModelSummary)
        .filter((item): item is string => Boolean(item));
      if (summaries.length === 0) {
        return {
          success: true,
          output:
            "A API Ruby não retornou modelos de geração de imagem disponíveis para esta conta.",
        };
      }
      const shown = summaries.slice(0, 100);
      return {
        success: true,
        output: [
          `Modelos de geração de imagem habilitados na conta (${summaries.length}):`,
          ...shown,
          ...(summaries.length > shown.length
            ? [`… mais ${summaries.length - shown.length} modelo(s) omitido(s).`]
            : []),
          "Use um id exatamente como listado ao cotar em image_quote.",
        ].join("\n"),
      };
    },
  };

  const quoteTool: Tool = {
    name: "image_quote",
    readonly: true,
    description:
      "Estimate Ruby image-generation credits without generating or charging for an image. Call this before image_generate, using the exact model, size, quality and count. Show the estimatedCredits and minEstimatedCredits–maxEstimatedCredits range to the user before continuing.",
    parameters: imageParameters,
    async execute(params) {
      const request = normalizeRequest(params);
      if (typeof request === "string") {
        return { success: false, output: "", error: request };
      }
      const result = await postJson(options, "quote", { ...request, referenceCount: 0 });
      if (!result.ok || !result.payload) return failure(result, "estimativa");

      const estimated = numericField(result.payload, "estimatedCredits");
      const minimum = numericField(result.payload, "minEstimatedCredits");
      const maximum = numericField(result.payload, "maxEstimatedCredits");
      if (estimated === undefined) {
        return {
          success: false,
          output: "",
          error:
            "A API não retornou estimatedCredits para esta combinação de modelo e parâmetros, mesmo com referenceCount=0. Confira o formato da resposta do endpoint /images/quote.",
        };
      }
      const output = [
        `Estimativa para ${request.model} (${request.size}, ${request.quality}, ${request.n} imagem(ns)):`,
        `Rota principal: ${estimated} créditos.`,
        minimum !== undefined && maximum !== undefined
          ? `Faixa entre rotas ativas: ${minimum}–${maximum} créditos.`
          : "A API não informou a faixa entre rotas ativas.",
        "Esta é uma estimativa; a cobrança final depende da rota utilizada.",
      ].join("\n");
      quotes.set(quoteKey(request), {
        expiresAt: Date.now() + QUOTE_CACHE_TTL_MS,
        output,
      });
      while (quotes.size > 32) {
        const oldest = quotes.keys().next().value;
        if (oldest === undefined) break;
        quotes.delete(oldest);
      }
      return {
        success: true,
        output,
      };
    },
  };

  const generateTool: Tool = {
    name: "image_generate",
    description:
      "Generate one or more images through the Ruby image API. Always call image_quote first and surface its estimate. Supports optional resolution (1K/2K) and aspect_ratio (for example 16:9), which are forwarded to the image model but do not change the Ruby quote variant. Requires explicit user approval because generation spends credits. Returns a concise text result to the model and image bytes separately for display/download in the chat; never put base64 in the prompt or tool output.",
    parameters: {
      ...imageParameters,
      properties: {
        ...imageParameters.properties,
        prompt: {
          type: "string",
          description: "Detailed visual description of the image to generate.",
        },
        resolution: {
          type: "string",
          description: "Optional provider resolution such as 1K or 2K.",
        },
        aspect_ratio: {
          type: "string",
          description: "Optional provider aspect ratio such as 16:9 or 1:1.",
        },
      },
      required: ["model", "prompt"],
    },
    requiresConfirmation: () => true,
    async execute(params) {
      const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
      if (!prompt) return { success: false, output: "", error: "Descreva a imagem no prompt." };
      if (prompt.length > MAX_PROMPT_LENGTH) {
        return {
          success: false,
          output: "",
          error: `O prompt excede o limite de ${MAX_PROMPT_LENGTH} caracteres.`,
        };
      }
      const request = normalizeRequest(params);
      if (typeof request === "string") {
        return { success: false, output: "", error: request };
      }
      const quote = quotes.get(quoteKey(request));
      if (!quote || quote.expiresAt < Date.now()) {
        quotes.delete(quoteKey(request));
        return {
          success: false,
          output: "",
          error:
            "Antes de gerar, chame image_quote com o mesmo modelo, tamanho, qualidade e quantidade; mostre a estimativa ao usuário.",
        };
      }

      const resolution = typeof params.resolution === "string" ? params.resolution.trim() : "";
      const aspectRatio = typeof params.aspect_ratio === "string" ? params.aspect_ratio.trim() : "";
      if (resolution && resolution.length > 40) {
        return { success: false, output: "", error: "A resolução é inválida." };
      }
      if (aspectRatio && !/^\d{1,3}:\d{1,3}$/.test(aspectRatio)) {
        return {
          success: false,
          output: "",
          error: "A proporção deve estar no formato largura:altura, por exemplo 16:9.",
        };
      }
      const result = await postJson(options, "generations", {
        ...request,
        prompt,
        ...(resolution ? { resolution } : {}),
        ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
      });
      if (!result.ok || !result.payload) return failure(result, "geração de imagem");
      if (!Array.isArray(result.payload.data)) {
        return {
          success: false,
          output: "",
          error: "A API não retornou a lista de imagens esperada.",
        };
      }

      const images: ToolImageArtifact[] = [];
      const usage = isRecord(result.payload.usage) ? result.payload.usage : undefined;
      const actualCredits = numericValue(usage?.credits);
      const responseMime =
        result.payload.media_type ?? result.payload.mime_type ?? result.payload.mimeType;
      let totalBytes = 0;
      for (const [index, value] of result.payload.data.entries()) {
        if (!isRecord(value)) continue;
        const base64 =
          typeof value.b64_json === "string"
            ? value.b64_json
            : typeof value.base64 === "string"
              ? value.base64
              : "";
        const rawMime = value.media_type ?? value.mime_type ?? value.mimeType ?? responseMime;
        const mimeType =
          typeof rawMime === "string" &&
          IMAGE_MIME_TYPES.has(rawMime as ToolImageArtifact["mimeType"])
            ? (rawMime as ToolImageArtifact["mimeType"])
            : rawMime === undefined
              ? "image/png"
              : undefined;
        if (
          !mimeType ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
        ) {
          return {
            success: false,
            output: "",
            error: "A API retornou uma imagem com formato ou base64 inválido.",
          };
        }
        const bytes = Buffer.from(base64, "base64");
        if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
          return {
            success: false,
            output: "",
            error: "A API retornou uma imagem vazia ou acima do limite de 12 MB por imagem.",
          };
        }
        if (!matchesImageSignature(bytes, mimeType)) {
          return {
            success: false,
            output: "",
            error: "O formato real dos bytes não corresponde ao tipo de imagem informado pela API.",
          };
        }
        totalBytes += bytes.length;
        if (totalBytes > MAX_TOTAL_IMAGE_BYTES || images.length >= request.n) {
          return {
            success: false,
            output: "",
            error: "A resposta excedeu o limite de quantidade ou tamanho das imagens.",
          };
        }
        images.push({
          mimeType,
          base64,
          alt: `Imagem gerada ${index + 1}`,
        });
      }
      if (images.length === 0) {
        return {
          success: false,
          output: "",
          error: "A API não retornou dados base64 para nenhuma imagem.",
        };
      }

      return {
        success: true,
        output: [
          `${images.length} imagem(ns) gerada(s) com ${request.model}.`,
          quote.output,
          ...(actualCredits !== undefined
            ? [`Consumo informado pela API: ${actualCredits} RU.`]
            : []),
          "As imagens foram retornadas ao host para exibição.",
        ].join("\n"),
        images,
      };
    },
  };

  return [modelsTool, quoteTool, generateTool];
}
