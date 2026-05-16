import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './client';

describe('api client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
});
