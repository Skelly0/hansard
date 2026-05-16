import { type ReactNode } from 'react';

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
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  /** Callback when a row is clicked */
  onRowClick?: (row: T) => void;
  /** Row key accessor */
  rowKey: (row: T) => string;
  /** Empty state message */
  emptyMessage?: string;
  /** Additional class on the wrapper */
  className?: string;
}

/**
 * Clean data table following the Hansard design system:
 * - No alternating row backgrounds
 * - 1px bottom border per row
 * - Column headers in uppercase small Lora (text-label-ui)
 * - Monospace for number columns
 * - Generous 12px vertical padding
 */
export function DataTable<T>({
  columns,
  data,
  onRowClick,
  rowKey,
  emptyMessage = 'No records found.',
  className = '',
}: DataTableProps<T>) {
  const alignClass = (align?: string) => {
    if (align === 'center') return 'text-center';
    if (align === 'right') return 'text-right';
    return 'text-left';
  };

  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`text-label-ui text-text-tertiary pb-3 pr-4 font-medium ${alignClass(col.align)}`}
                style={col.minWidth ? { minWidth: col.minWidth } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="text-body text-text-tertiary py-8 text-center italic"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, rowIdx) => (
              <tr
                key={rowKey(row)}
                className={`border-b border-border-subtle ${
                  onRowClick
                    ? 'cursor-pointer hover:bg-hover transition-colors'
                    : ''
                }`}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`py-3 pr-4 ${
                      col.mono ? 'font-mono text-[0.8125rem] leading-[1.5]' : 'text-body-sm'
                    } text-text-primary ${alignClass(col.align)}`}
                  >
                    {col.render
                      ? col.render(row, rowIdx)
                      : String((row as Record<string, unknown>)[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
