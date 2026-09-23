interface TimelineStage {
  key: string;
  label: string;
  /** Date/time string or description */
  detail?: string;
}

interface StatusTimelineProps {
  stages: TimelineStage[];
  /** Index of the current active stage */
  currentIndex: number;
  /** Render horizontally (default false = vertical) */
  horizontal?: boolean;
  className?: string;
}

/**
 * Status timeline with connected dots.
 * - Past stages: filled dot, tertiary text
 * - Current stage: filled terracotta dot with pulse animation, primary text
 * - Future stages: hollow dot, subtle border colour
 */
export function StatusTimeline({
  stages,
  currentIndex,
  horizontal = false,
  className = '',
}: StatusTimelineProps) {
  if (horizontal) {
    return (
      <ol className={`flex items-start gap-0 overflow-x-auto pb-1 ${className}`} aria-label="Progress">
        {stages.map((stage, i) => {
          const isPast = i < currentIndex;
          const isCurrent = i === currentIndex;
          const isFuture = i > currentIndex;

          return (
            <li key={stage.key} className="flex items-center" aria-current={isCurrent ? 'step' : undefined}>
              {/* Stage */}
              <div className="flex flex-col items-center min-w-[88px] px-1">
                {/* Dot */}
                <div className="relative flex items-center justify-center">
                  <div
                    className={`w-3 h-3 rounded-full border-2 ${
                      isCurrent
                        ? 'bg-accent-primary border-accent-primary animate-pulse-subtle'
                        : isPast
                        ? 'bg-text-tertiary border-text-tertiary'
                        : 'bg-card border-border-strong'
                    }`}
                  />
                </div>
                {/* Label */}
                <span
                  className={`text-label-ui mt-2 text-center ${
                    isCurrent
                      ? 'text-text-primary'
                      : isPast
                      ? 'text-text-tertiary'
                      : 'text-text-tertiary opacity-70'
                  }`}
                >
                  {stage.label}
                </span>
                {stage.detail && (
                  <span className={`font-mono text-xs mt-0.5 text-center ${
                    isFuture ? 'text-text-tertiary opacity-70' : 'text-text-tertiary'
                  }`}>
                    {stage.detail}
                  </span>
                )}
              </div>
              {/* Connector line */}
              {i < stages.length - 1 && (
                <div
                  className={`h-[2px] w-8 mt-1.5 flex-shrink-0 ${
                    i < currentIndex ? 'bg-text-tertiary' : 'bg-border-subtle'
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    );
  }

  // Vertical layout
  return (
    <div className={`flex flex-col ${className}`}>
      {stages.map((stage, i) => {
        const isPast = i < currentIndex;
        const isCurrent = i === currentIndex;
        const isFuture = i > currentIndex;

        return (
          <div key={stage.key} className="flex items-start">
            {/* Dot + connector column */}
            <div className="flex flex-col items-center mr-3">
              <div
                className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${
                  isCurrent
                    ? 'bg-accent-primary border-accent-primary animate-pulse-subtle'
                    : isPast
                    ? 'bg-text-tertiary border-text-tertiary'
                    : 'bg-card border-border-strong'
                }`}
              />
              {i < stages.length - 1 && (
                <div
                  className={`w-[2px] flex-1 min-h-[24px] ${
                    i < currentIndex ? 'bg-text-tertiary' : 'bg-border-subtle'
                  }`}
                />
              )}
            </div>
            {/* Label */}
            <div className="pb-4">
              <span
                className={`text-body-sm font-medium ${
                  isCurrent
                    ? 'text-text-primary'
                    : isPast
                    ? 'text-text-tertiary'
                    : 'text-text-tertiary opacity-70'
                }`}
              >
                {stage.label}
              </span>
              {stage.detail && (
                <span className={`block font-mono text-xs ${
                  isFuture ? 'text-text-tertiary opacity-70' : 'text-text-tertiary'
                }`}>
                  {stage.detail}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
