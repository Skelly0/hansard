import { Icon } from './Icon';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

/**
 * Page navigation with numbered buttons.
 * Styling: serif font, terracotta active indicator, minimal chrome.
 */
export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  className = '',
}: PaginationProps) {
  if (totalPages <= 1) return null;

  /** Generate page numbers with ellipsis */
  const getPages = (): (number | '...')[] => {
    const pages: (number | '...')[] = [];
    const delta = 1; // pages around current

    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
      return pages;
    }

    pages.push(1);

    if (currentPage > 3) pages.push('...');

    const start = Math.max(2, currentPage - delta);
    const end = Math.min(totalPages - 1, currentPage + delta);

    for (let i = start; i <= end; i++) pages.push(i);

    if (currentPage < totalPages - 2) pages.push('...');

    pages.push(totalPages);
    return pages;
  };

  const pages = getPages();

  return (
    <nav className={`flex items-center gap-1 ${className}`} aria-label="Pagination">
      {/* Previous */}
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="inline-flex items-center gap-1 pl-1.5 pr-2.5 h-8 text-label-ui text-text-secondary hover:text-text-primary
                   hover:bg-hover rounded-card transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Previous page"
      >
        <Icon name="chevron-left" size={16} />
        Prev
      </button>

      {/* Page numbers */}
      {pages.map((page, i) =>
        page === '...' ? (
          <span key={`ellipsis-${i}`} className="px-1 text-text-tertiary figure text-base" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            className={`min-w-[32px] h-8 px-2 rounded-card figure text-[1.0625rem] transition-colors ${
              page === currentPage
                ? 'bg-ink-primary text-text-inverse shadow-card'
                : 'text-text-secondary hover:text-text-primary hover:bg-hover'
            }`}
            aria-current={page === currentPage ? 'page' : undefined}
          >
            {page}
          </button>
        ),
      )}

      {/* Next */}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="inline-flex items-center gap-1 pl-2.5 pr-1.5 h-8 text-label-ui text-text-secondary hover:text-text-primary
                   hover:bg-hover rounded-card transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Next page"
      >
        Next
        <Icon name="chevron-right" size={16} />
      </button>
    </nav>
  );
}
