import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useDebouncedValue } from './useDebouncedValue';

type Primitive = string | number;

/**
 * Page state (filters, tab, page number) stored in the URL query string, so
 * refresh, back/forward, and shared links keep the view. Values equal to their
 * default are dropped to keep URLs clean, and updates replace the history
 * entry rather than stacking one per keystroke.
 */
export function useUrlState<T extends Record<string, Primitive>>(defaults: T) {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const values = {} as T;
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const raw = search[key as string];
    const fallback = defaults[key];
    if (raw === undefined || raw === null || raw === '') {
      values[key] = fallback;
    } else if (typeof fallback === 'number') {
      const n = Number(raw);
      values[key] = (Number.isFinite(n) && n > 0 ? n : fallback) as T[keyof T];
    } else {
      values[key] = String(raw) as T[keyof T];
    }
  }

  const setValues = useCallback(
    (patch: Partial<T>) => {
      navigate({
        to: '.',
        replace: true,
        search: (prev: Record<string, unknown>) => {
          const next: Record<string, unknown> = { ...prev };
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || value === '' || value === defaultsRef.current[key]) delete next[key];
            else next[key] = value;
          }
          return next;
        },
      } as never);
    },
    [navigate],
  );

  return [values, setValues] as const;
}

/**
 * Free-text input backed by a URL value: typing stays local and snappy, the
 * trimmed text is committed after `delayMs`, and back/forward navigation
 * that changes the URL value flows back into the input.
 */
export function useUrlText(urlValue: string, commit: (value: string) => void, delayMs = 250) {
  const [text, setText] = useState(urlValue);
  const debounced = useDebouncedValue(text, delayMs);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  // The value this input last committed. When the URL catches up to it,
  // that is our own echo landing, and keys typed since must survive it.
  const committed = useRef(urlValue);

  useEffect(() => {
    const next = debounced.trim();
    if (next !== urlValue) {
      committed.current = next;
      commitRef.current(next);
    }
    // Only react to the user's debounced typing, not URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const lastUrl = useRef(urlValue);
  useEffect(() => {
    if (urlValue === lastUrl.current) return;
    lastUrl.current = urlValue;
    if (urlValue === committed.current) return; // our own commit arriving
    // Back/forward or a link changed the URL: show what it says.
    committed.current = urlValue;
    if (urlValue !== text.trim()) setText(urlValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlValue]);

  return [text, setText] as const;
}
