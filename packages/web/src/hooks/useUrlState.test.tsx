import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUrlState, useUrlText } from './useUrlState';

const router = vi.hoisted(() => ({ search: {} as Record<string, unknown>, navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => router.search,
  useNavigate: () => router.navigate,
}));

describe('useUrlState', () => {
  beforeEach(() => {
    router.search = {};
    router.navigate.mockReset();
  });

  it('falls back to defaults and coerces URL values to the default types', () => {
    router.search = { status: 'voting', page: '3', q: 123 };
    const { result } = renderHook(() => useUrlState({ status: 'all', page: 1, q: '', sort: 'newest' }));
    expect(result.current[0]).toEqual({ status: 'voting', page: 3, q: '123', sort: 'newest' });
  });

  it('ignores a nonsense page number', () => {
    router.search = { page: 'abc' };
    const { result } = renderHook(() => useUrlState({ page: 1 }));
    expect(result.current[0].page).toBe(1);
  });

  it('replaces history and drops values equal to their default', () => {
    router.search = { status: 'voting', page: 2, unrelated: 'keep' };
    const { result } = renderHook(() => useUrlState({ status: 'all', page: 1 }));
    act(() => result.current[1]({ status: 'all', page: 1 }));

    const [{ search, replace }] = router.navigate.mock.calls[0];
    expect(replace).toBe(true);
    expect(search(router.search)).toEqual({ unrelated: 'keep' });
  });

  it('writes non-default values', () => {
    const { result } = renderHook(() => useUrlState({ status: 'all', page: 1 }));
    act(() => result.current[1]({ status: 'enacted', page: 2 }));
    const [{ search }] = router.navigate.mock.calls[0];
    expect(search({})).toEqual({ status: 'enacted', page: 2 });
  });
});

describe('useUrlText', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps keys typed while its own commit is still landing in the URL', () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(({ url }) => useUrlText(url, commit), { initialProps: { url: '' } });

    act(() => result.current[1]('abc'));
    act(() => { vi.advanceTimersByTime(260); });
    expect(commit).toHaveBeenLastCalledWith('abc');

    // The user keeps typing before the router applies the replace.
    act(() => result.current[1]('abcd'));
    rerender({ url: 'abc' });
    expect(result.current[0]).toBe('abcd');
  });

  it('follows the URL when it changes from outside (back/forward)', () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(({ url }) => useUrlText(url, commit), { initialProps: { url: 'coal' } });
    rerender({ url: 'ports' });
    expect(result.current[0]).toBe('ports');
    rerender({ url: '' });
    expect(result.current[0]).toBe('');
  });
});
