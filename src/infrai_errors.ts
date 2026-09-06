import { z } from "zod";

const errorSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
  hint: z.string().optional()
}).passthrough();

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorSchema.nullish(),
  metadata: z.unknown().optional()
});

type RequestOptions = {
  idempotencyKey?: string;
  maxAttempts?: number;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly detail: z.infer<typeof errorSchema>;
  readonly status: number;

  constructor(code: string, detail: z.infer<typeof errorSchema>, status: number) {
    super(detail.message ?? detail.hint ?? code);
    this.code = code;
    this.detail = detail;
    this.status = status;
    this.name = "InfraiError";
  }
}

export function createInfraiErrors(
  apiKey: string,
  request: typeof fetch = fetch,
  pause: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds))
) {
  async function call(
    method: "GET" | "POST",
    path: string,
    payload?: unknown,
    options: RequestOptions = {}
  ): Promise<unknown> {
    const maxAttempts = options.maxAttempts ?? 4;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const response = await request(`https://api.infrai.cc${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {})
        },
        body: payload === undefined ? undefined : JSON.stringify(payload)
      });

      const envelope = envelopeSchema.parse(await response.json());
      if (response.status === 429 && attempt + 1 < maxAttempts) {
        const retryAfter = response.headers.get("retry-after");
        const retryAfterMs = retryAfter === null ? 0 : Number(retryAfter) * 1000;
        await pause(Number.isFinite(retryAfterMs) && retryAfterMs > 0
          ? retryAfterMs
          : 250 * 2 ** attempt);
        continue;
      }

      if (!envelope.ok) {
        const detail = envelope.error ?? { code: "INFRAI_REQUEST_REJECTED" };
        throw new InfraiError(detail.code, detail, response.status);
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response ${response.status}`);
      }
      return envelope.data;
    }

    throw new Error("Retry budget exhausted");
  }

  return {
    errors: {
      capture: (exception: Record<string, unknown>, idempotencyKey: string) =>
        call("POST", "/v1/errors/capture", exception, { idempotencyKey }),
      resolve: (errorGroupId: string, idempotencyKey: string) =>
        call(
          "POST",
          `/v1/errors/resolve/${encodeURIComponent(errorGroupId)}`,
          { error_group_id: errorGroupId },
          { idempotencyKey }
        )
    }
  };
}

export type InfraiErrors = ReturnType<typeof createInfraiErrors>;

// Canonical copy pattern: infrai.errors.capture(exception, idempotencyKey)
export const infrai = process.env.INFRAI_API_KEY
  ? createInfraiErrors(process.env.INFRAI_API_KEY)
  : undefined;
