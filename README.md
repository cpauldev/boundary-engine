<img src="https://raw.githubusercontent.com/cpauldev/boundary-engine/main/banner.webp" alt="BoundaryEngine Banner" width="100%" />

# BoundaryEngine: Secure HTTP Boundaries for TypeScript

![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white) ![Validation](https://img.shields.io/badge/-Validation-2563EB?style=flat-square) ![Webhooks](https://img.shields.io/badge/-Webhook_Guards-059669?style=flat-square) ![Zod](https://img.shields.io/badge/-Zod-3068B7?style=flat-square) ![License](https://img.shields.io/badge/-MIT_License-blue?style=flat-square) [![Changelog](https://img.shields.io/badge/Changelog-v1.0.0-blue?style=flat-square)](./CHANGELOG.md)

BoundaryEngine is a Fetch-first TypeScript toolkit for the repetitive security work around HTTP routes: body-size limits, JSON parsing, Zod validation, typed errors, sanitized responses, webhook signatures, replay hooks, and client IP extraction.

It is designed for developers building Fetch-compatible APIs on Node.js, Next.js route handlers, serverless functions, webhook receivers, and internal services. Use it when your route code is filling up with defensive plumbing that should be consistent, tested, and framework-light.

#### 🤖 Ask your coding assistant

> "Audit my codebase to see if adding the `boundary-engine` package on npm is beneficial. If so, explain why and draft an integration plan identifying body validation, query validation, error mapping, webhook verification, and client IP extraction points using the package README and source code."

---

## Why use BoundaryEngine?

| Feature                 | Without BoundaryEngine                                        | With **BoundaryEngine**                                                                                   |
| :---------------------- | :------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------- |
| **Request Parsing**     | Every route repeats JSON parsing and malformed-body handling. | 📦 **Request Parsing.** `validateJsonBody()` handles size, parse, and schema failures.                    |
| **Query Validation**    | Routes manually convert `URLSearchParams` into objects.       | 🔍 **Query Validation.** `validateQueryParams()` returns typed data or a safe response.                   |
| **Error Sanitization**  | Production/dev sanitization is often inconsistent.            | 🛡️ **Error Sanitization.** `sanitizeError()` maps typed and unknown errors safely.                        |
| **Webhook Protection**  | HMAC checks and replay protection are easy to get wrong.      | ⚓ **Webhook Protection.** `createWebhookGuard()` centralizes signature verification and replay hooks.    |
| **Client IP Resolving** | Proxy headers require careful trust-boundary handling.        | 🌐 **Client IP Resolving.** `getClientIp()` supports trusted IPv4/IPv6 proxy CIDRs and fallback behavior. |

---

## Installation

`zod` is a peer dependency so your app controls the schema version.

Install BoundaryEngine via your preferred package manager:

```bash
# npm
npm install boundary-engine zod

# pnpm
pnpm add boundary-engine zod

# bun
bun add boundary-engine zod

# yarn
yarn add boundary-engine zod
```

---

## Quick Start

```ts
import { createRouteBoundary, json } from "boundary-engine";
import { z } from "zod";

export const POST = createRouteBoundary()
  .body(
    z.object({
      email: z.string().email(),
    }),
  )
  .handle(async ({ body }) => {
    return json({ ok: true, email: body.email });
  });
```

Use `createRouteBoundary()` for validation, guards, context enrichment, and
sanitized error handling in one route boundary.

---

## Practical Examples

### Validate JSON bodies

```ts
import { validateJsonBody } from "boundary-engine";
import { z } from "zod";

const result = await validateJsonBody(
  request,
  z.object({ name: z.string().min(1) }),
  { maxBodySize: 64 * 1024 },
);

if (!result.ok) return result.response;

const name = result.data.name;
```

### Validate query parameters

```ts
import { validateQueryParams } from "boundary-engine";
import { z } from "zod";

const result = validateQueryParams(
  z.object({
    page: z.coerce.number().int().min(1).default(1),
  }),
  new URL(request.url),
);

if (!result.ok) return result.response;
```

### Compose route boundaries

```ts
import {
  ApiError,
  createRouteBoundary,
  errorJson,
  json,
} from "boundary-engine";
import { z } from "zod";

const requireUser = async () => {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false as const,
      response: errorJson({ error: "Unauthorized" }, 401),
    };
  }
  return { ok: true as const, context: { user } };
};

export const POST = createRouteBoundary()
  .requestGuard(requireUser)
  .params(z.object({ id: z.string().min(1) }))
  .query(z.object({ preview: z.coerce.boolean().default(false) }))
  .body(
    z.object({
      name: z.string().min(1),
      csrfToken: z.string().min(1),
    }),
  )
  .guard(async ({ body, context }) => {
    await verifyCsrf(context.user.id, body.csrfToken);
    return { ok: true as const, context: {} };
  })
  .onError((error) => {
    if (error instanceof Error && error.message === "Duplicate name") {
      return new ApiError({
        code: "DUPLICATE_NAME",
        message: "Name already exists",
        statusCode: 400,
      });
    }
    return error;
  })
  .handle(async ({ body, query, params, context }) => {
    return json({
      id: params.id,
      preview: query.preview,
      name: body.name,
      userId: context.user.id,
    });
  });
```

Route boundaries are Fetch-first. Frameworks like Next.js can return standard
`Response` objects from route handlers, so no framework dependency is required.

Boundary execution is deterministic: initial context, request guards, params,
query, body, post-validation guards, handler, then error mapping. Use
`.requestGuard()` for authentication and rate limiting that must happen before
request parsing. Use `.guard()` for checks that need validated inputs, such as
CSRF or tenant-resource authorization.

Builders are immutable and safe to reuse at module scope. Every chain method
returns a new builder. Guards and adapters must keep request-derived state in
the supplied context rather than mutable module or closure variables.

For framework route modules, prefer exporting the compiled handler directly so
the endpoint configuration and business logic read as one block. Introduce a
named boundary or handler constant only when that exact configuration is reused.

Repeated query keys are passed to schemas as arrays; single values remain
strings. Body validation remains content-type permissive by default. Set
`requireJsonContentType: true` in `.body(schema, options)` to require
`application/json` or a `+json` media type.

### Observe validation failures

```ts
const route = createRouteBoundary()
  .body(schema)
  .onValidationError(async (failure, { request, context }) => {
    await auditInvalidRequest({
      source: failure.source,
      method: request.method,
      actor: context,
    });
    // Return a Response here to replace the default validation response.
  })
  .handle(handleRequest);
```

Validation sources are `params`, `query`, `body-size`, `body-json`, and
`body-schema`. Error handlers and local `.onError()` mappers receive the
request-local context, parsed inputs that were available when the error
occurred, and the original request.

### Suggested application structure

Keep BoundaryEngine framework-independent and place application concerns in one
small server-only adapter module. For a small or medium-sized Next.js
application, a practical structure is:

```text
src/
  lib/
    api/
      route-boundaries.server.ts
  app/
    api/
      account/
        route.ts
      users/
        [id]/
          route.ts
```

`route-boundaries.server.ts` can own the integrations that are specific to the
application:

```ts
import { createRouteBoundary } from "boundary-engine";

export function createPublicRouteBoundary(policy, contextLabel) {
  return createRouteBoundary({
    errorHandler: createApplicationErrorHandler(contextLabel),
  }).requestGuard(async ({ request }) => {
    const client = resolveClient(request);
    const decision = await enforceRateLimit(policy, client);

    return decision.allowed
      ? { ok: true, context: client }
      : { ok: false, response: rateLimitResponse(decision) };
  });
}

export function createUserRouteBoundary(policy, contextLabel) {
  return createRouteBoundary({
    errorHandler: createApplicationErrorHandler(contextLabel),
  }).requestGuard(async ({ request }) => {
    const user = await authenticateUser(request);
    const decision = await enforceRateLimit(policy, { userId: user.id });

    return decision.allowed
      ? { ok: true, context: { user } }
      : { ok: false, response: rateLimitResponse(decision) };
  });
}
```

Keep authentication, rate-limit policies, CSRF storage, audit destinations, and
framework signature adaptation in this application-owned module. Keep schemas,
endpoint-specific error mapping, and business logic beside each route. Prefer
direct endpoint exports so a route reads from policy through handler without
jumping between declarations:

```ts
export const POST = createUserRouteBoundary(
  "account.update",
  "Updating account",
)
  .body(UpdateAccountSchema)
  .onError(mapAccountError)
  .handle(async ({ body, context }) => {
    const account = await updateAccount(context.user.id, body);
    return json(account);
  });
```

One adapter file is usually easier to discover while the integration remains
small. Split it by public, user, or admin trust boundary only when its size,
dependency graph, or ownership makes those modules independently useful. Avoid
barrel files and wrappers that only rename `createRouteBoundary()` without
adding application behavior.

### Next.js async route params

BoundaryEngine stays framework-independent. Resolve Next.js route params in a
small application adapter and wrap the complete boundary declaration:

```ts
export const PATCH = withNextRouteParams(
  createRouteBoundary()
    .params(ParamsSchema)
    .body(InputSchema)
    .handle(async ({ params, body }) => {
      return json({ id: params.id, name: body.name });
    }),
);
```

### Custom boundary error handling

```ts
import {
  createBoundaryErrorHandler,
  createRouteBoundary,
} from "boundary-engine";

const route = createRouteBoundary({
  errorHandler: createBoundaryErrorHandler({
    production: process.env.NODE_ENV === "production",
    redact: redactSensitiveData,
    logger: console,
    onError: async (error, { request }) => {
      await reportError({ error, url: request.url });
    },
  }),
});
```

### Create typed errors

```ts
import { ApiError, sanitizeError } from "boundary-engine";

throw new ApiError({
  code: "USER_NOT_FOUND",
  message: "User not found",
  statusCode: 404,
});

const safe = sanitizeError(error, {
  production: process.env.NODE_ENV === "production",
});
```

### Guard webhooks

```ts
import { createWebhookGuard } from "boundary-engine";

const guard = createWebhookGuard({
  secret: process.env.WEBHOOK_SECRET!,
  replay: async (webhookId, signature) => {
    const key = `webhook:${webhookId}`;
    const stored = await redis.set(key, signature, {
      ex: 24 * 60 * 60,
      nx: true,
    });
    return stored === null; // The ID was already claimed.
  },
});

const result = await guard(request);

if (!result.ok) return result.response;
```

The guard verifies a hexadecimal HMAC-SHA256 signature over the raw body and
fails closed when a replay hook is configured but its identifier is missing or
the replay store throws. The signature may be a bare digest or a
comma-delimited header containing `v1=<digest>`. Providers that sign a
timestamp-prefixed or otherwise transformed value require you to verify that
provider-specific signed payload directly with `verifyWebhookSignature()`.

Claim replay IDs atomically in durable storage; a separate read followed by a
write permits concurrent deliveries to pass together. Use an expiration window
that matches the provider's retry policy.

### Resolve client IPs behind trusted proxies

```ts
import { getClientIp } from "boundary-engine";

const ip = getClientIp(request, {
  production: process.env.NODE_ENV === "production",
  trustedProxyCidrs: ["198.41.128.0/17", "2606:4700::/32"],
  trustCfConnectingIp: true,
});
```

In production, `X-Forwarded-For` is accepted only when the terminal header hop
is in `trustedProxyCidrs`. Fetch `Request` does not expose the socket peer, so
this cannot prove which machine supplied the header: direct origin access must
also be blocked and only the configured proxies may reach the application.
CIDR checks support IPv4 and IPv6. `CF-Connecting-IP` is ignored unless
`trustCfConnectingIp` is true for the same reason.

### Error disclosure policy

`sanitizeError()` preserves raw messages outside production unless they match a
known sensitive-data pattern. Set `production: true` in deployed error handlers
to replace raw messages with status-safe text. In production mode, `ApiError`
details are omitted unless a `redact` callback is supplied; the callback's
return value is treated as safe to expose. The default handler's logger receives
the sanitized message, request ID, method, and URL without its query string.
The `onError` hook still receives the original error and request context for
integrations that intentionally need them.

---

## API Reference

| Export                                        | Purpose                                                                    |
| :-------------------------------------------- | :------------------------------------------------------------------------- |
| `ApiError`                                    | Typed HTTP error class with code, status, and details.                     |
| `createErrorFactory(config)`                  | Creates named application error helpers.                                   |
| `sanitizeError(error, options)`               | Converts unknown errors into safe response payloads.                       |
| `validateJsonBody(request, schema, options?)` | Validates body size, JSON parsing, and Zod schema.                         |
| `validateQueryParams(schema, url)`            | Validates query parameters using Zod.                                      |
| `createRouteBoundary(options?)`               | Composes validation, guards, context, and error handling for Fetch routes. |
| `.requestGuard()` / `.guard()`                | Runs guards before validation or after typed inputs are available.         |
| `.onValidationError()` / `.onError()`         | Observes validation failures or maps thrown route errors.                  |
| `createBoundaryErrorHandler(options?)`        | Creates a configurable sanitized route error handler.                      |
| `json()` / `empty()` / `errorJson()`          | Small Fetch response helpers for JSON and empty responses.                 |
| `verifyWebhookSignature(options)`             | Verifies HMAC webhook signatures.                                          |
| `createWebhookGuard(options)`                 | Verifies signatures and optionally checks replay IDs.                      |
| `validatePayloadSize(payload, maxBytes?)`     | Checks raw payload size before processing.                                 |
| `getClientIp(request, options?)`              | Extracts client IP with trusted proxy support.                             |
| `isValidIp(value)` / `isIpInCidr(ip, cidr)`   | IPv4/IPv6 validation helpers.                                              |

---

## Development

To build the package and generate TypeScript declarations:

```bash
bun run build
```

To run the package unit tests:

```bash
bun run test
```

To run the package type check:

```bash
bun run typecheck
```

After building, verify the published runtime exports:

```bash
bun run test:smoke
```

---

## Related Packages

- [`rate-engine`](https://github.com/cpauldev/rate-engine) for policy-driven rate limiting.
- [`redact-engine`](https://github.com/cpauldev/redact-engine) for sensitive data redaction and safe logging.
- [`secret-engine`](https://github.com/cpauldev/secret-engine) for context-bound encryption and secret handling.
- [`session-engine`](https://github.com/cpauldev/session-engine) for browser session and cache lifecycle management.

---

## License

MIT © [Christian Paul](https://github.com/cpauldev)
