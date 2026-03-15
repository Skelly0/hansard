export function Login() {
  const apiUrl = import.meta.env.VITE_API_URL || '/api';

  return (
    <div className="flex items-center justify-center min-h-screen -mt-16">
      <div className="text-center max-w-sm">
        <h1 className="text-display mb-3">Hansard</h1>
        <p className="text-body text-text-secondary mb-8">
          Sign in with your Discord account to access the DPS Season Manager.
        </p>
        <a
          href={`${apiUrl}/auth/discord`}
          className="btn-primary inline-block"
        >
          Sign in with Discord
        </a>
        <p className="text-mono text-text-tertiary text-xs mt-6">
          DPS Season Manager
        </p>
      </div>
    </div>
  );
}
