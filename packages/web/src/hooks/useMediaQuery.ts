import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribe to a CSS media query. Renders the correct branch on first paint
 * (no flash) because `matchMedia` is read synchronously.
 */
export function useMediaQuery(query: string, fallback = true): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = typeof window !== 'undefined' ? window.matchMedia?.(query) : undefined;
      mq?.addEventListener?.('change', onChange);
      return () => mq?.removeEventListener?.('change', onChange);
    },
    [query],
  );
  const getSnapshot = () =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : fallback;
  return useSyncExternalStore(subscribe, getSnapshot, () => fallback);
}

/** Tailwind `md` and up. */
export function useIsWide(): boolean {
  return useMediaQuery('(min-width: 768px)');
}
