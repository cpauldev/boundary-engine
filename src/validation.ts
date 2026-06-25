import type { z } from "zod";

import { sanitizeError } from "./errors";
import type {
  BodyValidationOptions,
  RouteHandlerContext,
  ValidationErrorResponse,
} from "./types";

const DEFAULT_MAX_BODY_SIZE = 1024 * 1024;

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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
  | { ok: true; size: number }
  | { ok: false; size: number; response: Response } {
  const size =
    typeof payload === "string"
      ? Buffer.byteLength(payload, "utf8")
      : payload.byteLength;
  if (size <= maxBytes) return { ok: true, size };
  return {
    ok: false,
    size,
    response: jsonResponse(
      { error: `Request body too large. Maximum size: ${maxBytes} bytes` },
      413,
    ),
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

async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<string> {
  if (!request.body) return "";

  if (typeof request.body.getReader !== "function") {
    const text = await request.text();
    const len =
      typeof Buffer !== "undefined"
        ? Buffer.byteLength(text, "utf8")
        : new TextEncoder().encode(text).length;
    if (len > maxBytes) {
      throw new Error("Request body too large");
    }
    return text;
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error("Request body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const concat = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    concat.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(concat);
}

/**
 * Ingests and validates the JSON request body against a Zod schema.
 * Protects against Denial of Service attacks by parsing chunked streams up to a maximum byte size.
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
  | { ok: false; response: Response; receivedData?: unknown }
> {
  const contentLength = request.headers.get("content-length");
  const maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;
  if (contentLength) {
    const parsed = Number.parseInt(contentLength, 10);
    if (!Number.isFinite(parsed)) {
      return {
        ok: false,
        response: jsonResponse({ error: "Invalid Content-Length header" }, 400),
      };
    }
    if (parsed > maxBodySize) {
      return {
        ok: false,
        response: jsonResponse(
          {
            error: `Request body too large. Maximum size: ${maxBodySize} bytes`,
          },
          413,
        ),
      };
    }
  }

  let body: unknown;
  try {
    const text = await readBodyWithLimit(request, maxBodySize);
    body = JSON.parse(text);
  } catch (error) {
    if (error instanceof Error && error.message === "Request body too large") {
      return {
        ok: false,
        response: jsonResponse(
          {
            error: `Request body too large. Maximum size: ${maxBodySize} bytes`,
          },
          413,
        ),
      };
    }
    return {
      ok: false,
      response: jsonResponse(
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
      response: jsonResponse(formatZodError(result.error), 400),
      receivedData: options.logReceivedData === false ? undefined : body,
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
): { ok: true; data: z.infer<TSchema> } | { ok: false; response: Response } {
  const parsedUrl = typeof url === "string" ? new URL(url) : url;
  const params = Object.fromEntries(parsedUrl.searchParams.entries());
  const result = schema.safeParse(params);
  if (!result.success) {
    return {
      ok: false,
      response: jsonResponse(formatZodError(result.error), 400),
    };
  }
  return { ok: true, data: result.data };
}

/**
 * Creates a route-wrapping builder that validates inputs and catch/sanitizes output errors automatically.
 *
 * @returns A schema-backed handler decorator.
 */
export function createRouteHandler() {
  return {
    body:
      <TSchema extends z.ZodTypeAny>(
        schema: TSchema,
        handler: (
          context: RouteHandlerContext<z.infer<TSchema>>,
        ) => Promise<Response> | Response,
        options?: BodyValidationOptions,
      ) =>
      async (request: Request): Promise<Response> => {
        const validation = await validateJsonBody(request, schema, options);
        if (!validation.ok) return validation.response;
        try {
          return await handler({ request, body: validation.data });
        } catch (error) {
          const sanitized = sanitizeError(error, {
            production: process.env.NODE_ENV === "production",
          });
          return jsonResponse(sanitized, sanitized.statusCode);
        }
      },
  };
}
