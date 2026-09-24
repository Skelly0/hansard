interface SkeletonProps {
  /** Width class or style */
  width?: string;
  /** Height class or style */
  height?: string;
  /** Make it circular */
  circle?: boolean;
  className?: string;
}

/** Warm paper shimmer, from the `.skeleton` class in main.css. */
export function Skeleton({
  width = 'w-full',
  height = 'h-4',
  circle = false,
  className = '',
}: SkeletonProps) {
  return (
    <div
      className={`skeleton ${width} ${height} ${circle ? 'rounded-full' : 'rounded-card'} ${className}`}
      aria-hidden="true"
    />
  );
}

/** Skeleton that mimics one cell of a MetricStrip */
export function MetricCardSkeleton() {
  return (
    <div className="bg-card px-5 py-5">
      <Skeleton width="w-20" height="h-3" className="mb-4" />
      <Skeleton width="w-14" height="h-8" />
    </div>
  );
}

/** Skeleton row for DataTable */
export function TableRowSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <div className="flex gap-4 px-5 py-4 border-b border-border-subtle last:border-0">
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton
          key={i}
          width={i === 0 ? 'w-24' : 'flex-1'}
          height="h-4"
        />
      ))}
    </div>
  );
}

/** Full-page skeleton: masthead, figures strip, ledger. */
export function PageSkeleton() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <Skeleton width="w-28" height="h-3" className="mb-4" />
      <Skeleton width="w-72 max-w-full" height="h-9" className="mb-3" />
      <Skeleton width="w-96 max-w-full" height="h-4" className="mb-6" />
      <div className="rule-masthead mb-8 opacity-30" aria-hidden="true" />
      <div className="grid grid-cols-3 gap-px bg-border-subtle border border-border-subtle rounded-card overflow-hidden mb-8">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
      <div className="card card-flush">
        <div className="h-10 bg-inset/60 border-b border-border" />
        <TableRowSkeleton />
        <TableRowSkeleton />
        <TableRowSkeleton />
        <TableRowSkeleton />
      </div>
    </div>
  );
}

/** Card-shaped skeleton */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card">
      <Skeleton width="w-3/4" height="h-5" className="mb-3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 ? 'w-1/2' : 'w-full'}
          height="h-3.5"
          className="mb-2"
        />
      ))}
    </div>
  );
}
