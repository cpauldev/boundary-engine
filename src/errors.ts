import type {
  ApiErrorCodeConfig,
  ApiErrorOptions,
  ErrorFactory,
  ErrorSanitizerOptions,
  SanitizedError,
} from "./types";

/**
 * A custom Error class representing an API-specific exception with error code,
 * HTTP status code, and structured detail properties.
 */
export class ApiError<TCode extends string = string> extends Error {
  readonly code: TCode;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  /**
   * Initializes a new instance of the ApiError.
   *
   * @param options Configuration options specifying the code, message, and details.
   */
  constructor(options: ApiErrorOptions<TCode>) {
    super(options.message);
    this.name = "ApiError";
    this.code = options.code;
    this.statusCode = options.statusCode ?? 500;
    this.details = options.details;
  }
}

/**
 * Creates a pre-configured dictionary of error-generation helpers mapped by code.
 *
 * @param config A configuration mapping API error codes to statuses and categories.
 * @returns A factory object.
 */
export function createErrorFactory<TCode extends string>(
  config: ApiErrorCodeConfig<TCode>,
): ErrorFactory<TCode> {
  const factory = {} as ErrorFactory<TCode>;
  for (const [code, value] of Object.entries(config) as Array<
    [TCode, { status: number }]
  >) {
    factory[code] = (message, details) =>
      new ApiError({ code, message, statusCode: value.status, details });
  }
  return factory;
}

/**
 * Retrieves the default HTTP status code configured for a specific API error code.
 *
 * @param config The error code configuration.
 * @param code The target error code to look up.
 * @returns The associated HTTP status code, defaulting to 500.
 */
export function getDefaultStatusCode<TCode extends string>(
  config: ApiErrorCodeConfig<TCode>,
  code: TCode,
): number {
  return config[code]?.status ?? 500;
}

const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /api[_-]?key/i,
  /api\s+key/i,
  /token/i,
  /credential/i,
  /authorization/i,
  /session[_-]?id/i,
];

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 15)}`;
}

function messageForStatus(status: number): { error: string; message: string } {
  if (status === 400)
    return { error: "Bad request", message: "Invalid request" };
  if (status === 401)
    return { error: "Unauthorized", message: "Authentication required" };
  if (status === 403) return { error: "Forbidden", message: "Access denied" };
  if (status === 404)
    return { error: "Not found", message: "Resource not found" };
  if (status === 429)
    return {
      error: "Too many requests",
      message: "Rate limit exceeded. Please try again later.",
    };
  return {
    error: "Internal server error",
    message: "An unexpected error occurred. Please try again later.",
  };
}

function containsSensitiveInfo(message: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Sanitizes an unknown error caught in route logic into a standard response shape.
 * Automatically redacts sensitive information (like API keys or passwords) and
 * hides raw messages in production configurations.
 *
 * @param error The raw error object to sanitize.
 * @param options Sanitization options including environments, request IDs, and redaction callbacks.
 * @returns A sanitized error object.
 */
export function sanitizeError<TCode extends string = string>(
  error: unknown,
  options: ErrorSanitizerOptions = {},
): SanitizedError<TCode> {
  const requestId = options.requestId ?? generateRequestId();
  const timestamp = new Date().toISOString();
  const isApiError = error instanceof ApiError;
  const statusCode = isApiError ? error.statusCode : 500;
  const fallback = messageForStatus(statusCode);
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : fallback.message;
  const safeMessage =
    containsSensitiveInfo(rawMessage) || options.production
      ? fallback.message
      : rawMessage;
  const sanitized: SanitizedError<TCode> = {
    error: fallback.error,
    message: safeMessage,
    statusCode,
    timestamp,
    requestId,
  };

  if (isApiError) {
    sanitized.code = error.code as TCode;
    sanitized.details = options.redact
      ? options.redact(error.details)
      : error.details;
  }

  return sanitized;
}
