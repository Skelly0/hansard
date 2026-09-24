import type { KeyboardEvent, ReactNode } from 'react';

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  /** Tooltip. */
  title?: string;
}

/**
 * ARIA tabs with a roving tab stop: arrow keys move between tabs, Home/End
 * jump to the ends. Pair with `tabPanelProps(idPrefix, value)` on the panel.
 * `value` may match no tab (e.g. a preset overridden by a filter); the first
 * tab then keeps the tab stop.
 */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
  idPrefix,
  className = 'mb-6',
}: {
  items: TabItem<K>[];
  value: K | null;
  onChange: (key: K) => void;
  label: string;
  idPrefix: string;
  className?: string;
}) {
  const selectedIndex = items.findIndex((t) => t.key === value);
  const stop = selectedIndex >= 0 ? selectedIndex : 0;

  const onKeyDown = (e: KeyboardEvent) => {
    const i = items.findIndex((t) => `${idPrefix}-tab-${t.key}` === (e.target as HTMLElement).id);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next].key);
    document.getElementById(`${idPrefix}-tab-${items[next].key}`)?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className={`tab-list ${className}`} onKeyDown={onKeyDown}>
      {items.map((tab, i) => (
        <button
          key={tab.key}
          type="button"
          id={`${idPrefix}-tab-${tab.key}`}
          role="tab"
          aria-selected={tab.key === value}
          aria-controls={`${idPrefix}-panel`}
          tabIndex={i === stop ? 0 : -1}
          title={tab.title}
          onClick={() => onChange(tab.key)}
          className="tab"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Props for the element holding the active tab's content. */
export function tabPanelProps(idPrefix: string, value: string | null) {
  return {
    id: `${idPrefix}-panel`,
    role: 'tabpanel' as const,
    'aria-labelledby': value ? `${idPrefix}-tab-${value}` : undefined,
  };
}
