import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog behaviour shared by every modal: Escape closes, Tab is trapped inside
 * the panel, the page behind stops scrolling, the first field (or the panel)
 * takes focus on open, and focus returns to the trigger on close.
 */
export function useDialogBehaviour(
  open: boolean,
  onClose: () => void,
  panelRef: React.RefObject<HTMLElement>,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    // Prefer an explicit autofocus target, then the first form field, then
    // the panel itself — never the close button, which is easy to hit by
    // accident with Enter.
    const initial =
      panel?.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ??
      panel?.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), textarea, select') ??
      panel;
    initial?.focus({ preventScroll: true });

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('aria-hidden'),
      );
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [open, panelRef]);
}

interface DialogFrameProps {
  onClose: () => void;
  title: ReactNode;
  /** Small mono label above the title (e.g. the action type). */
  eyebrow?: ReactNode;
  /** Tailwind bg class for the top accent rail (e.g. "bg-accent-primary") */
  railClass?: string;
  maxWidth?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** The visual shell of a dialog. Only mounted while open. */
function DialogFrame({
  onClose,
  title,
  eyebrow,
  railClass = 'bg-accent-primary',
  maxWidth = 'max-w-md',
  children,
  footer,
}: DialogFrameProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogBehaviour(true, onClose, panelRef);

  // Portalled to <body>: an ancestor with a transform (e.g. the route
  // fade-in) would otherwise become the containing block for `fixed` and
  // clip the backdrop to the page content.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-[#1b140c]/45 backdrop-blur-[2px] p-0 sm:p-4 animate-fade-in"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`bg-card border border-border-subtle rounded-t-card sm:rounded-card shadow-modal-warm w-full ${maxWidth} max-h-[92vh] flex flex-col overflow-hidden focus:outline-none animate-rise-in`}
      >
        <div className={`h-[3px] flex-shrink-0 ${railClass}`} />
        <div className="px-5 pt-5 sm:px-6 sm:pt-6 flex items-start justify-between gap-4 flex-shrink-0">
          <div className="min-w-0">
            {eyebrow && (
              <div className="text-label-ui text-text-tertiary mb-1">
                {eyebrow}
              </div>
            )}
            <h2 id={titleId} className="text-heading-1 text-text-primary">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1.5 -mt-1 p-1.5 rounded-card text-text-tertiary hover:text-text-primary hover:bg-hover transition-colors duration-150"
            aria-label="Close"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="px-5 pt-4 pb-5 sm:px-6 sm:pb-6 overflow-y-auto">{children}</div>
        {/* Outside the scroll area, so the actions stay in reach on long forms. */}
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 px-5 py-3.5 sm:px-6 border-t border-border-subtle bg-inset/50 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

interface ModalProps extends Omit<DialogFrameProps, 'title'> {
  open: boolean;
  title: ReactNode;
}

/**
 * Generic warm-serif modal — top accent rail, soft shadow, escape closes,
 * focus trapped while open. On phones it docks to the bottom as a sheet.
 */
export function Modal({ open, ...props }: ModalProps) {
  if (!open) return null;
  return <DialogFrame {...props} />;
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
  const btn = variant === 'danger' ? 'btn-danger' : 'btn-primary';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      railClass={rail}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={btn}
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
