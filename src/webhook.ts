import { createHmac, timingSafeEqual } from "crypto";

import type {
  WebhookGuardOptions,
  WebhookGuardResult,
  WebhookSignatureOptions,
} from "./types";
import { validatePayloadSize } from "./validation";

function extractSignature(signature: string): string | null {
  if (!signature) return null;
  if (!signature.includes(",")) return signature;
  const v1 = signature
    .split(",")
    .find((part) => part.startsWith("v1=") || part.startsWith("v1,"));
  if (!v1) return null;
  return v1.includes("=") ? v1.split("=")[1] : v1.split(",")[1];
}

/**
 * Verifies an incoming webhook HMAC signature using timing-safe comparison to block timing attacks.
 * Automatically parses header formats (e.g. Stripe signature schemes).
 *
 * @param options Webhook signature options (payload, signature, secret, algorithm).
 * @returns True if the webhook signature is authentic.
 */
export function verifyWebhookSignature(
  options: WebhookSignatureOptions,
): boolean {
  if (!options.signature) return false;
  const provided = extractSignature(options.signature);
  if (!provided) return false;

  try {
    const payloadBuffer = Buffer.isBuffer(options.payload)
      ? options.payload
      : Buffer.from(options.payload);
    const expected = createHmac(options.algorithm ?? "sha256", options.secret)
      .update(payloadBuffer)
      .digest("hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    const providedBuffer = Buffer.from(provided, "hex");
    if (expectedBuffer.length !== providedBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, providedBuffer);
  } catch {
    return false;
  }
}

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Creates a webhook guard middleware wrapper.
 * Performs payload size checking, signature verification, and fail-closed replay protection automatically.
 *
 * @param options Guard configuration (secret, replay callback, headers, maximum size).
 * @returns An async handler function that accepts a Request and returns a WebhookGuardResult.
 */
export function createWebhookGuard(options: WebhookGuardOptions) {
  return async (request: Request): Promise<WebhookGuardResult> => {
    const rawBody = Buffer.from(await request.arrayBuffer());
    const size = validatePayloadSize(rawBody, options.maxBodySize);
    if (!size.ok) {
      return {
        ok: false,
        response: size.response,
        reason: "payload_too_large",
      };
    }

    const signature = request.headers.get(
      options.signatureHeader ?? "webhook-signature",
    );
    if (
      !verifyWebhookSignature({
        payload: rawBody,
        signature,
        secret: options.secret,
      })
    ) {
      return {
        ok: false,
        response: jsonResponse({ error: "Invalid webhook signature" }, 401),
        reason: "invalid_signature",
      };
    }

    const webhookId = request.headers.get(options.idHeader ?? "webhook-id");
    if (options.replay) {
      if (!webhookId) {
        return {
          ok: false,
          response: jsonResponse({ error: "Missing webhook identifier" }, 400),
          reason: "missing_webhook_id",
        };
      }
      const replay = await options.replay(webhookId, signature ?? "");
      if (replay) {
        return {
          ok: false,
          response: jsonResponse({ error: "Webhook replay detected" }, 409),
          reason: "replay_detected",
        };
      }
    }

    return { ok: true, rawBody, webhookId };
  };
}
