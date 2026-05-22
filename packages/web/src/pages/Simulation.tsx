import { useState } from 'react';
import {
  useSimulationClock,
  useTimeAdvanceHistory,
  useAdvancePreview,
  useAdvanceTime,
  useAssignAilment,
  useHealCharacter,
  useKillCharacter,
  useSimEvents,
  type TimeAdvanceEntry,
  type SimEvent,
} from '../api/hooks/useSimulation';
import { useSearchPlayers, usePlayer } from '../api/hooks/usePlayers';
import { useAuth } from '../api/hooks/useAuth';
import { Tag } from '../components/shared/Tag';
import { MetricCard } from '../components/shared/MetricCard';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { Modal } from '../components/shared/Modal';
import { PlayerAvatar } from '../components/shared/PlayerAvatar';
import { QueryErrorState } from '../components/shared/QueryErrorState';

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

function formatDeathAilments(ailments?: { condition: string; severity: string }[]): string {
  if (!ailments || ailments.length === 0) return '';
  return ` · ailments: ${ailments.map(a => `${a.condition} (${a.severity})`).join(', ')}`;
}

// ---- Sub-components ----

function ClockHeader() {
  const { data: clock, isLoading, isError, error } = useSimulationClock();

  if (isError) {
    return (
      <QueryErrorState
        title="Could not load simulation clock"
        error={error}
        className="mb-6"
      />
    );
  }

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
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <MetricCard
                  label="Deaths"
                  value={preview.deathDetails.length}
                  color={preview.deathDetails.length > 0 ? 'text-status-rejected' : 'text-text-tertiary'}
                  borderColor="border-border-subtle"
                />
                <MetricCard
                  label="Death Rolls"
                  value={preview.pendingDeathDetails.length}
                  color={preview.pendingDeathDetails.length > 0 ? 'text-status-rejected' : 'text-text-tertiary'}
                  borderColor="border-border-subtle"
                />
                <MetricCard
                  label="New Ailments"
                  value={preview.ailmentDetails.length}
                  color={preview.ailmentDetails.length > 0 ? 'text-health-major' : 'text-text-tertiary'}
                  borderColor="border-border-subtle"
                />
                <MetricCard
                  label="Recoveries"
                  value={preview.recoveryDetails.length}
                  color={preview.recoveryDetails.length > 0 ? 'text-status-passed' : 'text-text-tertiary'}
                  borderColor="border-border-subtle"
                />
                <MetricCard
                  label="Players Aged"
                  value={preview.aged}
                  color="text-accent-simulation"
                  borderColor="border-border-subtle"
                />
              </div>

              {/* Death details */}
              {preview.deathDetails.length > 0 && (
                <div>
                  <p className="text-label-ui text-text-tertiary mb-2">Deaths</p>
                  <div className="space-y-1">
                    {preview.deathDetails.map((d) => (
                      <div
                        key={d.playerId}
                        className="flex flex-col gap-1 bg-status-rejected/[0.05] border border-status-rejected/10 rounded-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <span className="text-body-sm text-text-primary font-medium">
                          {d.characterName ?? 'Unknown'}
                        </span>
                        <span className="font-mono text-xs text-text-tertiary sm:text-right">
                          age {d.age} &middot; {d.cause}{formatDeathAilments(d.ailments)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Pending death details */}
              {preview.pendingDeathDetails.length > 0 && (
                <div>
                  <p className="text-label-ui text-text-tertiary mb-2">Death Rolls</p>
                  <div className="space-y-1">
                    {preview.pendingDeathDetails.map((d) => (
                      <div
                        key={`${d.playerId}-pending-death`}
                        className="flex flex-col gap-1 bg-status-rejected/[0.05] border border-status-rejected/10 rounded-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <span className="text-body-sm text-text-primary font-medium">
                          {d.characterName ?? 'Unknown'}
                        </span>
                        <span className="font-mono text-xs text-text-tertiary sm:text-right">
                          age {d.age} &middot; {d.cause}{formatDeathAilments(d.ailments)} &middot; grace until tick {d.eligibleFromTick}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Ailment details */}
              {preview.ailmentDetails.length > 0 && (
                <div>
                  <p className="text-label-ui text-text-tertiary mb-2">Ailments</p>
                  <div className="space-y-1">
                    {preview.ailmentDetails.map((a) => (
                      <div
                        key={`${a.playerId}-ailment`}
                        className="flex items-center justify-between bg-health-major/[0.05] border border-health-major/10 rounded-card px-3 py-2"
                      >
                        <span className="text-body-sm text-text-primary font-medium">
                          {a.characterName ?? 'Unknown'}
                        </span>
                        <span className="font-mono text-xs text-text-tertiary">
                          {a.condition} &middot; {a.severity}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recovery details */}
              {preview.recoveryDetails.length > 0 && (
                <div>
                  <p className="text-label-ui text-text-tertiary mb-2">Recovered Ailments</p>
                  <div className="space-y-1">
                    {preview.recoveryDetails.map((a) => (
                      <div
                        key={`${a.playerId}-recovery-${a.condition}`}
                        className="flex items-center justify-between bg-status-passed/[0.05] border border-status-passed/10 rounded-card px-3 py-2"
                      >
                        <span className="text-body-sm text-text-primary font-medium">
                          {a.characterName ?? 'Unknown'}
                        </span>
                        <span className="font-mono text-xs text-text-tertiary">
                          {a.condition} &middot; {a.severity}
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
  const { data: history, isLoading, isError, error } = useTimeAdvanceHistory();

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

  if (isError) {
    return <QueryErrorState title="Could not load time advance history" error={error} />;
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
  const pendingDeaths = entry.summary?.pendingDeaths ?? [];
  const ailments = entry.summary?.ailments ?? [];
  const recoveries = entry.summary?.recoveries ?? [];
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
        {pendingDeaths.length > 0 && (
          <span className="text-status-rejected">
            {pendingDeaths.length} pending death{pendingDeaths.length !== 1 ? 's' : ''}
          </span>
        )}
        {ailments.length > 0 && (
          <span className="text-health-major">
            {ailments.length} ailment{ailments.length !== 1 ? 's' : ''}
          </span>
        )}
        {recoveries.length > 0 && (
          <span className="text-status-passed">
            {recoveries.length} recover{recoveries.length !== 1 ? 'ies' : 'y'}
          </span>
        )}
        {aged > 0 && (
          <span className="text-accent-simulation">
            {aged} aged
          </span>
        )}
        {deaths.length === 0 && pendingDeaths.length === 0 && ailments.length === 0 && recoveries.length === 0 && aged === 0 && (
          <span className="text-text-tertiary italic">Uneventful advance</span>
        )}
      </div>

      {/* Death / ailment / recovery names */}
      {deaths.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {deaths.map((name) => (
            <Tag key={name} color="deceased">{name}</Tag>
          ))}
        </div>
      )}
      {pendingDeaths.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pendingDeaths.map((name) => (
            <Tag key={name} color="rejected">{name}</Tag>
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
      {recoveries.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {recoveries.map((name) => (
            <Tag key={name} color="passed">{name}</Tag>
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

export function Simulation() {
  const { isStaff } = useAuth();
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
      {isStaff && <ControlsCard />}

      {/* Ailment / kill controls */}
      {isStaff && <PlayerHealthControls />}

      {/* History */}
      <h2 className="text-heading-1 mt-8 mb-4">Recent Advances</h2>
      <AdvanceHistoryLog />

      {/* Sim event log */}
      <h2 className="text-heading-1 mt-8 mb-4">Sim Event Log</h2>
      <SimEventLog />
    </div>
  );
}

// ============================================================
// Player health controls — ailments + kill (staff)
// ============================================================

function PlayerHealthControls() {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{ id: string; characterName: string | null; discordUsername: string } | null>(null);
  const { data: searchResults } = useSearchPlayers(search);
  const { data: dossier } = usePlayer(selected?.id);

  const [ailmentOpen, setAilmentOpen] = useState(false);
  const [killOpen, setKillOpen] = useState(false);

  const heal = useHealCharacter();

  const fc = 'w-full bg-card border border-border-default rounded-card px-3 py-2 text-body-sm focus:outline-none focus:border-accent-primary transition-colors duration-150';

  return (
    <div className="card border-l-accent-simulation mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-heading-2">Character Health</h2>
        <Tag color="moderation">staff</Tag>
      </div>

      {!selected ? (
        <div>
          <p className="text-body-sm text-text-secondary mb-2">
            Find a character to assign or remove ailments, or — if the season truly demands — record a death.
          </p>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search players…"
            className={fc}
          />
          {searchResults?.data && searchResults.data.length > 0 && (
            <div className="mt-2 border border-border-subtle rounded-card overflow-hidden max-h-60 overflow-y-auto">
              {searchResults.data.map((p: any) => (
                <button
                  key={p.id}
                  onClick={() => { setSelected({ id: p.id, characterName: p.characterName, discordUsername: p.discordUsername }); setSearch(''); }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-hover text-left transition-colors duration-150"
                >
                  <PlayerAvatar player={p} size="sm" />
                  <span className="text-body-sm">{p.characterName ?? p.discordUsername}</span>
                  {!p.isAlive && <Tag color="deceased">deceased</Tag>}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <PlayerAvatar player={selected} size="md" />
            <div className="flex-1">
              <p className="font-display font-medium text-text-primary">
                {selected.characterName ?? selected.discordUsername}
              </p>
              {dossier && (
                <p className="text-body-sm text-text-tertiary">
                  Age {dossier.currentAge ?? '—'} ·{' '}
                  <span className={dossier.healthStatus === 'critical' ? 'text-status-rejected' : dossier.healthStatus === 'major' ? 'text-status-pending' : ''}>
                    {dossier.healthStatus}
                  </span>
                </p>
              )}
            </div>
            <button onClick={() => setSelected(null)} className="text-body-sm text-text-tertiary hover:text-text-primary">
              change
            </button>
          </div>

          {dossier?.ailments && dossier.ailments.length > 0 && (
            <div>
              <p className="text-label-ui text-text-tertiary mb-2">Active ailments</p>
              <div className="space-y-1">
                {dossier.ailments.map((a) => (
                  <div key={a.condition} className="flex items-center gap-2 text-body-sm">
                    <Tag color={a.severity === 'critical' ? 'rejected' : a.severity === 'major' ? 'pending' : 'closed'}>
                      {a.severity}
                    </Tag>
                    <span className="text-text-primary">{a.condition}</span>
                    <button
                      onClick={() => heal.mutate({ playerId: selected.id, condition: a.condition })}
                      disabled={heal.isPending}
                      className="ml-auto text-body-sm text-accent-primary hover:underline disabled:opacity-50"
                    >
                      Heal
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setAilmentOpen(true)}
              disabled={!dossier?.isAlive}
              className="btn-secondary text-sm disabled:opacity-40"
            >
              Assign Ailment
            </button>
            <button
              onClick={() => setKillOpen(true)}
              disabled={!dossier?.isAlive}
              className="px-4 py-1.5 rounded-card font-medium bg-status-rejected hover:bg-status-rejected/90 text-text-inverse text-sm transition-colors duration-150 disabled:opacity-40"
            >
              Kill Character
            </button>
          </div>
        </div>
      )}

      {selected && (
        <>
          <AilmentModal
            open={ailmentOpen}
            onClose={() => setAilmentOpen(false)}
            playerId={selected.id}
            playerName={selected.characterName ?? selected.discordUsername}
          />
          <KillModal
            open={killOpen}
            onClose={() => setKillOpen(false)}
            playerId={selected.id}
            playerName={selected.characterName ?? selected.discordUsername}
          />
        </>
      )}
    </div>
  );
}

function AilmentModal({
  open,
  onClose,
  playerId,
  playerName,
}: {
  open: boolean;
  onClose: () => void;
  playerId: string;
  playerName: string;
}) {
  const assign = useAssignAilment();
  const [condition, setCondition] = useState('');
  const [severity, setSeverity] = useState<'minor' | 'major' | 'critical'>('minor');
  const [notes, setNotes] = useState('');
  const [durationYears, setDurationYears] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!condition.trim()) { setError('Condition is required.'); return; }
    const trimmedDuration = durationYears.trim();
    let parsedDurationYears: number | undefined;
    if (trimmedDuration) {
      const numericDuration = Number(trimmedDuration);
      if (!Number.isInteger(numericDuration) || numericDuration < 1 || numericDuration > 200) {
        setError('Recovery duration must be an integer between 1 and 200 years.');
        return;
      }
      parsedDurationYears = numericDuration;
    }
    try {
      await assign.mutateAsync({
        playerId,
        condition: condition.trim(),
        severity,
        notes: notes.trim() || undefined,
        durationYears: parsedDurationYears,
      });
      setCondition('');
      setNotes('');
      setDurationYears('');
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Could not assign ailment.');
    }
  };

  const fc = 'w-full bg-card border border-border-default rounded-card px-3 py-2 text-body-sm focus:outline-none focus:border-accent-primary transition-colors duration-150';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Assign Ailment — ${playerName}`}
      railClass="bg-accent-simulation"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={submit} disabled={assign.isPending} className="btn-primary disabled:opacity-50">
            {assign.isPending ? 'Saving…' : 'Assign'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="text-label-ui text-text-tertiary block mb-1">Condition</span>
          <input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="e.g. consumption" className={fc} autoFocus />
        </label>
        <div>
          <span className="text-label-ui text-text-tertiary block mb-1">Severity</span>
          <div className="flex gap-2">
            {(['minor', 'major', 'critical'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSeverity(s)}
                className={`px-3 py-1.5 rounded-card text-body-sm border transition-colors duration-150 ${severity === s ? 'border-accent-simulation bg-accent-simulation/10 text-accent-simulation font-medium' : 'border-border-subtle text-text-tertiary hover:border-border-default'}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="text-label-ui text-text-tertiary block mb-1">Notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${fc} resize-y`} />
        </label>
        <label className="block">
          <span className="text-label-ui text-text-tertiary block mb-1">Recovery duration</span>
          <input
            type="number"
            min={1}
            max={200}
            value={durationYears}
            onChange={(e) => setDurationYears(e.target.value)}
            placeholder="Optional years until healed"
            className={fc}
          />
        </label>
        {error && <p className="text-body-sm text-status-rejected">{error}</p>}
      </div>
    </Modal>
  );
}

function KillModal({
  open,
  onClose,
  playerId,
  playerName,
}: {
  open: boolean;
  onClose: () => void;
  playerId: string;
  playerName: string;
}) {
  const kill = useKillCharacter();
  const [cause, setCause] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const submit = async () => {
    setError(null);
    if (!cause.trim()) { setError('Cause of death is required.'); return; }
    try {
      await kill.mutateAsync({ playerId, causeOfDeath: cause.trim() });
      setCause('');
      setConfirmed(false);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Could not record death.');
    }
  };

  const fc = 'w-full bg-card border border-border-default rounded-card px-3 py-2 text-body-sm focus:outline-none focus:border-accent-primary transition-colors duration-150';

  return (
    <Modal
      open={open}
      onClose={() => { setConfirmed(false); onClose(); }}
      title={`Kill Character — ${playerName}`}
      railClass="bg-status-rejected"
      footer={
        <>
          <button onClick={() => { setConfirmed(false); onClose(); }} className="btn-secondary">Cancel</button>
          <button
            onClick={submit}
            disabled={kill.isPending || !confirmed}
            className="px-4 py-1.5 rounded-card font-medium bg-status-rejected hover:bg-status-rejected/90 text-text-inverse disabled:opacity-50 transition-colors duration-150"
          >
            {kill.isPending ? 'Recording…' : 'Confirm Death'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-body-sm text-status-rejected">
          This is a <strong>permanent</strong> sim event. The character will be marked dead, all offices vacated,
          and a death entry written to the player event log. Confirmation cannot be undone via the UI.
        </p>
        <label className="block">
          <span className="text-label-ui text-text-tertiary block mb-1">Cause of death</span>
          <input value={cause} onChange={(e) => setCause(e.target.value)} placeholder="e.g. duel, illness, accident…" className={fc} autoFocus />
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="accent-status-rejected" />
          <span className="text-body-sm text-text-secondary">
            I understand this is irreversible.
          </span>
        </label>
        {error && <p className="text-body-sm text-status-rejected">{error}</p>}
      </div>
    </Modal>
  );
}

// ============================================================
// Sim event log
// ============================================================

const EVENT_COLOR: Record<string, string> = {
  death: 'deceased',
  death_pending: 'rejected',
  ailment_acquired: 'pending',
  ailment_recovered: 'passed',
  office_appointed: 'offices',
  office_left: 'closed',
  party_change: 'players',
};

function SimEventLog() {
  const { data: events, isLoading, isError, error } = useSimEvents(50);

  if (isLoading) {
    return <div className="card border-l-accent-simulation"><div className="skeleton h-4 w-3/4" /></div>;
  }
  if (isError) {
    return <QueryErrorState title="Could not load simulation events" error={error} />;
  }
  if (!events || events.length === 0) {
    return (
      <div className="card border-l-accent-simulation">
        <p className="text-body text-text-tertiary italic">No sim events recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="card border-l-accent-simulation">
      <div className="space-y-1">
        {events.map((e) => <SimEventRow key={e.id} event={e} />)}
      </div>
    </div>
  );
}

function SimEventRow({ event }: { event: SimEvent }) {
  const color = EVENT_COLOR[event.eventType] ?? 'simulation';
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-border-subtle last:border-0">
      <span className="font-mono text-xs text-text-tertiary w-32 flex-shrink-0">
        {new Date(event.createdAt).toLocaleDateString('en-GB', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        })}
      </span>
      <Tag color={color}>{event.eventType.replace(/_/g, ' ')}</Tag>
      <span className="text-body-sm text-text-primary flex-1 truncate">
        {event.characterName ? <span className="font-medium">{event.characterName}: </span> : null}
        {event.description}
      </span>
      {event.simDate && (
        <span className="font-mono text-xs text-text-tertiary">
          {event.simDate}
        </span>
      )}
      {!event.isAutomatic && <Tag color="moderation">manual</Tag>}
    </div>
  );
}
