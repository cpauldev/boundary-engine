import { createHmac, timingSafeEqual } from "crypto";

import type {
  WebhookGuardOptions,
  WebhookGuardResult,
  WebhookSignatureOptions,
} from "./types";

import {
  BodyTooLargeError,
  bodyTooLargeResponse,
  DEFAULT_MAX_BODY_SIZE,
  readRequestBodyWithLimit,
} from "./body-reader";
import { errorJson } from "./responses";

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
 * Verifies a hexadecimal HMAC-SHA256 signature over the supplied payload using
 * a constant-time comparison. It accepts a bare digest or a comma-delimited
 * header containing a `v1=<digest>` field.
 *
 * Provider schemes that sign a transformed payload, such as a timestamp
 * concatenated with the body, must supply that exact signed payload.
 *
 * @param options Webhook signature options (payload, signature, secret, algorithm).
 * @returns True if the webhook signature is authentic.
 */
export function verifyWebhookSignature(
  options: WebhookSignatureOptions,
): boolean {
  if (!options.signature || !options.secret) return false;
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

/**
 * Creates a webhook guard middleware wrapper.
 * Performs bounded body reading, signature verification, and optional replay
 * checking. A missing webhook ID or a replay-store error fails closed when a
 * replay callback is configured.
 *
 * @param options Guard configuration (secret, replay callback, headers, maximum size).
 * @returns An async handler function that accepts a Request and returns a WebhookGuardResult.
 */
export function createWebhookGuard(options: WebhookGuardOptions) {
  return async (request: Request): Promise<WebhookGuardResult> => {
    let rawBody: Buffer;
    try {
      rawBody = Buffer.from(
        await readRequestBodyWithLimit(
          request,
          options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE,
        ),
      );
    } catch (error) {
      if (!(error instanceof BodyTooLargeError)) throw error;
      return {
        ok: false,
        response: bodyTooLargeResponse(error.maxBytes),
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
        response: errorJson({ error: "Invalid webhook signature" }, 401),
        reason: "invalid_signature",
      };
    }

    const webhookId = request.headers.get(options.idHeader ?? "webhook-id");
    if (options.replay) {
      if (!webhookId) {
        return {
          ok: false,
          response: errorJson({ error: "Missing webhook identifier" }, 400),
          reason: "missing_webhook_id",
        };
      }
      let replay: boolean;
      try {
        replay = await options.replay(webhookId, signature ?? "");
      } catch {
        return {
          ok: false,
          response: errorJson(
            { error: "Webhook replay check unavailable" },
            503,
          ),
          reason: "replay_check_failed",
        };
      }
      if (replay) {
        return {
          ok: false,
          response: errorJson({ error: "Webhook replay detected" }, 409),
          reason: "replay_detected",
        };
      }
    }

    return { ok: true, rawBody, webhookId };
  };
}
