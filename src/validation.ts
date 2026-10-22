import type { z } from "zod";

import type {
  BodyValidationOptions,
  ValidationErrorResponse,
} from "./types.js";

import {
  BodyTooLargeError,
  bodyTooLargeResponse,
  DEFAULT_MAX_BODY_SIZE,
  readRequestBodyWithLimit,
} from "./body-reader.js";
import { errorJson } from "./responses.js";

/**
 * Checks if a raw payload size exceeds a specific byte limit.
 *
 * @param payload The raw payload to measure.
 * @param maxBytes Maximum allowed size in bytes (defaults to 1MB).
 * @returns An object indicating size-validation success, including a pre-built response if invalid.
 */
export function validatePayloadSize(
  payload: Buffer | string | Uint8Array,
  maxBytes = DEFAULT_MAX_BODY_SIZE,
):
  { ok: true; size: number } | { ok: false; size: number; response: Response } {
  const size =
    typeof payload === "string"
      ? Buffer.byteLength(payload, "utf8")
      : payload.byteLength;
  if (size <= maxBytes) return { ok: true, size };
  return {
    ok: false,
    size,
    response: bodyTooLargeResponse(maxBytes),
  };
}

/**
 * Formats a raw Zod error issue list into a structured validation error response.
 *
 * @param error The ZodError to parse.
 * @returns A structured validation error response.
 */
export function formatZodError(error: z.ZodError): ValidationErrorResponse {
  return {
    error: "Validation failed",
    details: error.issues.map((issue) => ({
      path: issue.path.join(".") || "root",
      message: issue.message,
    })),
  };
}

/**
 * Ingests and validates the JSON request body against a Zod schema.
 * Bounds buffered request data by stopping the stream once the configured
 * byte limit is exceeded.
 *
 * @param request The request context.
 * @param schema The target Zod schema.
 * @param options Configurations for body size limit.
 * @returns Validated typed data, or a size/parse error response.
 */
export async function validateJsonBody<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
  options: BodyValidationOptions = {},
): Promise<
  | { ok: true; data: z.infer<TSchema> }
  | {
      ok: false;
      response: Response;
      receivedData?: unknown;
      reason: "body-size" | "body-json" | "body-schema";
      error?: z.ZodError;
    }
> {
  const contentLength = request.headers.get("content-length");
  const maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;
  if (options.requireJsonContentType) {
    const contentType = request.headers.get("content-type");
    const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
    if (
      !mediaType ||
      (mediaType !== "application/json" && !mediaType.endsWith("+json"))
    ) {
      return {
        ok: false,
        reason: "body-json",
        response: errorJson({ error: "Expected a JSON request body" }, 415),
      };
    }
  }
  if (contentLength) {
    const normalized = contentLength.trim();
    const parsed = Number(normalized);
    if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(parsed)) {
      return {
        ok: false,
        reason: "body-size",
        response: errorJson({ error: "Invalid Content-Length header" }, 400),
      };
    }
    if (parsed > maxBodySize) {
      return {
        ok: false,
        reason: "body-size",
        response: bodyTooLargeResponse(maxBodySize),
      };
    }
  }

  let body: unknown;
  try {
    const bytes = await readRequestBodyWithLimit(request, maxBodySize);
    const text = new TextDecoder().decode(bytes);
    body = JSON.parse(text);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return {
        ok: false,
        reason: "body-size",
        response: bodyTooLargeResponse(maxBodySize),
      };
    }
    return {
      ok: false,
      reason: "body-json",
      response: errorJson(
        {
          error:
            error instanceof SyntaxError
              ? "Invalid JSON in request body"
              : "Failed to parse request body",
          details:
            error instanceof Error
              ? [{ path: "body", message: error.message }]
              : undefined,
        } satisfies ValidationErrorResponse,
        400,
      ),
    };
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      ok: false,
      reason: "body-schema",
      response: errorJson(formatZodError(result.error), 400),
      receivedData: options.logReceivedData === false ? undefined : body,
      error: result.error,
    };
  }

  return { ok: true, data: result.data };
}

/**
 * Validates request URL query parameters against a Zod schema.
 *
 * @param schema The target Zod schema.
 * @param url The URL context.
 * @returns Validated typed query parameters, or a schema error response.
 */
export function validateQueryParams<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  url: URL | string,
):
  | { ok: true; data: z.infer<TSchema> }
  | {
      ok: false;
      response: Response;
      error: z.ZodError;
      receivedData: Record<string, string | string[]>;
    } {
  const parsedUrl = typeof url === "string" ? new URL(url) : url;
  const params: Record<string, string | string[]> = {};
  for (const key of new Set(parsedUrl.searchParams.keys())) {
    const values = parsedUrl.searchParams.getAll(key);
    params[key] = values.length === 1 ? (values[0] ?? "") : values;
  }
  const result = schema.safeParse(params);
  if (!result.success) {
    return {
      ok: false,
      response: errorJson(formatZodError(result.error), 400),
      error: result.error,
      receivedData: params,
    };
  }
  return { ok: true, data: result.data };
}
