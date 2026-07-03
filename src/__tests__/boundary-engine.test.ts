import { createHmac } from "crypto";

import { describe, expect, expectTypeOf, it } from "bun:test";
import { z } from "zod";

import {
  ApiError,
  createBoundaryErrorHandler,
  createErrorFactory,
  createRouteBoundary,
  createWebhookGuard,
  errorJson,
  getClientIp,
  isIpInCidr,
  json,
  sanitizeError,
  validateJsonBody,
  validatePayloadSize,
  validateQueryParams,
  verifyWebhookSignature,
} from "../index";

describe("boundary-engine", () => {
  it("preserves route boundary input and context types", () => {
    createRouteBoundary()
      .requestGuard(() => ({
        ok: true,
        context: { user: { id: "user_1" } },
      }))
      .params(z.object({ id: z.string() }))
      .query(z.object({ page: z.coerce.number() }))
      .body(z.object({ name: z.string() }))
      .guard(({ body, context, params, query }) => {
        expectTypeOf(body).toEqualTypeOf<{ name: string }>();
        expectTypeOf(context.user).toEqualTypeOf<{ id: string }>();
        expectTypeOf(params).toEqualTypeOf<{ id: string }>();
        expectTypeOf(query).toEqualTypeOf<{ page: number }>();
        return { ok: true, context: { authorized: true as const } };
      })
      .onError((_error, state) => {
        expectTypeOf(state.body).toEqualTypeOf<{ name: string } | undefined>();
        expectTypeOf(state.context?.authorized).toEqualTypeOf<
          true | undefined
        >();
      })
      .handle(({ body, context, params, query }) => {
        expectTypeOf(body).toEqualTypeOf<{ name: string }>();
        expectTypeOf(context.authorized).toEqualTypeOf<true>();
        expectTypeOf(params).toEqualTypeOf<{ id: string }>();
        expectTypeOf(query).toEqualTypeOf<{ page: number }>();
        return json({ ok: true });
      });
  });

  it("validates JSON bodies and formats zod errors", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify({ count: "bad" }),
    });
    const result = await validateJsonBody(
      request,
      z.object({ count: z.number() }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      expect(await result.response.json()).toMatchObject({
        error: "Validation failed",
      });
    }
  });

  it("rejects malformed JSON and large payloads", async () => {
    const malformed = await validateJsonBody(
      new Request("https://example.com", { method: "POST", body: "{" }),
      z.object({}),
    );
    expect(malformed.ok).toBe(false);
    expect(validatePayloadSize("abc", 2).ok).toBe(false);
  });

  it("validates query params", () => {
    const result = validateQueryParams(
      z.object({ limit: z.coerce.number().int() }),
      "https://example.com?limit=5",
    );
    expect(result.ok && result.data.limit).toBe(5);
  });

  it("sanitizes typed errors", () => {
    const factory = createErrorFactory({ INVALID: { status: 400 } });
    const sanitized = sanitizeError(factory.INVALID("Bad value"), {
      requestId: "req_test",
    });
    expect(sanitized).toMatchObject({
      code: "INVALID",
      statusCode: 400,
      requestId: "req_test",
    });
    expect(sanitizeError(new Error("api key leaked")).message).toBe(
      "An unexpected error occurred. Please try again later.",
    );
    expect(new ApiError({ code: "X", message: "x" })).toBeInstanceOf(Error);
  });

  it("omits unredacted details and normalizes invalid statuses in production", () => {
    const sanitized = sanitizeError(
      new ApiError({
        code: "BROKEN",
        message: "Internal failure",
        statusCode: 200,
        details: { token: "secret" },
      }),
      { production: true },
    );

    expect(sanitized.statusCode).toBe(500);
    expect(sanitized.details).toBeUndefined();
  });

  it("creates route boundaries with body, query, and params validation", async () => {
    const handler = createRouteBoundary()
      .body(z.object({ name: z.string() }))
      .query(z.object({ page: z.coerce.number().int() }))
      .params(z.object({ id: z.string().min(1) }))
      .handle(({ body, query, params }) =>
        json({ id: params.id, name: body.name, page: query.page }),
      );

    const response = await handler(
      new Request("https://example.com/users?page=2", {
        method: "POST",
        body: JSON.stringify({ name: "Ada" }),
      }),
      { params: { id: "user_1" } },
    );

    expect(await response.json()).toEqual({
      id: "user_1",
      name: "Ada",
      page: 2,
    });
  });

  it("returns validation responses from route boundaries", async () => {
    const handler = createRouteBoundary()
      .params(z.object({ id: z.string().min(1) }))
      .handle(() => json({ unreachable: true }));

    const response = await handler(new Request("https://example.com"), {
      params: { id: "" },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Validation failed",
    });
  });

  it("runs sync and async guards and merges context", async () => {
    const handler = createRouteBoundary()
      .guard(() => ({ ok: true, context: { ipAddress: "203.0.113.10" } }))
      .guard(async ({ context }) => ({
        ok: true,
        context: { actor: `ip:${context.ipAddress}` },
      }))
      .handle(({ context }) =>
        json({ actor: context.actor, ipAddress: context.ipAddress }),
      );

    const response = await handler(new Request("https://example.com"));

    expect(await response.json()).toEqual({
      actor: "ip:203.0.113.10",
      ipAddress: "203.0.113.10",
    });
  });

  it("keeps derived builders immutable", async () => {
    const base = createRouteBoundary();
    const withBody = base.body(z.object({ name: z.string() }));
    const baseHandler = base.handle(() => json({ route: "base" }));
    const bodyHandler = withBody.handle(({ body }) => json(body));

    const baseResponse = await baseHandler(new Request("https://example.com"));
    const bodyResponse = await bodyHandler(
      new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify({ name: "Ada" }),
      }),
    );

    expect(await baseResponse.json()).toEqual({ route: "base" });
    expect(await bodyResponse.json()).toEqual({ name: "Ada" });
  });

  it("short-circuits when a route boundary guard returns a response", async () => {
    const handler = createRouteBoundary()
      .guard(() => ({
        ok: false,
        response: errorJson({ error: "blocked" }, 429),
      }))
      .handle(() => json({ unreachable: true }));

    const response = await handler(new Request("https://example.com"));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "blocked" });
  });

  it("maps route-local errors before sanitizing", async () => {
    const factory = createErrorFactory({ INVALID: { status: 400 } });
    const handler = createRouteBoundary({
      errorHandler: createBoundaryErrorHandler({ requestId: "req_mapped" }),
    })
      .onError((error) => {
        if (
          error instanceof Error &&
          error.message === "Unsupported provider"
        ) {
          return factory.INVALID("Unsupported provider");
        }
        return error;
      })
      .handle(() => {
        throw new Error("Unsupported provider");
      });

    const response = await handler(new Request("https://example.com"));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "INVALID",
      requestId: "req_mapped",
    });
  });

  it("sanitizes an error mapper failure instead of rejecting the route", async () => {
    const handler = createRouteBoundary({
      errorHandler: (error) =>
        errorJson(
          { message: error instanceof Error ? error.message : String(error) },
          500,
        ),
    })
      .onError(() => {
        throw new Error("mapper failed");
      })
      .handle(() => {
        throw new Error("handler failed");
      });

    const response = await handler(new Request("https://example.com"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "mapper failed" });
  });

  it("uses the configured route boundary error handler", async () => {
    const handler = createRouteBoundary({
      errorHandler: () => errorJson({ error: "custom" }, 418),
    }).handle(() => {
      throw new Error("boom");
    });

    const response = await handler(new Request("https://example.com"));

    expect(response.status).toBe(418);
    expect(await response.json()).toEqual({ error: "custom" });
  });

  it("keeps secrets out of production error logs", async () => {
    const entries: Array<Record<string, unknown> | undefined> = [];
    const handler = createRouteBoundary({
      errorHandler: createBoundaryErrorHandler({
        production: true,
        logger: {
          error: (_message, metadata) => entries.push(metadata),
        },
      }),
    }).handle(() => {
      throw new Error("token=super-secret");
    });

    await handler(
      new Request("https://example.com/accounts?token=super-secret"),
    );

    expect(entries).toEqual([
      {
        method: "GET",
        url: "https://example.com/accounts",
        error: "An unexpected error occurred. Please try again later.",
        requestId: expect.stringContaining("req_"),
      },
    ]);
  });

  it("runs request guards before validation and post-validation guards after it", async () => {
    const order: string[] = [];
    const handler = createRouteBoundary()
      .requestGuard(() => {
        order.push("request");
        return { ok: true, context: { actor: "user_1" } };
      })
      .body(z.object({ value: z.string() }))
      .guard(({ body }) => {
        order.push(`validated:${body.value}`);
        return { ok: true, context: {} };
      })
      .handle(() => {
        order.push("handler");
        return json({ ok: true });
      });

    await handler(
      new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify({ value: "ready" }),
      }),
    );

    expect(order).toEqual(["request", "validated:ready", "handler"]);
  });

  it("does not read the body after a request guard short-circuits", async () => {
    const handler = createRouteBoundary()
      .requestGuard(() => ({
        ok: false,
        response: errorJson({ error: "unauthorized" }, 401),
      }))
      .body(z.object({}))
      .handle(() => json({ unreachable: true }));

    const request = new Request("https://example.com", {
      method: "POST",
      body: "{}",
    });
    const response = await handler(request);

    expect(response.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
  });

  it("provides request-local data to error handlers without cross-request state", async () => {
    const seen = new Map<string, unknown>();
    const handler = createRouteBoundary({
      errorHandler: (error, context) => {
        seen.set(new URL(context.request.url).pathname, context);
        return errorJson({ error: String(error) }, 500);
      },
    })
      .requestGuard(({ request }) => ({
        ok: true,
        context: { userId: new URL(request.url).pathname.slice(1) },
      }))
      .params(z.object({ id: z.string() }))
      .handle(async ({ params }) => {
        await Promise.resolve();
        throw new Error(params.id);
      });

    await Promise.all([
      handler(new Request("https://example.com/first"), {
        params: { id: "first" },
      }),
      handler(new Request("https://example.com/second"), {
        params: { id: "second" },
      }),
    ]);

    expect(seen.get("/first")).toMatchObject({
      context: { userId: "first" },
      params: { id: "first" },
    });
    expect(seen.get("/second")).toMatchObject({
      context: { userId: "second" },
      params: { id: "second" },
    });
  });

  it("reports validation failures and permits a custom response", async () => {
    const sources: string[] = [];
    const handler = createRouteBoundary()
      .params(z.object({ id: z.string().uuid() }))
      .onValidationError((failure) => {
        sources.push(failure.source);
        return errorJson({ error: "custom validation" }, 422);
      })
      .handle(() => json({ unreachable: true }));

    const response = await handler(new Request("https://example.com"), {
      params: { id: "invalid" },
    });

    expect(sources).toEqual(["params"]);
    expect(response.status).toBe(422);
  });

  it("preserves repeated query parameters", () => {
    const result = validateQueryParams(
      z.object({ tag: z.array(z.string()) }),
      "https://example.com?tag=one&tag=two",
    );

    expect(result).toEqual({ ok: true, data: { tag: ["one", "two"] } });
  });

  it("optionally requires a JSON content type", async () => {
    const result = await validateJsonBody(
      new Request("https://example.com", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "text/plain" },
      }),
      z.object({}),
      { requireJsonContentType: true },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(415);
  });

  it("verifies webhook signatures and guard replay hooks", async () => {
    const payload = "hello";
    const secret = "secret";
    const sig = createHmac("sha256", secret).update(payload).digest("hex");
    expect(
      verifyWebhookSignature({ payload, signature: `t=1,v1=${sig}`, secret }),
    ).toBe(true);
    const guard = createWebhookGuard({
      secret,
      replay: async () => true,
    });
    const response = await guard(
      new Request("https://example.com", {
        method: "POST",
        headers: { "webhook-signature": sig, "webhook-id": "evt_1" },
        body: payload,
      }),
    );
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.reason).toBe("replay_detected");

    // Replay check fails-closed on missing identifier
    const responseMissingId = await guard(
      new Request("https://example.com", {
        method: "POST",
        headers: { "webhook-signature": sig },
        body: payload,
      }),
    );
    expect(responseMissingId.ok).toBe(false);
    if (!responseMissingId.ok)
      expect(responseMissingId.reason).toBe("missing_webhook_id");
  });

  it("fails closed when the webhook replay store is unavailable", async () => {
    const payload = "hello";
    const secret = "secret";
    const signature = createHmac("sha256", secret)
      .update(payload)
      .digest("hex");
    const guard = createWebhookGuard({
      secret,
      replay: async () => {
        throw new Error("store unavailable");
      },
    });

    const result = await guard(
      new Request("https://example.com", {
        method: "POST",
        headers: {
          "webhook-signature": signature,
          "webhook-id": "evt_1",
        },
        body: payload,
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("replay_check_failed");
      expect(result.response.status).toBe(503);
    }
  });

  it("stops reading oversized streamed webhook bodies at the byte limit", async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array([1, 2]));
        if (pulls === 10) controller.close();
      },
    });
    const guard = createWebhookGuard({
      secret: "secret",
      maxBodySize: 3,
    });

    const result = await guard(
      new Request("https://example.com/webhook", {
        method: "POST",
        body: stream,
        duplex: "half",
        headers: { "content-length": "1" },
      } as RequestInit),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("payload_too_large");
      expect(result.response.status).toBe(413);
    }
    expect(pulls).toBeLessThan(10);
  });

  it("limits streamed webhook bodies without a Content-Length header", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        controller.close();
      },
    });
    const guard = createWebhookGuard({
      secret: "secret",
      maxBodySize: 2,
    });

    const result = await guard(
      new Request("https://example.com/webhook", {
        method: "POST",
        body: stream,
        duplex: "half",
      } as RequestInit),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it("extracts IPs from trusted proxy chains", () => {
    expect(isIpInCidr("198.41.128.1", "198.41.128.0/17")).toBe(true);
    expect(isIpInCidr("198.41.127.255", "198.41.128.0/17")).toBe(false);
    expect(isIpInCidr("2606:4700::1", "2606:4700::/32")).toBe(true);
    expect(isIpInCidr("2607:4700::1", "2606:4700::/32")).toBe(false);
    expect(isIpInCidr("not-an-ip", "198.41.128.0/17")).toBe(false);
    expect(isIpInCidr("198.41.128.1", "not-a-cidr")).toBe(false);
    expect(isIpInCidr("198.41.128.1", "198.41.128.0/129")).toBe(false);

    const request = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "8.8.8.8, 198.41.128.1",
      },
    });
    expect(
      getClientIp(request, {
        production: true,
        trustedProxyCidrs: ["198.41.128.0/17"],
      }),
    ).toBe("8.8.8.8");

    const requestMulti = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "8.8.8.8, 198.41.128.2, 198.41.128.1",
      },
    });
    expect(
      getClientIp(requestMulti, {
        production: true,
        trustedProxyCidrs: ["198.41.128.0/17"],
      }),
    ).toBe("8.8.8.8");
  });

  it("extracts IPv6 clients from trusted IPv6 proxy chains", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "2001:4860:4860::8888, 2606:4700::1",
      },
    });

    expect(
      getClientIp(request, {
        production: true,
        trustedProxyCidrs: ["2606:4700::/32"],
      }),
    ).toBe("2001:4860:4860::8888");
  });

  it("fails closed for spoofable production proxy headers", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "8.8.8.8",
      },
    });

    expect(
      getClientIp(request, {
        production: true,
        trustedProxyCidrs: ["198.41.128.0/17"],
      }),
    ).toBe("unknown");

    const untrustedTerminalProxy = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "8.8.8.8, 198.51.100.1",
      },
    });

    expect(
      getClientIp(untrustedTerminalProxy, {
        production: true,
        trustedProxyCidrs: ["198.41.128.0/17"],
      }),
    ).toBe("unknown");

    const privateClient = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "10.0.0.1, 198.41.128.1",
      },
    });

    expect(
      getClientIp(privateClient, {
        production: true,
        trustedProxyCidrs: ["198.41.128.0/17"],
      }),
    ).toBe("unknown");
  });

  it("requires explicit trust before accepting Cloudflare connecting IP in production", () => {
    const request = new Request("https://example.com", {
      headers: {
        "cf-connecting-ip": "8.8.8.8",
      },
    });

    expect(getClientIp(request, { production: true })).toBe("unknown");
    expect(
      getClientIp(request, {
        production: true,
        trustCfConnectingIp: true,
      }),
    ).toBe("8.8.8.8");
  });
});
