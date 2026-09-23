export const API_BASE = (import.meta.env.VITE_API_URL || '')
  .replace(/\/+$/, '')
  .replace(/\/api$/, '') + '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Raw response body, kept for debugging when `message` was extracted from JSON. */
    public body?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Fastify error bodies look like `{ statusCode, error, message }` and route
 * handlers mostly send `{ error }`. Surface the human sentence rather than
 * the raw JSON so inline form errors read like prose.
 */
export function errorMessageFromBody(body: string, fallback: string): string {
  const trimmed = body.trim();
  if (!trimmed) return fallback;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      for (const key of ['message', 'error', 'detail']) {
        const value = parsed[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
    } catch {
      // Not JSON after all — fall through to the raw text.
    }
  }
  return trimmed;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  // Only declare a JSON body when there is one: Fastify rejects an empty body
  // sent with `Content-Type: application/json` (FST_ERR_CTP_EMPTY_JSON_BODY),
  // which broke every bodyless POST/DELETE (open/close/tally a vote, dissolve
  // a party, unlink a ticket, ...).
  const headers: Record<string, string> = {};
  if (options?.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      ...headers,
      ...(options?.headers as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, errorMessageFromBody(body, res.statusText || `Request failed (${res.status})`), body);
  }

  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    const body = await res.text();
    if (!body.trim()) return undefined as T;
    const preview = body.trim().slice(0, 120);
    throw new ApiError(
      res.status,
      `Expected JSON from ${path}, got ${contentType || 'unknown content type'}${preview ? `: ${preview}` : ''}`,
    );
  }
  return res.json();
}

function jsonBody(body: unknown): RequestInit {
  return body === undefined ? {} : { body: JSON.stringify(body) };
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', ...jsonBody(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', ...jsonBody(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
