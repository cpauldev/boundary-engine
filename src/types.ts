import type { z } from "zod";

import type { ApiError } from "./errors.js";

/** A value or a promise for that value. */
export type MaybePromise<T> = T | Promise<T>;

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
  /** If true, raw error messages and unredacted API error details are omitted. */
  production?: boolean;
  /** Optional custom trace identifier to append to response bodies. */
  requestId?: string;
  /** Optional callback to filter or redact detail properties. */
  redact?: (value: Record<string, unknown>) => Record<string, unknown>;
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
  /** If true, requires an application/json or +json Content-Type header. */
  requireJsonContentType?: boolean;
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
  /** CIDR blocks representing trusted upstream proxies. Direct origin access must also be blocked. */
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

/** Options accepted by the JSON response helper. */
export type JsonResponseOptions = {
  status?: number;
  headers?: HeadersInit;
};

/** Request-local values available to route error hooks. */
export type RouteBoundaryErrorContext<
  TContext = unknown,
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
> = {
  request: Request;
  context?: TContext;
  params?: TParams;
  query?: TQuery;
  body?: TBody;
};

/** Converts an uncaught route error into a response. */
export type RouteBoundaryErrorHandler<
  TContext = unknown,
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
> = (
  error: unknown,
  context: RouteBoundaryErrorContext<TContext, TBody, TQuery, TParams>,
) => MaybePromise<Response>;

/** Configuration for the default route error handler. */
export type RouteBoundaryErrorHandlerOptions = ErrorSanitizerOptions & {
  logger?: {
    error?: (message: string, metadata?: Record<string, unknown>) => void;
  };
  onError?: (
    error: unknown,
    context: RouteBoundaryErrorContext,
  ) => MaybePromise<void>;
};

type BoundaryContextRecord = Record<string, unknown>;

type RouteBoundaryData<TBody, TQuery, TParams, TContext> = {
  request: Request;
} & ([TBody] extends [undefined] ? object : { body: TBody }) &
  ([TQuery] extends [undefined] ? object : { query: TQuery }) &
  ([TParams] extends [undefined] ? object : { params: TParams }) & {
    context: TContext;
  };

/** Values passed to a route guard or handler. */
export type RouteBoundaryContext<
  TContext = Record<string, never>,
  TBody = undefined,
  TQuery = undefined,
  TParams = undefined,
> = RouteBoundaryData<TBody, TQuery, TParams, TContext>;

export type RouteBoundaryGuardOutcome<TAddedContext = Record<string, never>> =
  { ok: true; context: TAddedContext } | { ok: false; response: Response };

export type RouteBoundaryRequestGuard<
  TContext extends BoundaryContextRecord = Record<string, never>,
  TAddedContext extends BoundaryContextRecord = Record<string, never>,
> = (context: {
  request: Request;
  context: TContext;
}) => MaybePromise<RouteBoundaryGuardOutcome<TAddedContext>>;

export type RouteBoundaryGuard<
  TContext extends BoundaryContextRecord = Record<string, never>,
  TAddedContext extends BoundaryContextRecord = Record<string, never>,
  TBody = undefined,
  TQuery = undefined,
  TParams = undefined,
> = (
  context: RouteBoundaryContext<TContext, TBody, TQuery, TParams>,
) => MaybePromise<RouteBoundaryGuardOutcome<TAddedContext>>;

export type RouteBoundaryHandler<
  TContext extends BoundaryContextRecord = Record<string, never>,
  TBody = undefined,
  TQuery = undefined,
  TParams = undefined,
> = (
  context: RouteBoundaryContext<TContext, TBody, TQuery, TParams>,
) => MaybePromise<Response>;

export type RouteBoundaryErrorMapper<
  TContext = unknown,
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
> = (
  error: unknown,
  context: RouteBoundaryErrorContext<TContext, TBody, TQuery, TParams>,
) => MaybePromise<unknown>;

export type RouteBoundaryValidationError =
  | {
      source: "params" | "query" | "body-schema";
      error: z.ZodError;
      response: Response;
      receivedData?: unknown;
    }
  | {
      source: "body-size" | "body-json";
      response: Response;
      receivedData?: unknown;
    };

export type RouteBoundaryValidationHandler<
  TContext = unknown,
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
> = (
  error: RouteBoundaryValidationError,
  context: RouteBoundaryErrorContext<TContext, TBody, TQuery, TParams>,
) => MaybePromise<Response | void>;

export type RouteBoundaryOptions<
  TContext extends BoundaryContextRecord = Record<string, never>,
> = {
  context?: TContext | ((request: Request) => MaybePromise<TContext>);
  errorHandler?: RouteBoundaryErrorHandler<TContext>;
};

export type RouteBoundaryRequestOptions<TParams> = [TParams] extends [undefined]
  ? { params?: unknown }
  : { params: unknown };

/** Fetch handlers without validated params expose no framework context argument. */
export type RouteBoundaryFetchHandler<TParams = undefined> = [TParams] extends [
  undefined,
]
  ? (request: Request) => Promise<Response>
  : (
      request: Request,
      options: RouteBoundaryRequestOptions<TParams>,
    ) => Promise<Response>;

export interface RouteBoundaryBuilder<
  TContext extends BoundaryContextRecord = Record<string, never>,
  TBody = undefined,
  TQuery = undefined,
  TParams = undefined,
> {
  body<TSchema extends z.ZodTypeAny>(
    schema: TSchema,
    options?: BodyValidationOptions,
  ): RouteBoundaryBuilder<TContext, z.infer<TSchema>, TQuery, TParams>;
  query<TSchema extends z.ZodTypeAny>(
    schema: TSchema,
  ): RouteBoundaryBuilder<TContext, TBody, z.infer<TSchema>, TParams>;
  params<TSchema extends z.ZodTypeAny>(
    schema: TSchema,
  ): RouteBoundaryBuilder<TContext, TBody, TQuery, z.infer<TSchema>>;
  requestGuard<TAddedContext extends BoundaryContextRecord>(
    guard: RouteBoundaryRequestGuard<TContext, TAddedContext>,
  ): RouteBoundaryBuilder<TContext & TAddedContext, TBody, TQuery, TParams>;
  guard<TAddedContext extends BoundaryContextRecord>(
    guard: RouteBoundaryGuard<TContext, TAddedContext, TBody, TQuery, TParams>,
  ): RouteBoundaryBuilder<TContext & TAddedContext, TBody, TQuery, TParams>;
  onError(
    mapper: RouteBoundaryErrorMapper<TContext, TBody, TQuery, TParams>,
  ): RouteBoundaryBuilder<TContext, TBody, TQuery, TParams>;
  onValidationError(
    handler: RouteBoundaryValidationHandler<TContext, TBody, TQuery, TParams>,
  ): RouteBoundaryBuilder<TContext, TBody, TQuery, TParams>;
  handle(
    handler: RouteBoundaryHandler<TContext, TBody, TQuery, TParams>,
  ): RouteBoundaryFetchHandler<TParams>;
}
