import { type ReactNode, type KeyboardEvent } from 'react';
import { useIsWide } from '../../hooks/useMediaQuery';
import { EmptyState } from './PageHeader';

export interface Column<T> {
  key: string;
  header: string;
  /** Render cell content. Falls back to `row[key]` as string */
  render?: (row: T, index: number) => ReactNode;
  /** Apply monospace font to this column */
  mono?: boolean;
  /** Column alignment */
  align?: 'left' | 'center' | 'right';
  /** Minimum width */
  minWidth?: string;
  /** On phones this column is the card's heading (defaults to the `title` column, else the first). */
  primary?: boolean;
  /** Leave this column out of the stacked phone layout. */
  hideOnMobile?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  /** Callback when a row is clicked (or activated with Enter/Space) */
  onRowClick?: (row: T) => void;
  /** Row key accessor */
  rowKey: (row: T) => string;
  /** Empty state message */
  emptyMessage?: ReactNode;
  /** Additional class on the wrapper */
  className?: string;
  /** Accessible table caption (visually hidden). */
  caption?: string;
}

function cellValue<T>(col: Column<T>, row: T, index: number): ReactNode {
  if (col.render) return col.render(row, index);
  const raw = (row as Record<string, unknown>)[col.key];
  return raw === null || raw === undefined || raw === '' ? '—' : String(raw);
}

/**
 * A ledger: tracked-caps header band, hairline rows, monospace figures.
 * Cells carry their own edge padding, so place it in a `card card-flush`
 * sheet. Below `md` the rows become stacked records so nothing is squeezed
 * into unreadable columns on a phone.
 */
export function DataTable<T>({
  columns,
  data,
  onRowClick,
  rowKey,
  emptyMessage = 'No records found.',
  className = '',
  caption,
}: DataTableProps<T>) {
  const isWide = useIsWide();

  const alignClass = (align?: string) => {
    if (align === 'center') return 'text-center';
    if (align === 'right') return 'text-right';
    return 'text-left';
  };

  const activate = (row: T) => (e: KeyboardEvent) => {
    if (!onRowClick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowClick(row);
    }
  };

  if (data.length === 0) {
    return <EmptyState title={emptyMessage} className={className} />;
  }

  if (!isWide) {
    const primaryIndex = Math.max(
      0,
      columns.findIndex((c) => c.primary) >= 0
        ? columns.findIndex((c) => c.primary)
        : columns.findIndex((c) => c.key === 'title'),
    );
    const primary = columns[primaryIndex];
    const rest = columns.filter((c, i) => i !== primaryIndex && !c.hideOnMobile);

    return (
      <ul className={`divide-y divide-border-subtle ${className}`} aria-label={caption}>
        {data.map((row, rowIdx) => (
          <li
            key={rowKey(row)}
            className={`px-4 py-3.5 ${onRowClick ? 'cursor-pointer active:bg-hover transition-colors' : ''}`}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            onKeyDown={onRowClick ? activate(row) : undefined}
            tabIndex={onRowClick ? 0 : undefined}
          >
            <div className="text-body-sm text-text-primary mb-2">{cellValue(primary, row, rowIdx)}</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 items-baseline">
              {rest.map((col) => (
                <div key={col.key} className="contents">
                  <dt className="text-label-ui text-text-tertiary">{col.header}</dt>
                  <dd className={`min-w-0 ${col.mono ? 'font-mono text-[0.8125rem]' : 'text-body-sm'} text-text-primary`}>
                    {cellValue(col, row, rowIdx)}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-border bg-inset/60">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`text-label-ui text-text-tertiary py-2.5 px-3 first:pl-5 last:pr-5 whitespace-nowrap ${alignClass(col.align)}`}
                style={col.minWidth ? { minWidth: col.minWidth } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIdx) => (
            <tr
              key={rowKey(row)}
              className={`border-b border-border-subtle last:border-0 ${
                onRowClick
                  ? 'cursor-pointer hover:bg-hover/60 focus-visible:bg-hover transition-colors'
                  : ''
              }`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? activate(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`py-3.5 px-3 first:pl-5 last:pr-5 align-middle ${
                    col.mono ? 'font-mono text-[0.8125rem] leading-[1.5]' : 'text-body-sm'
                  } text-text-primary ${alignClass(col.align)}`}
                >
                  {cellValue(col, row, rowIdx)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
