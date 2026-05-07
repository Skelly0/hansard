import { useState, useEffect, useRef } from 'react';
import { useSearchPlayers } from '../../api/hooks/usePlayers';
import { useCreateModAction } from '../../api/hooks/useModeration';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { PlayerAvatar } from './PlayerAvatar';

type ModType = 'warn' | 'mute' | 'suspend';

interface ModActionModalProps {
  type: ModType;
  onClose: () => void;
}

const TITLES: Record<ModType, string> = {
  warn: 'Issue Warning',
  mute: 'Issue Mute',
  suspend: 'Issue Suspension',
};

const TYPE_LABELS: Record<ModType, string> = {
  warn: 'Warn',
  mute: 'Mute',
  suspend: 'Suspend',
};

const RAIL_COLOR: Record<ModType, string> = {
  warn: 'bg-status-pending',
  mute: 'bg-accent-tickets',
  suspend: 'bg-accent-moderation',
};

const SUBMIT_COLOR: Record<ModType, string> = {
  warn: 'bg-status-pending hover:bg-status-pending/90',
  mute: 'bg-accent-tickets hover:bg-accent-tickets/90',
  suspend: 'bg-accent-moderation hover:bg-accent-moderation/90',
};

const DURATION_PRESETS = [
  { label: '1h',         ms: 60 * 60 * 1000 },
  { label: '24h',        ms: 24 * 60 * 60 * 1000 },
  { label: '7d',         ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30d',        ms: 30 * 24 * 60 * 60 * 1000 },
  { label: 'Permanent',  ms: null as number | null },
];

interface SelectedPlayer {
  id: string;
  characterName: string | null;
  discordUsername: string;
}

export function ModActionModal({ type, onClose }: ModActionModalProps) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SelectedPlayer | null>(null);
  const [warnSubtype, setWarnSubtype] = useState<'verbal_warning' | 'formal_warning'>('verbal_warning');
  const [durationMs, setDurationMs] = useState<number | null>(24 * 60 * 60 * 1000);
  const [customMode, setCustomMode] = useState(false);
  const [customExpiry, setCustomExpiry] = useState('');
  const [reason, setReason] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const debouncedSearch = useDebouncedValue(search, 300);
  const { data: searchResults } = useSearchPlayers(debouncedSearch);
  const createAction = useCreateModAction();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const apiType = type === 'warn'
    ? warnSubtype
    : type === 'mute' ? 'mute' : 'temporary_suspension';

  const handleSubmit = async () => {
    setError(null);
    if (!selected) { setError('Pick a target player.'); return; }
    if (reason.trim().length < 8) { setError('Reason must be at least 8 characters.'); return; }

    let expiresAt: string | undefined;
    if (type !== 'warn') {
      if (customMode) {
        if (!customExpiry) { setError('Pick a custom expiry, or use a preset.'); return; }
        expiresAt = new Date(customExpiry).toISOString();
      } else if (durationMs !== null) {
        expiresAt = new Date(Date.now() + durationMs).toISOString();
      }
    }

    try {
      await createAction.mutateAsync({
        targetPlayerId: selected.id,
        type: apiType,
        reason: reason.trim(),
        internalNotes: internalNotes.trim() || undefined,
        expiresAt,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Could not submit. Try again.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={dialogRef} className="bg-card rounded-card shadow-modal-warm w-full max-w-md overflow-hidden">
        <div className={`h-[3px] ${RAIL_COLOR[type]}`} />
        <div className="p-6">
          <div className="flex items-baseline justify-between mb-5">
            <div>
              <div className="text-mono text-text-tertiary text-xs uppercase tracking-wider mb-1">
                {TYPE_LABELS[type]}
              </div>
              <h2 className="text-heading-1 text-text-primary">{TITLES[type]}</h2>
            </div>
            <button onClick={onClose} className="text-text-tertiary hover:text-text-primary text-xl leading-none">×</button>
          </div>

          <div className="mb-4">
            <label className="block text-mono text-text-tertiary text-xs uppercase tracking-wider mb-1">
              Target Player
            </label>
            {selected ? (
              <div className="flex items-center gap-2 bg-card border border-border-default rounded-card px-3 py-2">
                <PlayerAvatar player={selected} size="sm" />
                <span className="text-body-sm text-text-primary">{selected.characterName ?? selected.discordUsername}</span>
                <span className="text-mono text-xs text-text-tertiary ml-auto">@{selected.discordUsername}</span>
                <button onClick={() => { setSelected(null); setSearch(''); }} className="ml-2 text-text-tertiary text-xs hover:text-status-rejected">change</button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name..."
                  autoFocus
                  className="w-full bg-card border border-border-default rounded-card px-3 py-2 text-body-sm focus:outline-none focus:border-accent-primary"
                />
                {searchResults?.data && searchResults.data.length > 0 && (
                  <div className="mt-1 border border-border-subtle rounded-card overflow-hidden">
                    {searchResults.data.map((p: any) => (
                      <button
                        key={p.id}
                        onClick={() => setSelected({ id: p.id, characterName: p.characterName, discordUsername: p.discordUsername })}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-hover text-left"
                      >
                        <PlayerAvatar player={p} size="sm" />
                        <span className="text-body-sm">{p.characterName ?? p.discordUsername}</span>
                        <span className="text-mono text-xs text-text-tertiary ml-auto">@{p.discordUsername}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {type === 'warn' && (
            <div className="mb-4">
              <label className="block text-mono text-text-tertiary text-xs uppercase tracking-wider mb-2">Type</label>
              <div className="flex gap-3">
                {(['verbal_warning', 'formal_warning'] as const).map((sub) => (
                  <label key={sub} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={warnSubtype === sub} onChange={() => setWarnSubtype(sub)} />
                    <span className="text-body-sm">{sub === 'verbal_warning' ? 'Verbal' : 'Formal'}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {type !== 'warn' && (
            <div className="mb-4">
              <label className="block text-mono text-text-tertiary text-xs uppercase tracking-wider mb-2">Duration</label>
              <div className="flex flex-wrap gap-2">
                {DURATION_PRESETS.map((preset) => {
                  const active = !customMode && durationMs === preset.ms;
                  return (
                    <button
                      key={preset.label}
                      onClick={() => { setDurationMs(preset.ms); setCustomMode(false); }}
                      className={`text-body-sm px-3 py-1 rounded-card border transition-colors ${active ? 'bg-accent-primary-light border-accent-primary text-accent-primary font-medium' : 'bg-card border-border-default text-text-secondary hover:border-accent-primary'}`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
                <button
                  onClick={() => setCustomMode(true)}
                  className={`text-body-sm px-3 py-1 rounded-card border-dashed border transition-colors ${customMode ? 'border-accent-primary text-accent-primary' : 'border-border-strong text-text-tertiary hover:border-accent-primary'}`}
                >
                  Custom…
                </button>
              </div>
              {customMode && (
                <input
                  type="datetime-local"
                  value={customExpiry}
                  onChange={(e) => setCustomExpiry(e.target.value)}
                  className="mt-2 bg-card border border-border-default rounded-card px-3 py-2 text-body-sm focus:outline-none focus:border-accent-primary"
                />
              )}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-mono text-text-tertiary text-xs uppercase tracking-wider mb-1">
              Reason <span className="text-status-rejected">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Required, at least 8 characters."
              className="w-full bg-card border border-border-default rounded-card px-3 py-2 text-body-sm focus:outline-none focus:border-accent-primary resize-y"
            />
          </div>

          <div className="mb-5">
            <label className="block text-mono text-text-tertiary text-xs uppercase tracking-wider mb-1">
              Internal notes <span className="italic text-border-strong normal-case">staff only</span>
            </label>
            <textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={2}
              placeholder="optional…"
              className="w-full bg-card border border-border-default rounded-card px-3 py-2 text-body-sm focus:outline-none focus:border-accent-primary resize-y"
            />
          </div>

          {error && (
            <p className="text-body-sm text-status-rejected mb-3">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={createAction.isPending}
              className={`px-4 py-1.5 rounded-card text-text-inverse font-medium ${SUBMIT_COLOR[type]} disabled:opacity-50`}
            >
              {createAction.isPending ? 'Submitting…' : TITLES[type].replace('Issue ', '')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
