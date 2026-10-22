import type { JsonResponseOptions } from "./types.js";

function mergeJsonHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  if (!merged.has("Content-Type")) {
    merged.set("Content-Type", "application/json");
  }
  return merged;
}

export function json<T>(data: T, options: JsonResponseOptions = {}): Response {
  return new Response(JSON.stringify(data), {
    status: options.status ?? 200,
    headers: mergeJsonHeaders(options.headers),
  });
}

export function errorJson(payload: unknown, status: number): Response {
  return json(payload, { status });
}

export function empty(status = 204): Response {
  return new Response(null, { status });
}
