import { useSearch } from '@tanstack/react-router';

const ERROR_MESSAGES: Record<string, string> = {
  denied: "Sign-in cancelled. Try again when you're ready.",
};

export function Login() {
  const apiUrl = import.meta.env.VITE_API_URL || '/api';
  const search = useSearch({ strict: false }) as { error?: string };
  const errorCode = search?.error;
  const errorMessage = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? `Discord rejected the sign-in (${errorCode}). Try again.`)
    : null;

  return (
    <div className="bg-parchment min-h-screen flex items-center justify-center p-6">
      <div className="parchment-frame w-full max-w-md py-16 px-12 text-center">
        <div className="text-mono text-text-tertiary text-xs tracking-[0.15em] uppercase mb-6">
          — Per Order of the Chamber —
        </div>

        <h1 className="font-display italic text-[2.5rem] leading-tight text-text-primary mb-4">
          Hansard
        </h1>

        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="h-px w-8 bg-border-strong" />
          <div className="text-border-strong text-base">✦</div>
          <div className="h-px w-8 bg-border-strong" />
        </div>

        <p className="font-body italic text-body text-text-secondary mb-8 leading-relaxed">
          "Be it known that the record of these proceedings is faithfully kept."
        </p>

        {errorMessage && (
          <p className="text-body-sm italic text-status-rejected mb-4">
            {errorMessage}
          </p>
        )}

        <a href={`${apiUrl}/auth/discord`} className="btn-primary inline-block">
          Sign in with Discord
        </a>

        <p className="text-mono text-text-tertiary text-xs tracking-wider mt-8">
          DPS · SEASON MANAGER
        </p>
      </div>
    </div>
  );
}
