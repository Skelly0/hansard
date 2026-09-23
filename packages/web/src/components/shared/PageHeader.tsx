import { Fragment, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

export interface Crumb {
  label: ReactNode;
  /** Router path; omit for the current page. */
  to?: string;
}

interface PageHeaderProps {
  title: ReactNode;
  /** Plain-text tab title; defaults to `title` when that is a string. */
  documentTitle?: string;
  subtitle?: ReactNode;
  /** Small row above the title — tags, record numbers. */
  eyebrow?: ReactNode;
  /** Buttons on the right (wrap below the title on phones). */
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  className?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 sm:mb-4">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-text-tertiary">
        {items.map((crumb, i) => (
          <Fragment key={i}>
            {i > 0 && <li aria-hidden="true" className="text-border-strong">/</li>}
            <li className="min-w-0">
              {crumb.to ? (
                <Link to={crumb.to} className="hover:text-accent-primary transition-colors">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current="page" className="text-text-secondary truncate block max-w-[60vw] sm:max-w-md">
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

export function PageHeader({
  title,
  documentTitle,
  subtitle,
  eyebrow,
  actions,
  breadcrumbs,
  className = 'mb-6',
}: PageHeaderProps) {
  useDocumentTitle(documentTitle ?? (typeof title === 'string' ? title : null));

  return (
    <header className={className}>
      {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <div className="flex flex-wrap items-center gap-2 mb-2">{eyebrow}</div>}
          <h1 className="text-display text-text-primary break-words">{title}</h1>
          {subtitle && (
            <p className="text-body-sm text-text-tertiary mt-1">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 sm:flex-shrink-0 sm:justify-end">
            {actions}
          </div>
        )}
      </div>
    </header>
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
      <div className="text-xl text-accent-primary mb-2" aria-hidden="true">✦</div>
      <p className="text-body text-text-secondary italic">{title}</p>
      {children && <div className="text-body-sm text-text-tertiary mt-2">{children}</div>}
    </div>
  );
}
