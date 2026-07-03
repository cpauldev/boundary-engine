import { errorJson } from "./responses";

export const DEFAULT_MAX_BODY_SIZE = 1024 * 1024;

export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body too large. Maximum size: ${maxBytes} bytes`);
    this.name = "BodyTooLargeError";
  }
}

export function bodyTooLargeResponse(maxBytes: number): Response {
  return errorJson(
    { error: `Request body too large. Maximum size: ${maxBytes} bytes` },
    413,
  );
}

export async function readRequestBodyWithLimit(
  request: Request,
  maxBytes = DEFAULT_MAX_BODY_SIZE,
): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the deterministic body-size error if cancellation fails.
        }
        throw new BodyTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
