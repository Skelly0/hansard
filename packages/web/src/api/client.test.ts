import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, errorMessageFromBody } from './client';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('throws a useful error when a successful response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><html></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })));

    await expect(api.get('/players')).rejects.toMatchObject({
      name: 'ApiError',
      status: 200,
      message: expect.stringContaining('Expected JSON from /players'),
    } satisfies Partial<ApiError>);
  });

  it('omits the JSON content-type on bodyless POST and DELETE requests', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await api.post('/elections/abc/open');
    await api.delete('/parties/abc');

    for (const call of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      const headers = call[1].headers as Record<string, string>;
      expect(headers['Content-Type']).toBeUndefined();
      expect(call[1].body).toBeUndefined();
    }
  });

  it('sends the JSON content-type when a body is present', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await api.post('/tickets', { title: 'x' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"title":"x"}');
  });

  it('surfaces the message from a JSON error body instead of the raw JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(
      { statusCode: 400, error: 'Bad Request', message: 'Title is required' },
      400,
    )));

    await expect(api.post('/bills', {})).rejects.toMatchObject({
      status: 400,
      message: 'Title is required',
    });
  });

  it('treats an empty successful non-JSON response as no content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    await expect(api.delete('/favours/categories/abc')).resolves.toBeUndefined();
  });
});

describe('errorMessageFromBody', () => {
  it('prefers message, then error', () => {
    expect(errorMessageFromBody('{"error":"Forbidden"}', 'x')).toBe('Forbidden');
    expect(errorMessageFromBody('{"error":"Bad Request","message":"Nope"}', 'x')).toBe('Nope');
  });

  it('falls back to raw text and then to the fallback', () => {
    expect(errorMessageFromBody('plain failure', 'x')).toBe('plain failure');
    expect(errorMessageFromBody('   ', 'fallback')).toBe('fallback');
    expect(errorMessageFromBody('{not json', 'x')).toBe('{not json');
  });
});
