import { Link } from '@tanstack/react-router';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { Ornament } from '../components/shared/PageHeader';

/**
 * Router-level 404. Rendered outside the app shell (the root route has no
 * layout), so it carries its own parchment frame like the login page.
 */
export function NotFound() {
  useDocumentTitle('Not found');
  return (
    <div className="bg-parchment min-h-screen flex items-center justify-center p-4 sm:p-6">
      <main className="parchment-frame w-full max-w-lg bg-card/70 shadow-modal-warm rounded-card py-14 sm:py-16 px-9 sm:px-14 text-center animate-rise-in">
        <p className="text-label-ui text-[0.75rem] tracking-[0.24em] text-text-tertiary">Error 404</p>
        <div className="rule-masthead my-4" aria-hidden="true" />
        <h1 className="font-display italic font-medium text-[2.75rem] sm:text-[3.25rem] leading-[1] tracking-tight text-text-primary">
          No such record
        </h1>
        <Ornament className="my-7" />
        <p className="font-body italic text-body text-text-secondary mb-8 leading-relaxed max-w-sm mx-auto">
          The clerk searched the archive and found nothing filed under this address.
        </p>
        <Link to="/" className="btn-primary px-6 py-3 text-base">
          Return to the chamber
        </Link>
      </main>
    </div>
  );
}
