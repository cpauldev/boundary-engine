import type { ApiError } from "./errors";

/**
 * Configuration mapping API error codes to statuses and optional categories.
 */
export type ApiErrorCodeConfig<TCode extends string = string> = Record<
  TCode,
  {
    /** The HTTP status code (e.g. 400, 401, 403, 404, 500). */
    status: number;
    /** Descriptive categorization grouping. */
    category?: string;
  }
>;

/**
 * Constructor options for creating an ApiError instance.
 */
export type ApiErrorOptions<TCode extends string = string> = {
  /** The error code string (must match configuration keys). */
  code: TCode;
  /** Description message. */
  message: string;
  /** Explicit HTTP status code override. */
  statusCode?: number;
  /** Contextual details metadata payload. */
  details?: Record<string, unknown>;
};

/**
 * Pre-configured helpers mapped by error code to quickly construct ApiErrors.
 */
export type ErrorFactory<TCode extends string = string> = Record<
  TCode,
  (message: string, details?: Record<string, unknown>) => ApiError<TCode>
>;

/**
 * Represents the structured JSON error response returned to API consumers.
 */
export type SanitizedError<TCode extends string = string> = {
  /** High-level error classification string (e.g. 'Bad request'). */
  error: string;
  /** User-friendly error message description. */
  message?: string;
  /** Specific API error code matching the config. */
  code?: TCode;
  /** Redacted/safe contextual detail properties. */
  details?: Record<string, unknown>;
  /** HTTP response status code. */
  statusCode: number;
  /** ISO timestamp when the error occurred. */
  timestamp: string;
  /** Unique request trace/identifier. */
  requestId: string;
};

/**
 * Configurations for the error sanitization utility.
 */
export type ErrorSanitizerOptions = {
  /** If true, detailed raw error messages are masked in production mode. */
  production?: boolean;
  /** Optional custom trace identifier to append to response bodies. */
  requestId?: string;
  /** Optional callback to filter/redact nested detail property objects. */
  redact?: <T>(value: T) => T;
};

/**
 * Structure returned when request inputs fail schemas.
 */
export type ValidationErrorResponse = {
  /** High-level error category. */
  error: string;
  /** Nested arrays specifying path parameters and descriptive messages. */
  details?: Array<{
    /** JSON path where validation failed (e.g., 'body.email'). */
    path: string;
    /** Descriptive violation cause. */
    message: string;
  }>;
};

/**
 * Configurations for JSON body input validations.
 */
export type BodyValidationOptions = {
  /** Maximum size in bytes allowed for the incoming request payload. Defaults to 1MB. */
  maxBodySize?: number;
  /** If false, suppresses logging raw received inputs on failures. */
  logReceivedData?: boolean;
};

/**
 * Payload context supplied to schema-guarded route handler callbacks.
 */
export type RouteHandlerContext<TBody = unknown> = {
  /** The incoming Web Request object. */
  request: Request;
  /** The fully validated, typed JSON request body. */
  body: TBody;
};

/**
 * Duck-typed headers reader.
 */
export type HeaderReader = {
  /** Headers lookup map. */
  headers: Headers;
};

/**
 * Configurations for extracting the true client IP from proxy hops.
 */
export type ClientIpOptions = {
  /** If true, enables production proxy checking. */
  production?: boolean;
  /** If true, trusts the Cloudflare-managed CF-Connecting-IP header. Only enable when direct origin access is blocked. */
  trustCfConnectingIp?: boolean;
  /** CIDR blocks representing trusted upstream reverse proxies. */
  trustedProxyCidrs?: string[];
  /** If true, permits private subnet IPs in production checks. */
  allowPrivateInProduction?: boolean;
  /** Fallback string value when no valid IP is discovered. Defaults to 'unknown'. */
  unknownValue?: string;
  /** Fallback string value when request originated from localhost. Defaults to 'dev-localhost'. */
  devLocalhostValue?: string;
  /** Logger wrapper to report untrusted/malformed chain headers. */
  logger?: {
    warn?: (message: string, metadata?: Record<string, unknown>) => void;
  };
};

/**
 * Inputs supplied to webhook verification utility.
 */
export type WebhookSignatureOptions = {
  /** Raw webhook request body payload (Buffer, string, or Uint8Array). */
  payload: Buffer | string | Uint8Array;
  /** Raw signature header value. */
  signature: string | null | undefined;
  /** Pre-shared webhook secret key. */
  secret: string;
  /** Verification algorithm. Defaults to 'sha256'. */
  algorithm?: "sha256";
};

/**
 * Configuration options for the webhook guard middleware wrapper.
 */
export type WebhookGuardOptions = {
  /** Pre-shared webhook secret key. */
  secret: string;
  /** Signature header name. Defaults to 'webhook-signature'. */
  signatureHeader?: string;
  /** Unique ID header name. Defaults to 'webhook-id'. */
  idHeader?: string;
  /** Maximum webhook payload body size. Defaults to 1MB. */
  maxBodySize?: number;
  /** Asynchronous fail-closed replay check callback. Should return true if request is a replay. */
  replay?: (webhookId: string, signature: string) => Promise<boolean>;
};

/**
 * Result returned by the webhook guard validator.
 */
export type WebhookGuardResult =
  | {
      /** True if validation succeeded. */
      ok: true;
      /** Raw buffered body payload. */
      rawBody: Buffer;
      /** Unique webhook identifier, if header was present. */
      webhookId: string | null;
    }
  | {
      /** False if validation failed. */
      ok: false;
      /** Complete generated error Response (e.g. 401 Unauthorized, 409 Conflict). */
      response: Response;
      /** Classification explanation for the failure. */
      reason: string;
    };
