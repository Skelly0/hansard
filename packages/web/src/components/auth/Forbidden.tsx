import { Link } from '@tanstack/react-router';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

export function Forbidden() {
  useDocumentTitle('Out of bounds');
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="text-center max-w-sm">
        <div className="text-2xl text-accent-moderation mb-3" aria-hidden="true">✦</div>
        <h1 className="text-display mb-2">Out of bounds</h1>
        <p className="text-body text-text-secondary">
          You don't have access to this part of the chamber.
        </p>
        <p className="text-mono text-text-tertiary text-xs mt-6">
          If this seems wrong, ask staff to check your permissions.
        </p>
        <Link to="/" className="btn-secondary inline-block mt-6">Back to the dashboard</Link>
      </div>
    </div>
  );
}
