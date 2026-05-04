import { useEffect, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Tailwind bg class for the top accent rail (e.g. "bg-accent-primary") */
  railClass?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Optional sizing override */
  maxWidth?: string;
}

/**
 * Generic warm-serif modal — top accent rail, soft shadow, escape closes.
 * Mirrors the look of ModActionModal so admin dialogs feel consistent.
 */
export function Modal({
  open,
  onClose,
  title,
  railClass = 'bg-accent-primary',
  children,
  footer,
  maxWidth = 'max-w-md',
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`bg-card rounded-card shadow-modal-warm w-full ${maxWidth} overflow-hidden`}>
        <div className={`h-[3px] ${railClass}`} />
        <div className="p-6">
          <div className="flex items-baseline justify-between mb-5">
            <h2 className="text-heading-1 text-text-primary">{title}</h2>
            <button
              onClick={onClose}
              className="text-text-tertiary hover:text-text-primary text-xl leading-none transition-colors duration-150"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div>{children}</div>
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  /** Use 'danger' for destructive actions (red rail + red submit). */
  variant?: 'default' | 'danger';
  pending?: boolean;
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  variant = 'default',
  pending = false,
}: ConfirmModalProps) {
  const rail = variant === 'danger' ? 'bg-status-rejected' : 'bg-accent-primary';
  const btn = variant === 'danger'
    ? 'bg-status-rejected hover:bg-status-rejected/90 text-text-inverse'
    : 'btn-primary';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      railClass={rail}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className={`px-4 py-1.5 rounded-card font-medium disabled:opacity-50 transition-colors duration-150 ${btn}`}
          >
            {pending ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-body text-text-secondary">{message}</div>
    </Modal>
  );
}
