import { useSearch } from '@tanstack/react-router';
import { API_BASE } from '../api/client';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const ERROR_MESSAGES: Record<string, string> = {
  denied: "Sign-in cancelled. Try again when you're ready.",
  access_denied: "Sign-in cancelled. Try again when you're ready.",
  invalid_state: 'That sign-in link expired or was opened in another tab. Please start again.',
  missing_code: 'Discord did not complete the sign-in. Please try again.',
  token_exchange_failed: 'Discord could not confirm the sign-in. Please try again.',
  profile_fetch_failed: 'We could not read your Discord profile. Please try again.',
  server_error: 'Something went wrong on our side while signing you in. Please try again shortly.',
};

export function Login() {
  useDocumentTitle('Sign in');
  const search = useSearch({ strict: false }) as { error?: string };
  const errorCode = search?.error;
  const errorMessage = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? `Discord rejected the sign-in (${errorCode}). Try again.`)
    : null;

  return (
    <div className="bg-parchment min-h-screen flex items-center justify-center p-4 sm:p-6">
      <main className="parchment-frame w-full max-w-md py-14 sm:py-16 px-8 sm:px-12 text-center">
        <div className="text-mono text-text-tertiary text-xs tracking-[0.15em] uppercase mb-6">
          — Per Order of the Chamber —
        </div>

        <h1 className="font-display italic text-[2.5rem] leading-tight text-text-primary mb-4">
          Hansard
        </h1>

        <div className="flex items-center justify-center gap-3 mb-6" aria-hidden="true">
          <div className="h-px w-8 bg-border-strong" />
          <div className="text-border-strong text-base">✦</div>
          <div className="h-px w-8 bg-border-strong" />
        </div>

        <p className="font-body italic text-body text-text-secondary mb-8 leading-relaxed">
          &ldquo;Be it known that the record of these proceedings is faithfully kept.&rdquo;
        </p>

        {errorMessage && (
          <p role="alert" className="text-body-sm italic text-status-rejected mb-4">
            {errorMessage}
          </p>
        )}

        <a href={`${API_BASE}/auth/discord`} className="btn-primary inline-flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M19.3 5.3A16.6 16.6 0 0 0 15.2 4l-.5 1a15.4 15.4 0 0 0-5.4 0l-.5-1a16.6 16.6 0 0 0-4.1 1.3C2.1 9.2 1.4 13 1.7 16.8a16.8 16.8 0 0 0 5 2.6l1.1-1.7a10.8 10.8 0 0 1-1.7-.8l.4-.3a11.9 11.9 0 0 0 10.9 0l.4.3c-.5.3-1.1.6-1.7.8l1.1 1.7a16.7 16.7 0 0 0 5-2.6c.4-4.4-.7-8.2-2.9-11.5ZM8.7 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" />
          </svg>
          Sign in with Discord
        </a>

        <p className="text-body-sm text-text-tertiary mt-6 leading-relaxed">
          The record of the season: bills and votes, offices and parties, and the characters who hold them.
        </p>

        <p className="text-mono text-text-tertiary text-xs tracking-wider mt-8">
          DPS · SEASON MANAGER
        </p>
      </main>
    </div>
  );
}
