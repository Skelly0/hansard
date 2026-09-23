import { useEffect } from 'react';

const SUFFIX = 'Hansard';

/**
 * Set the browser tab title for the current page: "Bills · Hansard".
 * Pass `null`/`undefined` while data is loading to leave the title alone.
 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    document.title = `${title} · ${SUFFIX}`;
  }, [title]);
}
