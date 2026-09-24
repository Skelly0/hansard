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

function Marker({ state }: { state: 'past' | 'current' | 'future' }) {
  if (state === 'past') {
    return (
      <span className="relative z-10 flex items-center justify-center w-4 h-4 rounded-full bg-text-secondary text-page">
        <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
          <path d="m2.5 6.2 2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span className="relative z-10 flex items-center justify-center w-4 h-4">
        <span className="absolute inset-[-5px] rounded-full bg-accent-primary/20 animate-pulse-subtle" aria-hidden="true" />
        <span className="w-4 h-4 rounded-full bg-accent-primary ring-2 ring-card" />
      </span>
    );
  }
  return <span className="relative z-10 w-4 h-4 rounded-full border-[1.5px] border-border-strong bg-card" />;
}

/**
 * Stages of a record's passage (a bill, a vote), on a single track.
 * Past stages are ticked in ink, the current one glows terracotta, future
 * ones are hollow on a dashed line.
 */
export function StatusTimeline({
  stages,
  currentIndex,
  horizontal = false,
  className = '',
}: StatusTimelineProps) {
  const stateOf = (i: number) => (i < currentIndex ? 'past' : i === currentIndex ? 'current' : 'future');

  if (horizontal) {
    return (
      // Focusable so keyboard users can scroll it when it overflows on phones.
      <ol tabIndex={0} className={`flex items-start overflow-x-auto pb-1 rounded-card ${className}`} aria-label="Progress">
        {stages.map((stage, i) => {
          const state = stateOf(i);
          return (
            <li
              key={stage.key}
              className="relative flex-1 min-w-[96px] flex flex-col items-center px-1"
              aria-current={state === 'current' ? 'step' : undefined}
            >
              {/* Track to the next stage, from this marker's centre to the next. */}
              {i < stages.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`absolute top-[7px] left-1/2 w-full ${
                    i < currentIndex ? 'border-t-2 border-text-secondary' : 'border-t-2 border-dashed border-border'
                  }`}
                />
              )}
              <Marker state={state} />
              <span
                className={`text-label-ui text-[0.75rem] mt-2.5 text-center leading-tight ${
                  state === 'current' ? 'text-text-primary' : state === 'past' ? 'text-text-secondary' : 'text-text-tertiary'
                }`}
              >
                {stage.label}
              </span>
              {stage.detail && (
                <span className="font-mono text-[0.6875rem] mt-1 text-center text-text-tertiary">{stage.detail}</span>
              )}
            </li>
          );
        })}
      </ol>
    );
  }

  // Vertical layout
  return (
    <ol className={`flex flex-col ${className}`} aria-label="Progress">
      {stages.map((stage, i) => {
        const state = stateOf(i);
        return (
          <li key={stage.key} className="relative flex items-start gap-3 pb-5 last:pb-0" aria-current={state === 'current' ? 'step' : undefined}>
            {i < stages.length - 1 && (
              <span
                aria-hidden="true"
                className={`absolute left-[7px] top-4 bottom-0 ${
                  i < currentIndex ? 'border-l-2 border-text-secondary' : 'border-l-2 border-dashed border-border'
                }`}
              />
            )}
            <Marker state={state} />
            <div className="-mt-0.5">
              <span
                className={`text-body-sm font-medium ${
                  state === 'current' ? 'text-text-primary' : state === 'past' ? 'text-text-secondary' : 'text-text-tertiary'
                }`}
              >
                {stage.label}
              </span>
              {stage.detail && <span className="block font-mono text-xs text-text-tertiary">{stage.detail}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
