interface ResultsBarsProps {
  yea: number;
  nay: number;
  abstain: number;
  /** Show labels inside/beside bars */
  showLabels?: boolean;
  /** Show numeric counts */
  showCounts?: boolean;
  /** Additional class name */
  className?: string;
}

/**
 * Horizontal stacked vote result bars.
 * - Yea: sage green (#788C5D / status-passed)
 * - Nay: brick red (#C25B4E / status-rejected)
 * - Abstain: warm grey (#9C9890 / accent-graveyard)
 * - Minimum 28px tall
 * - 4px rounded ends
 */
export function ResultsBars({
  yea,
  nay,
  abstain,
  showLabels = true,
  showCounts = true,
  className = '',
}: ResultsBarsProps) {
  const total = yea + nay + abstain;
  if (total === 0) {
    return (
      <div className={`${className}`}>
        <div className="h-7 bg-inset rounded flex items-center justify-center">
          <span className="text-body-sm text-text-tertiary italic">No votes cast</span>
        </div>
      </div>
    );
  }

  const yeaPct = (yea / total) * 100;
  const nayPct = (nay / total) * 100;
  const abstainPct = (abstain / total) * 100;

  const segments = [
    { label: 'Yea', count: yea, pct: yeaPct, bg: 'bg-status-passed', text: 'text-white' },
    { label: 'Nay', count: nay, pct: nayPct, bg: 'bg-status-rejected', text: 'text-white' },
    { label: 'Abstain', count: abstain, pct: abstainPct, bg: 'bg-accent-graveyard', text: 'text-white' },
  ].filter((s) => s.count > 0);

  return (
    <div className={className}>
      {/* Bar */}
      <div className="flex h-7 rounded overflow-hidden" style={{ minHeight: 28 }}>
        {segments.map((seg, i) => (
          <div
            key={seg.label}
            className={`${seg.bg} flex items-center justify-center transition-all duration-400 ease-out ${
              i === 0 ? 'rounded-l' : ''
            } ${i === segments.length - 1 ? 'rounded-r' : ''}`}
            style={{ width: `${seg.pct}%` }}
          >
            {seg.pct > 12 && showCounts && (
              <span className={`font-mono text-xs ${seg.text} font-medium`}>
                {seg.count}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Labels below */}
      {showLabels && (
        <div className="flex gap-4 mt-2">
          {segments.map((seg) => (
            <div key={seg.label} className="flex items-center gap-1.5">
              <div className={`w-2.5 h-2.5 rounded-full ${seg.bg}`} />
              <span className="text-body-sm text-text-secondary">
                {seg.label}
              </span>
              {showCounts && (
                <span className="font-mono text-xs text-text-tertiary">
                  {seg.count} ({Math.round(seg.pct)}%)
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface MultiRoundBarsProps {
  rounds: { round: number; tallies: Record<string, number>; eliminated?: string }[];
  candidateNames: Record<string, string>;
  className?: string;
}

/** Candidate colours rotate through muted palette */
const CANDIDATE_COLOURS = [
  'bg-status-passed',
  'bg-accent-voting',
  'bg-accent-bills',
  'bg-accent-offices',
  'bg-accent-simulation',
  'bg-accent-primary',
  'bg-accent-tickets',
  'bg-status-pending',
];

/**
 * Multi-round election results for ranked/exhaustive ballots.
 * Each round displayed as a row with bars, eliminated candidates greyed out.
 */
export function MultiRoundBars({
  rounds,
  candidateNames,
  className = '',
}: MultiRoundBarsProps) {
  const allCandidates = Object.keys(rounds[0]?.tallies || {});
  const eliminated = new Set<string>();

  return (
    <div className={`space-y-3 ${className}`}>
      {rounds.map((round) => {
        const total = Object.values(round.tallies).reduce((a, b) => a + b, 0);
        if (round.eliminated) eliminated.add(round.eliminated);

        return (
          <div key={round.round}>
            <p className="text-label-ui text-text-tertiary mb-1">Round {round.round}</p>
            <div className="flex h-7 rounded overflow-hidden" style={{ minHeight: 28 }}>
              {allCandidates
                .filter((c) => (round.tallies[c] ?? 0) > 0)
                .map((candidateId, ci) => {
                  const count = round.tallies[candidateId] ?? 0;
                  const pct = total > 0 ? (count / total) * 100 : 0;
                  const isEliminated = eliminated.has(candidateId);

                  return (
                    <div
                      key={candidateId}
                      className={`${
                        isEliminated ? 'bg-border-subtle' : CANDIDATE_COLOURS[ci % CANDIDATE_COLOURS.length]
                      } flex items-center justify-center transition-all duration-400 ease-out`}
                      style={{ width: `${pct}%` }}
                      title={`${candidateNames[candidateId] || candidateId}: ${count}`}
                    >
                      {pct > 15 && (
                        <span className="font-mono text-xs text-white font-medium truncate px-1">
                          {count}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
            {round.eliminated && (
              <p className="text-body-sm text-text-tertiary mt-0.5 italic">
                Eliminated: {candidateNames[round.eliminated] || round.eliminated}
              </p>
            )}
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-2">
        {allCandidates.map((id, i) => (
          <div key={id} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${
              eliminated.has(id)
                ? 'bg-border-subtle'
                : CANDIDATE_COLOURS[i % CANDIDATE_COLOURS.length]
            }`} />
            <span className={`text-body-sm ${
              eliminated.has(id) ? 'text-text-tertiary line-through' : 'text-text-secondary'
            }`}>
              {candidateNames[id] || id}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
