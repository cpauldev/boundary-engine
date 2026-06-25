import { describe, expect, it } from "bun:test";
import { createHmac } from "crypto";
import { z } from "zod";

import {
  ApiError,
  createErrorFactory,
  createRouteHandler,
  createWebhookGuard,
  getClientIp,
  isIpInCidr,
  sanitizeError,
  validateJsonBody,
  validatePayloadSize,
  validateQueryParams,
  verifyWebhookSignature,
} from "../index";

describe("boundary-engine", () => {
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

  it("creates route handlers", async () => {
    const route = createRouteHandler();
    const handler = route.body(z.object({ name: z.string() }), ({ body }) =>
      Response.json({ name: body.name }),
    );
    const response = await handler(
      new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify({ name: "Ada" }),
      }),
    );
    expect(await response.json()).toEqual({ name: "Ada" });
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
