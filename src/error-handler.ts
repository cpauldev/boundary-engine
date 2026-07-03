import type {
  RouteBoundaryErrorHandler,
  RouteBoundaryErrorHandlerOptions,
} from "./types";

import { sanitizeError } from "./errors";
import { errorJson } from "./responses";

export function createBoundaryErrorHandler(
  options: RouteBoundaryErrorHandlerOptions = {},
): RouteBoundaryErrorHandler {
  return async (error, context) => {
    const sanitized = sanitizeError(error, options);
    const requestUrl = new URL(context.request.url);

    options.logger?.error?.("[BoundaryEngine] Route handler failed", {
      method: context.request.method,
      url: `${requestUrl.origin}${requestUrl.pathname}`,
      error: sanitized.message,
      requestId: sanitized.requestId,
    });

    await options.onError?.(error, context);

    return errorJson(sanitized, sanitized.statusCode);
  };
}
