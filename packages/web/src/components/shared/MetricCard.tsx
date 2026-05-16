interface MetricCardProps {
  label: string;
  value: string | number;
  /** Tailwind text colour class for the value (e.g. "text-accent-bills") */
  color?: string;
  /** Optional sub-label or change indicator below the number */
  subtitle?: string;
  /** System accent for the left border */
  borderColor?: string;
  className?: string;
}

/**
 * Metric display card: large monospace number with label above.
 * Uses the card component base with system accent left border.
 */
export function MetricCard({
  label,
  value,
  color = 'text-accent-primary',
  subtitle,
  borderColor = 'border-border-subtle',
  className = '',
}: MetricCardProps) {
  return (
    <div className={`card ${borderColor} ${className}`}>
      <p className="text-label-ui text-text-tertiary mb-2">{label}</p>
      <p className={`font-mono text-2xl leading-tight ${color}`}>
        {value}
      </p>
      {subtitle && (
        <p className="text-body-sm text-text-tertiary mt-1">{subtitle}</p>
      )}
    </div>
  );
}
