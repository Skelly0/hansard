import { ApiError } from '../../api/client';
import { Icon } from './Icon';

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
    <div role="alert" className={`notice notice-danger flex items-start gap-3 ${className}`}>
      <Icon name="alert" size={18} className="text-status-rejected mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <h2 className="text-heading-2 text-text-primary mb-1">{title}</h2>
        <p className="text-body-sm text-text-secondary break-words">{messageFor(error)}</p>
      </div>
    </div>
  );
}
