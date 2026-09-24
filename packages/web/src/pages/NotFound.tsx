import { Link } from '@tanstack/react-router';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/**
 * Router-level 404. Rendered outside the app shell (the root route has no
 * layout), so it carries its own parchment frame like the login page.
 */
export function NotFound() {
  useDocumentTitle('Not found');
  return (
    <div className="bg-parchment min-h-screen flex items-center justify-center p-6">
      <main className="parchment-frame w-full max-w-md py-16 px-8 sm:px-12 text-center">
        <div className="text-mono text-text-tertiary text-xs tracking-[0.15em] uppercase mb-6">
          — Error 404 —
        </div>
        <h1 className="font-display italic text-[2.25rem] leading-tight text-text-primary mb-4">
          No such record
        </h1>
        <div className="flex items-center justify-center gap-3 mb-6" aria-hidden="true">
          <div className="h-px w-8 bg-border-strong" />
          <div className="text-border-strong text-base">✦</div>
          <div className="h-px w-8 bg-border-strong" />
        </div>
        <p className="font-body italic text-body text-text-secondary mb-8 leading-relaxed">
          The clerk searched the archive and found nothing filed under this address.
        </p>
        <Link to="/" className="btn-primary inline-block">
          Return to the chamber
        </Link>
      </main>
    </div>
  );
}
