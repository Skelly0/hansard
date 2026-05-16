import { ApiError } from '../../api/client';

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'An unknown error occurred.';
}

export function QueryErrorState({
  title = 'Could not load data',
  error,
  className = '',
}: {
  title?: string;
  error: unknown;
  className?: string;
}) {
  return (
    <div className={`card border-l-status-rejected ${className}`}>
      <h2 className="text-heading-2 text-text-primary mb-2">{title}</h2>
      <p className="text-body-sm text-status-rejected break-words">
        {messageFor(error)}
      </p>
    </div>
  );
}
