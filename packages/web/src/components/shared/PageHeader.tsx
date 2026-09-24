import { Fragment, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { ACCENT_FILL, moduleForPath } from '../layout/navItems';

export interface Crumb {
  label: ReactNode;
  /** Router path; omit for the current page. */
  to?: string;
}

interface PageHeaderProps {
  title: ReactNode;
  /** Plain-text tab title; defaults to `title` when that is a string. */
  documentTitle?: string;
  /** Italic standfirst under the title. */
  subtitle?: ReactNode;
  /** Small row above the title — tags, record numbers. */
  eyebrow?: ReactNode;
  /**
   * Tracked-caps line above everything. Defaults to the sidebar section the
   * page belongs to (e.g. "Legislature"); pass `false` to hide it. Ignored
   * when breadcrumbs are shown, which already say where you are.
   */
  kicker?: ReactNode | false;
  /** Buttons on the right (wrap below the title on phones). */
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  /** Thick-thin masthead rule under the header. */
  rule?: boolean;
  className?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label-ui text-text-tertiary">
        {items.map((crumb, i) => (
          <Fragment key={i}>
            {i > 0 && <li aria-hidden="true" className="text-border-strong font-normal">/</li>}
            <li className="min-w-0">
              {crumb.to ? (
                <Link to={crumb.to} className="link-quiet">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current="page" className="text-text-secondary truncate block max-w-[55vw] sm:max-w-sm">
                  {crumb.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

/** Diamond on a hairline: the house ornament for dividers and empty states. */
export function Ornament({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-3 ${className}`} aria-hidden="true">
      <span className="h-px w-10 bg-border-strong/70" />
      <svg width="9" height="9" viewBox="0 0 10 10" className="text-accent-primary">
        <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
      </svg>
      <span className="h-px w-10 bg-border-strong/70" />
    </div>
  );
}

export function PageHeader({
  title,
  documentTitle,
  subtitle,
  eyebrow,
  kicker,
  actions,
  breadcrumbs,
  rule = true,
  className = 'mb-7 sm:mb-9',
}: PageHeaderProps) {
  useDocumentTitle(documentTitle ?? (typeof title === 'string' ? title : null));

  const module = typeof window === 'undefined' ? null : moduleForPath(window.location.pathname);
  const kickerContent = kicker === false ? null : kicker ?? module?.sectionLabel ?? null;
  const showCrumbs = !!breadcrumbs && breadcrumbs.length > 0;

  return (
    <header className={className}>
      {showCrumbs ? (
        <Breadcrumbs items={breadcrumbs!} />
      ) : kickerContent ? (
        <p className="flex items-center gap-2 text-label-ui text-text-tertiary mb-3">
          <span className={`w-1.5 h-1.5 rotate-45 ${ACCENT_FILL[module?.accent ?? 'primary']}`} aria-hidden="true" />
          {kickerContent}
        </p>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <div className="flex flex-wrap items-center gap-2 mb-2.5">{eyebrow}</div>}
          <h1 className="text-display text-text-primary break-words">{title}</h1>
          {subtitle && <div className="text-dek text-text-secondary mt-2 max-w-3xl">{subtitle}</div>}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 sm:flex-shrink-0 sm:justify-end sm:pb-1">
            {actions}
          </div>
        )}
      </div>
      {rule && <div className="rule-masthead mt-5 sm:mt-6" aria-hidden="true" />}
    </header>
  );
}

/**
 * A section title with a hairline running to the margin, and an optional
 * action (link, button) at the far end.
 */
export function SectionHeading({
  children,
  action,
  id,
  as: Tag = 'h2',
  size = 'md',
  className = '',
}: {
  children: ReactNode;
  action?: ReactNode;
  id?: string;
  as?: 'h2' | 'h3';
  /** `lg`/`md` are Crimson headings; `sm` is tracked capitals for side panels. */
  size?: 'lg' | 'md' | 'sm';
  className?: string;
}) {
  return (
    <div className={`section-head ${className}`}>
      <Tag
        id={id}
        className={
          size === 'sm'
            ? 'text-label-ui text-text-secondary'
            : size === 'lg'
              ? 'text-heading-1 text-text-primary'
              : 'text-heading-2 text-text-primary'
        }
      >
        {children}
      </Tag>
      {action && <div className="section-head-action text-body-sm">{action}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  className = '',
}: {
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`text-center py-10 px-4 ${className}`}>
      <Ornament className="mb-4" />
      <p className="text-dek text-text-secondary">{title}</p>
      {children && <div className="text-body-sm text-text-tertiary mt-2 max-w-md mx-auto">{children}</div>}
    </div>
  );
}
