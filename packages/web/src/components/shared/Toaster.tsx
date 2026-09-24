import { useToastStore, type ToastTone } from '../../lib/toast';
import { Icon, type IconName } from './Icon';

const TONE: Record<ToastTone, { rail: string; mark: string; icon: IconName }> = {
  success: { rail: 'bg-status-passed', mark: 'text-status-passed', icon: 'check' },
  error: { rail: 'bg-status-rejected', mark: 'text-status-rejected', icon: 'alert' },
  info: { rail: 'bg-accent-voting', mark: 'text-accent-voting', icon: 'info' },
};

/** Fixed notification stack; announced politely (errors assertively). */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      className="print:hidden fixed z-[150] bottom-3 inset-x-3 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96 flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
      aria-relevant="additions"
    >
      {toasts.map((t) => {
        const tone = TONE[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto bg-card border border-border-subtle rounded-card shadow-modal-warm overflow-hidden flex animate-rise-in"
          >
            <div className={`w-[3px] flex-shrink-0 ${tone.rail}`} aria-hidden="true" />
            <div className="flex items-start gap-3 px-4 py-3 flex-1 min-w-0">
              <Icon name={tone.icon} size={18} className={`mt-0.5 ${tone.mark}`} />
              <div className="min-w-0 flex-1">
                <p className="text-body-sm font-medium text-text-primary">{t.title}</p>
                {t.description && <p className="text-body-sm text-text-secondary mt-0.5 break-words">{t.description}</p>}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="-mr-1 p-1 rounded-card text-text-tertiary hover:text-text-primary hover:bg-hover transition-colors"
                aria-label="Dismiss notification"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
