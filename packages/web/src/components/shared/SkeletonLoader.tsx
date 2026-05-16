interface SkeletonProps {
  /** Width class or style */
  width?: string;
  /** Height class or style */
  height?: string;
  /** Make it circular */
  circle?: boolean;
  className?: string;
}

/**
 * Warm cream shimmer skeleton — uses the `.skeleton` class from main.css
 * which animates a linear-gradient from #F2F0E8 to #FAF9F5.
 */
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

/** Skeleton that mimics a MetricCard */
export function MetricCardSkeleton() {
  return (
    <div className="card border-l-border-subtle">
      <Skeleton width="w-20" height="h-3" className="mb-3" />
      <Skeleton width="w-16" height="h-7" />
    </div>
  );
}

/** Skeleton row for DataTable */
export function TableRowSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <div className="flex gap-4 py-3 border-b border-border-subtle">
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

/** Full-page skeleton for detail views */
export function PageSkeleton() {
  return (
    <div className="p-8 animate-pulse">
      <Skeleton width="w-64" height="h-8" className="mb-2" />
      <Skeleton width="w-96" height="h-4" className="mb-8" />
      <div className="grid grid-cols-3 gap-4 mb-8">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
      <div className="space-y-3">
        <TableRowSkeleton />
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
    <div className="card border-l-border-subtle">
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
