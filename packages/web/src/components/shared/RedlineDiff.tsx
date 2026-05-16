export interface DiffHunk {
  type: 'added' | 'removed' | 'unchanged';
  value: string;
}

interface RedlineDiffProps {
  hunks: DiffHunk[];
  fromLabel?: string;
  toLabel?: string;
}

/**
 * Two-column redline diff display.
 *
 * Left column ("Before") shows unchanged + removed text.
 * Right column ("After") shows unchanged + added text.
 *
 * Removed text: strikethrough, brick red, 15% opacity background.
 * Added text: font-medium, sage green, 15% opacity background.
 */
export function RedlineDiff({
  hunks,
  fromLabel = 'Before',
  toLabel = 'After',
}: RedlineDiffProps) {
  // Build left (before) and right (after) segments from the hunk stream
  const leftSegments: { type: 'removed' | 'unchanged'; value: string }[] = [];
  const rightSegments: { type: 'added' | 'unchanged'; value: string }[] = [];

  for (const hunk of hunks) {
    if (hunk.type === 'unchanged') {
      leftSegments.push({ type: 'unchanged', value: hunk.value });
      rightSegments.push({ type: 'unchanged', value: hunk.value });
    } else if (hunk.type === 'removed') {
      leftSegments.push({ type: 'removed', value: hunk.value });
    } else if (hunk.type === 'added') {
      rightSegments.push({ type: 'added', value: hunk.value });
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Before column */}
      <div>
        <p className="text-label-ui text-text-tertiary uppercase tracking-wider mb-2 font-body text-xs">
          {fromLabel}
        </p>
        <div className="bg-card rounded-card border border-border-subtle p-4 font-body text-body text-text-primary leading-relaxed whitespace-pre-wrap min-h-[4rem]">
          {leftSegments.map((seg, i) =>
            seg.type === 'removed' ? (
              <span
                key={i}
                className="line-through"
                style={{
                  color: '#C25B4E',
                  backgroundColor: 'rgba(194, 91, 78, 0.15)',
                  borderRadius: '2px',
                  padding: '0 2px',
                }}
              >
                {seg.value}
              </span>
            ) : (
              <span key={i}>{seg.value}</span>
            ),
          )}
        </div>
      </div>

      {/* After column */}
      <div>
        <p className="text-label-ui text-text-tertiary uppercase tracking-wider mb-2 font-body text-xs">
          {toLabel}
        </p>
        <div className="bg-card rounded-card border border-border-subtle p-4 font-body text-body text-text-primary leading-relaxed whitespace-pre-wrap min-h-[4rem]">
          {rightSegments.map((seg, i) =>
            seg.type === 'added' ? (
              <span
                key={i}
                className="font-medium"
                style={{
                  color: '#788C5D',
                  backgroundColor: 'rgba(120, 140, 93, 0.15)',
                  borderRadius: '2px',
                  padding: '0 2px',
                }}
              >
                {seg.value}
              </span>
            ) : (
              <span key={i}>{seg.value}</span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
