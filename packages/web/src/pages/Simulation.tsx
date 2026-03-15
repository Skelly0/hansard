import { useState } from 'react';
import {
  useSimulationClock,
  useTimeAdvanceHistory,
  useAdvancePreview,
  useAdvanceTime,
  type TimeAdvanceEntry,
} from '../api/hooks/useSimulation';
import { Tag } from '../components/shared/Tag';
import { MetricCard } from '../components/shared/MetricCard';
import { PageSkeleton } from '../components/shared/SkeletonLoader';

// ---- Helpers ----

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---- Sub-components ----

function ClockHeader() {
  const { data: clock, isLoading } = useSimulationClock();

  if (isLoading || !clock) {
    return (
      <div className="card border-l-accent-simulation mb-6">
        <div className="skeleton w-48 h-8 mb-2" />
        <div className="skeleton w-32 h-5" />
      </div>
    );
  }

  return (
    <div className="card border-l-accent-simulation mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-heading-1 mb-3">{clock.seasonName}</h2>
          <div className="flex flex-wrap items-baseline gap-6">
            <div>
              <p className="text-label-ui text-text-tertiary mb-1">Sim Date</p>
              <p className="font-mono text-2xl text-text-primary leading-tight">
                {formatDate(clock.currentDate)}
              </p>
            </div>
            <div>
              <p className="text-label-ui text-text-tertiary mb-1">Tick</p>
              <p className="font-mono text-2xl text-text-primary leading-tight">
                {clock.currentTick}
              </p>
            </div>
            <div>
              <p className="text-label-ui text-text-tertiary mb-1">Unit</p>
              <p className="font-mono text-sm text-text-secondary">
                {clock.tickUnit}
              </p>
            </div>
          </div>
        </div>
        <div className="pt-1">
          <Tag color={clock.isPaused ? 'pending' : 'active'}>
            {clock.isPaused ? 'Paused' : 'Running'}
          </Tag>
        </div>
      </div>
    </div>
  );
}

