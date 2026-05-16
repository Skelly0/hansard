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
        className="px-2.5 py-1.5 text-body-sm text-text-secondary hover:text-text-primary
                   hover:bg-hover rounded-card transition-colors disabled:opacity-30 disabled:cursor-not-allowed
                   font-body"
        aria-label="Previous page"
      >
        Prev
      </button>

      {/* Page numbers */}
      {pages.map((page, i) =>
        page === '...' ? (
          <span key={`ellipsis-${i}`} className="px-1 text-text-tertiary font-body text-sm">
            ...
          </span>
        ) : (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            className={`min-w-[32px] h-8 px-2 rounded-card text-sm font-body transition-colors ${
              page === currentPage
                ? 'bg-accent-primary text-text-inverse font-medium'
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
        className="px-2.5 py-1.5 text-body-sm text-text-secondary hover:text-text-primary
                   hover:bg-hover rounded-card transition-colors disabled:opacity-30 disabled:cursor-not-allowed
                   font-body"
        aria-label="Next page"
      >
        Next
      </button>
    </nav>
  );
}
