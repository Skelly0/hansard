import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { Icon } from './Icon';

/** Row of filters that wraps gracefully; stacks to full-width fields on phones. */
export function FilterBar({ children, className = 'mb-5' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`grid grid-cols-2 gap-x-3 gap-y-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-3 ${className}`} role="search">
      {children}
    </div>
  );
}

/** A labelled filter control (select, input). The label sits above on phones, inline on wider screens. */
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1 min-w-0 sm:flex-row sm:items-center sm:gap-2 [&>select]:w-full sm:[&>select]:w-auto">
      <label htmlFor={id} className="text-label-ui text-text-tertiary">{label}</label>
      <FieldIdContext id={id}>{children}</FieldIdContext>
    </div>
  );
}

/** Attach the generated id to the single child control so the label targets it. */
function FieldIdContext({ id, children }: { id: string; children: ReactNode }) {
  if (isValidElement(children) && !(children as ReactElement<{ id?: string }>).props.id) {
    return cloneElement(children as ReactElement<{ id?: string }>, { id });
  }
  return <>{children}</>;
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  label,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={`relative col-span-2 w-full sm:flex-1 sm:min-w-[220px] sm:max-w-sm ${className}`}>
      <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="field w-full pl-9"
      />
    </div>
  );
}
