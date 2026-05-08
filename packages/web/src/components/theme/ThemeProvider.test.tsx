import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeProvider';

function wrap({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

function setSystemPrefersDark(prefersDark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('dark') ? prefersDark : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as any;
}

describe('useTheme', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    setSystemPrefersDark(false);
  });

  it('defaults to system preference when nothing is stored', () => {
    setSystemPrefersDark(true);
    const { result } = renderHook(() => useTheme(), { wrapper: wrap });
    expect(result.current.theme).toBe('system');
    expect(result.current.resolvedTheme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('resolves system preference to light when OS is light', () => {
    setSystemPrefersDark(false);
    const { result } = renderHook(() => useTheme(), { wrapper: wrap });
    expect(result.current.resolvedTheme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('reads explicit preference from localStorage on mount', () => {
    window.localStorage.setItem('hansard-theme', 'dark');
    const { result } = renderHook(() => useTheme(), { wrapper: wrap });
    expect(result.current.theme).toBe('dark');
    expect(result.current.resolvedTheme).toBe('dark');
  });

  it('persists explicit selection to localStorage and updates document', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrap });

    act(() => result.current.setTheme('dark'));
    expect(window.localStorage.getItem('hansard-theme')).toBe('dark');
    expect(result.current.resolvedTheme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    act(() => result.current.setTheme('light'));
    expect(window.localStorage.getItem('hansard-theme')).toBe('light');
    expect(result.current.resolvedTheme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('falls back to system when an invalid value is stored', () => {
    window.localStorage.setItem('hansard-theme', 'taupe');
    setSystemPrefersDark(true);
    const { result } = renderHook(() => useTheme(), { wrapper: wrap });
    expect(result.current.theme).toBe('system');
    expect(result.current.resolvedTheme).toBe('dark');
  });
});
