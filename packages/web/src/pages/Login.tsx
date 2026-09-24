import { useSearch } from '@tanstack/react-router';
import { API_BASE } from '../api/client';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { Ornament } from '../components/shared/PageHeader';

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
      <main className="parchment-frame w-full max-w-lg bg-card/70 shadow-modal-warm rounded-card py-14 sm:py-16 px-9 sm:px-14 text-center animate-rise-in">
        <p className="text-label-ui text-[0.75rem] tracking-[0.24em] text-text-tertiary">The Official Report</p>
        <div className="rule-masthead my-4" aria-hidden="true" />

        <h1 className="font-display italic font-medium text-[3.5rem] sm:text-[4.25rem] leading-[0.95] tracking-tight text-text-primary">
          Hansard
        </h1>
        <p className="text-dek text-text-secondary mt-3">
          Proceedings of the chamber, faithfully kept
        </p>

        <Ornament className="my-7" />

        <p className="font-body italic text-body text-text-secondary mb-8 leading-relaxed max-w-sm mx-auto">
          &ldquo;Be it known that the record of these proceedings is faithfully kept.&rdquo;
        </p>

        {errorMessage && (
          <p role="alert" className="notice notice-danger text-body-sm text-left mb-5">
            {errorMessage}
          </p>
        )}

        <a href={`${API_BASE}/auth/discord`} className="btn-primary px-6 py-3 text-base">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M19.3 5.3A16.6 16.6 0 0 0 15.2 4l-.5 1a15.4 15.4 0 0 0-5.4 0l-.5-1a16.6 16.6 0 0 0-4.1 1.3C2.1 9.2 1.4 13 1.7 16.8a16.8 16.8 0 0 0 5 2.6l1.1-1.7a10.8 10.8 0 0 1-1.7-.8l.4-.3a11.9 11.9 0 0 0 10.9 0l.4.3c-.5.3-1.1.6-1.7.8l1.1 1.7a16.7 16.7 0 0 0 5-2.6c.4-4.4-.7-8.2-2.9-11.5ZM8.7 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" />
          </svg>
          Sign in with Discord
        </a>

        <p className="text-body-sm text-text-tertiary mt-6 leading-relaxed max-w-sm mx-auto">
          The record of the season: bills and votes, offices and parties, and the characters who hold them.
        </p>

        <div className="rule-masthead mt-9 mb-4 rotate-180" aria-hidden="true" />
        <p className="text-label-ui text-[0.6875rem] tracking-[0.2em] text-text-tertiary">
          Dynamic Political Simulation
        </p>
      </main>
    </div>
  );
}