function ControlsCard() {
  const [ticks, setTicks] = useState(1);
  const [showPreview, setShowPreview] = useState(false);
  const [notes, setNotes] = useState('');

  const advanceTime = useAdvanceTime();
  const { data: preview, isLoading: previewLoading } = useAdvancePreview(
    showPreview ? ticks : 0,
  );

  const handleAdvance = () => {
    advanceTime.mutate(
      { ticks, notes: notes || undefined },
      {
        onSuccess: () => {
          setNotes('');
          setShowPreview(false);
        },
      },
    );
  };

  return (
    <div className="space-y-4 mb-6">
      {/* Controls */}
      <div className="card border-l-accent-simulation">
        <h2 className="text-heading-2 mb-4">Advance Time</h2>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-label-ui text-text-tertiary block mb-1">Ticks</label>
            <input
              type="number"
              min={1}
              max={100}
              value={ticks}
              onChange={(e) => setTicks(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-24 bg-card border border-border-subtle rounded-card px-3 py-1.5 font-mono text-sm text-text-primary focus:outline-none focus:border-accent-primary"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-label-ui text-text-tertiary block mb-1">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              className="w-full bg-card border border-border-subtle rounded-card px-3 py-1.5 text-body-sm font-body text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showPreview}
                onChange={(e) => setShowPreview(e.target.checked)}
                className="accent-accent-simulation"
              />
              <span className="text-body-sm text-text-secondary">Preview</span>
            </label>
            <button
              className="btn-primary"
              onClick={handleAdvance}
              disabled={advanceTime.isPending}
            >
              {advanceTime.isPending ? 'Advancing...' : 'Advance Time'}
            </button>
          </div>
        </div>
      </div>

      {/* Preview results */}
      {showPreview && (
        <div className="card border-l-accent-simulation">
          <h2 className="text-heading-2 mb-3">Preview Results</h2>
          <p className="text-body-sm text-text-tertiary mb-4">
            What would happen if time advances by {ticks} tick{ticks !== 1 ? 's' : ''}
          </p>

          {previewLoading ? (
            <div className="space-y-2">
              <div className="skeleton w-full h-4" />
              <div className="skeleton w-3/4 h-4" />
              <div className="skeleton w-1/2 h-4" />
            </div>
          ) : preview ? (
            <div className="space-y-4">
              {/* Date range */}
              <div className="flex items-center gap-2 text-body-sm text-text-secondary">
                <span className="font-mono">{formatDate(preview.fromDate)}</span>
                <span className="text-text-tertiary">&rarr;</span>
                <span className="font-mono">{formatDate(preview.toDate)}</span>
              </div>

              {/* Metrics row */}
              <div className="grid grid-cols-3 gap-4">
                <MetricCard
                  label="Potential Deaths"
                  value={preview.potentialDeaths.length}
                  color={preview.potentialDeaths.length > 0 ? 'text-status-rejected' : 'text-text-tertiary'}
                  borderColor="border-border-subtle"
                />
                <MetricCard
                  label="New Ailments"
                  value={preview.potentialAilments.length}
                  color={preview.potentialAilments.length > 0 ? 'text-health-major' : 'text-text-tertiary'}
                  borderColor="border-border-subtle"
                />
                <MetricCard
                  label="Players Aged"
                  value={preview.playersAged}
                  color="text-accent-simulation"
                  borderColor="border-border-subtle"
                />
              </div>

              {/* Death details */}
              {preview.potentialDeaths.length > 0 && (
                <div>
                  <p className="text-label-ui text-text-tertiary mb-2">Deaths</p>
                  <div className="space-y-1">
                    {preview.potentialDeaths.map((d) => (
                      <div
                        key={d.playerId}
                        className="flex items-center justify-between bg-status-rejected/[0.05] border border-status-rejected/10 rounded-card px-3 py-2"
                      >
                        <span className="text-body-sm text-text-primary font-medium">
                          {d.characterName}
                        </span>
                        <span className="font-mono text-xs text-text-tertiary">
                          age {d.age} &middot; {Math.round(d.probability * 100)}% chance
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Ailment details */}
              {preview.potentialAilments.length > 0 && (
                <div>
                  <p className="text-label-ui text-text-tertiary mb-2">Ailments</p>
                  <div className="space-y-1">
                    {preview.potentialAilments.map((a) => (
                      <div
                        key={`${a.playerId}-ailment`}
                        className="flex items-center justify-between bg-health-major/[0.05] border border-health-major/10 rounded-card px-3 py-2"
                      >
                        <span className="text-body-sm text-text-primary font-medium">
                          {a.characterName}
                        </span>
                        <span className="font-mono text-xs text-text-tertiary">
                          age {a.age} &middot; {Math.round(a.probability * 100)}% chance
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-body-sm text-text-tertiary italic">
              No preview data available.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AdvanceHistoryLog() {
  const { data: history, isLoading } = useTimeAdvanceHistory();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card border-l-accent-simulation">
            <div className="skeleton w-48 h-4 mb-2" />
            <div className="skeleton w-full h-3 mb-1" />
            <div className="skeleton w-2/3 h-3" />
          </div>
        ))}
      </div>
    );
  }

  if (!history || history.length === 0) {
    return (
      <div className="card border-l-accent-simulation">
        <p className="text-body text-text-secondary italic">
          No time advances recorded yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {history.map((entry) => (
        <AdvanceCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function AdvanceCard({ entry }: { entry: TimeAdvanceEntry }) {
  const deaths = entry.summary?.deaths ?? [];
  const ailments = entry.summary?.ailments ?? [];
  const aged = entry.summary?.aged ?? 0;

  return (
    <div className="card border-l-accent-simulation">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        {/* Date range */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-text-primary">
            {formatDate(entry.fromDate)}
          </span>
          <span className="text-text-tertiary">&rarr;</span>
          <span className="font-mono text-sm text-text-primary">
            {formatDate(entry.toDate)}
          </span>
          <span className="font-mono text-xs text-text-tertiary ml-2">
            tick {entry.fromTick}&ndash;{entry.toTick}
          </span>
        </div>

        {/* Who advanced */}
        <span className="text-body-sm text-text-tertiary">
          by {entry.advancedBy?.characterName || 'System'}
        </span>
      </div>

      {/* Summary line */}
      <div className="flex flex-wrap gap-3 text-body-sm">
        {deaths.length > 0 && (
          <span className="text-status-rejected">
            {deaths.length} death{deaths.length !== 1 ? 's' : ''}
          </span>
        )}
        {ailments.length > 0 && (
          <span className="text-health-major">
            {ailments.length} ailment{ailments.length !== 1 ? 's' : ''}
          </span>
        )}
        {aged > 0 && (
          <span className="text-accent-simulation">
            {aged} aged
          </span>
        )}
        {deaths.length === 0 && ailments.length === 0 && aged === 0 && (
          <span className="text-text-tertiary italic">Uneventful advance</span>
        )}
      </div>

      {/* Death / ailment names */}
      {deaths.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {deaths.map((name) => (
            <Tag key={name} color="deceased">{name}</Tag>
          ))}
        </div>
      )}
      {ailments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ailments.map((name) => (
            <Tag key={name} color="pending">{name}</Tag>
          ))}
        </div>
      )}

      {/* Notes */}
      {entry.notes && (
        <p className="text-body-sm text-text-secondary mt-2 italic">
          {entry.notes}
        </p>
      )}

      {/* Timestamp */}
      <p className="font-mono text-xs text-text-tertiary mt-2">
        {formatDateTime(entry.createdAt)}
      </p>
    </div>
  );
}

// ---- Main Page ----

// TODO: Replace with real auth hook when available
const IS_STAFF = true;

export function Simulation() {
  const { isLoading } = useSimulationClock();

  if (isLoading) return <PageSkeleton />;

  return (
    <div className="p-8">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-display">Simulation</h1>
          <p className="text-body-sm text-text-tertiary mt-1">
            Time, mortality, and the march of seasons
          </p>
        </div>
      </div>

      {/* Clock display */}
      <ClockHeader />

      {/* Staff controls */}
      {IS_STAFF && <ControlsCard />}

      {/* History */}
      <h2 className="text-heading-1 mb-4">Recent Advances</h2>
      <AdvanceHistoryLog />
    </div>
  );
}
