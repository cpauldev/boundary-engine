<img src="https://raw.githubusercontent.com/cpauldev/boundary-engine/main/banner.png" alt="BoundaryEngine Banner" width="100%" />

# BoundaryEngine: Secure HTTP Boundaries for TypeScript

![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white) ![Validation](https://img.shields.io/badge/-Validation-2563EB?style=flat-square) ![Webhooks](https://img.shields.io/badge/-Webhook_Guards-059669?style=flat-square) ![Zod](https://img.shields.io/badge/-Zod-3068B7?style=flat-square) ![License](https://img.shields.io/badge/-MIT_License-blue?style=flat-square) [![Changelog](https://img.shields.io/badge/Changelog-v0.1.0-blue?style=flat-square)](./CHANGELOG.md)

BoundaryEngine is a Fetch-first TypeScript toolkit for the repetitive security work around HTTP routes: body-size limits, JSON parsing, Zod validation, typed errors, sanitized responses, webhook signatures, replay hooks, and client IP extraction.

It is designed for developers building Fetch-compatible APIs on Node.js, Next.js route handlers, serverless functions, webhook receivers, and internal services. Use it when your route code is filling up with defensive plumbing that should be consistent, tested, and framework-light.

#### 🤖 Ask your coding assistant

> "Audit my codebase to see if adding the `boundary-engine` package on npm is beneficial. If so, explain why and draft an integration plan identifying body validation, query validation, error mapping, webhook verification, and client IP extraction points using the package README and source code."

---

## Why use BoundaryEngine?

| Feature                 | Without BoundaryEngine                                           | With **BoundaryEngine**                                                                                      |
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

# yarn
yarn add boundary-engine zod

# pnpm
pnpm add boundary-engine zod

# bun
bun add boundary-engine zod
```

---

## Quick Start

```ts
import { createRouteHandler } from "boundary-engine";
import { z } from "zod";

const route = createRouteHandler();

export const POST = route.body(
  z.object({
    email: z.string().email(),
  }),
  async ({ body }) => {
    return Response.json({ ok: true, email: body.email });
  },
);
```

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
    if (await redis.exists(key)) return true; // replay detected
    await redis.set(key, "1", { ex: 24 * 60 * 60 });
    return false;
  },
});

const result = await guard(request);

if (!result.ok) return result.response;
```

The guard verifies an HMAC signature over the raw body and fails closed when a replay hook is configured but the webhook identifier header is missing. Store replay IDs in durable storage with an expiration window that matches your provider's retry policy.

### Resolve client IPs behind trusted proxies

```ts
import { getClientIp } from "boundary-engine";

const ip = getClientIp(request, {
  production: process.env.NODE_ENV === "production",
  trustedProxyCidrs: ["198.41.128.0/17", "2606:4700::/32"],
  trustCfConnectingIp: true,
});
```

In production, `X-Forwarded-For` is accepted only when the terminal hop is in `trustedProxyCidrs`. CIDR checks support IPv4 and IPv6. `CF-Connecting-IP` is ignored unless `trustCfConnectingIp` is true, because that header is safe only when direct origin access is blocked and Cloudflare is the trusted edge.

---

## API Reference

| Export                                        | Purpose                                                |
| :-------------------------------------------- | :----------------------------------------------------- |
| `ApiError`                                    | Typed HTTP error class with code, status, and details. |
| `createErrorFactory(config)`                  | Creates named application error helpers.               |
| `sanitizeError(error, options)`               | Converts unknown errors into safe response payloads.   |
| `validateJsonBody(request, schema, options?)` | Validates body size, JSON parsing, and Zod schema.     |
| `validateQueryParams(schema, url)`            | Validates query parameters using Zod.                  |
| `createRouteHandler()`                        | Small Fetch route helper for schema-backed handlers.   |
| `verifyWebhookSignature(options)`             | Verifies HMAC webhook signatures.                      |
| `createWebhookGuard(options)`                 | Verifies signature plus replay protection.             |
| `validatePayloadSize(payload, maxBytes?)`     | Checks raw payload size before processing.             |
| `getClientIp(request, options?)`              | Extracts client IP with trusted proxy support.         |
| `isValidIp(value)` / `isIpInCidr(ip, cidr)`   | IPv4/IPv6 validation helpers.                          |

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
- [`redact-log`](https://github.com/cpauldev/redact-log) for safe logging.
- [`secret-engine`](https://github.com/cpauldev/secret-engine) for context-bound encryption and secret handling.
- [`session-engine`](https://github.com/cpauldev/session-engine) for browser session and cache lifecycle management.

---

## License

MIT © [Christian Paul](https://github.com/cpauldev)
