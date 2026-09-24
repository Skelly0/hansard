import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { createQueryClient, shouldRetry } from './queryClient';
import { useToastStore } from './toast';

afterEach(() => useToastStore.setState({ toasts: [] }));

describe('shouldRetry', () => {
  it('never retries client errors', () => {
    expect(shouldRetry(0, new ApiError(404, 'Not found'))).toBe(false);
    expect(shouldRetry(0, new ApiError(403, 'Forbidden'))).toBe(false);
  });

  it('retries a server or network failure once', () => {
    expect(shouldRetry(0, new ApiError(503, 'Unavailable'))).toBe(true);
    expect(shouldRetry(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetry(1, new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('mutation toasts', () => {
  it('shows the success message from mutation meta', async () => {
    const qc = createQueryClient();
    await qc.getMutationCache().build(qc, {
      mutationFn: async (vars: { isInternal: boolean }) => vars,
      meta: { successMessage: (_d: unknown, vars: { isInternal: boolean }) => (vars.isInternal ? 'Internal note added' : 'Reply sent') },
    }).execute({ isInternal: true });
    expect(useToastStore.getState().toasts.map((t) => [t.tone, t.title])).toEqual([['success', 'Internal note added']]);
  });

  it('shows an error toast with the API message only when the hook opts in', async () => {
    const qc = createQueryClient();
    const fail = async () => { throw new ApiError(400, 'Voting is not open'); };
    await qc.getMutationCache().build(qc, { mutationFn: fail, meta: { errorMessage: 'Could not close the ticket' } })
      .execute(undefined).catch(() => {});
    await qc.getMutationCache().build(qc, { mutationFn: fail }).execute(undefined).catch(() => {});
    expect(useToastStore.getState().toasts).toMatchObject([
      { tone: 'error', title: 'Could not close the ticket', description: 'Voting is not open' },
    ]);
  });

  it('keeps at most three toasts on screen', () => {
    const { push } = useToastStore.getState();
    for (let i = 0; i < 5; i++) push({ tone: 'info', title: `t${i}` });
    expect(useToastStore.getState().toasts.map((t) => t.title)).toEqual(['t2', 't3', 't4']);
  });
});
