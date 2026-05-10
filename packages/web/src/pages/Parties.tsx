import { useState, useEffect, useRef } from 'react';
import {
  useParties,
  useCreateParty,
  useUpdateParty,
  useDissolveParty,
  type PartyWithStats,
  type CreatePartyBody,
  type UpdatePartyBody,
} from '../api/hooks/useParties';
import { useAuth } from '../api/hooks/useAuth';
import { Tag } from '../components/shared/Tag';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { QueryErrorState } from '../components/shared/QueryErrorState';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ColourSwatch({ hex }: { hex: string | null }) {
  if (!hex) return null;
  return (
    <span
      aria-label={`Party colour ${hex}`}
      className="inline-block w-3.5 h-3.5 rounded-full border border-border-subtle align-middle"
      style={{ backgroundColor: hex }}
    />
  );
}

interface PartyFormState {
  name: string;
  shortName: string;
  ideology: string;
  colour: string;
  discordRoleId: string;
  factionId: string;
  isInviteOnly: boolean;
  active: boolean;
}

function emptyForm(): PartyFormState {
  return { name: '', shortName: '', ideology: '', colour: '', discordRoleId: '', factionId: '', isInviteOnly: false, active: true };
}

function fromParty(p: PartyWithStats): PartyFormState {
  return {
    name: p.name,
    shortName: p.shortName ?? '',
    ideology: p.ideology ?? '',
    colour: p.colour ?? '',
    discordRoleId: p.discordRoleId ?? '',
    factionId: p.factionId ?? '',
    isInviteOnly: p.isInviteOnly,
    active: p.isActive,
  };
}

function PartyFormModal({
  initial,
  isEdit,
  onClose,
  onSubmit,
  isPending,
  errorText,
}: {
  initial: PartyFormState;
  isEdit: boolean;
  onClose: () => void;
  onSubmit: (form: PartyFormState) => void;
  isPending: boolean;
  errorText: string | null;
}) {
  const [form, setForm] = useState<PartyFormState>(initial);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = <K extends keyof PartyFormState>(k: K, v: PartyFormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={dialogRef} className="bg-card rounded-card shadow-modal-warm w-full max-w-lg overflow-hidden">
        <div className="h-[3px] bg-accent-offices" />
        <div className="p-6">
          <div className="flex items-baseline justify-between mb-5">
            <h2 className="text-heading-1 text-text-primary">
              {isEdit ? 'Edit Party' : 'Found a Party'}
            </h2>
            <button onClick={onClose} className="text-text-tertiary hover:text-text-primary text-xl leading-none">×</button>
          </div>

          <div className="space-y-4">
            <Field label="Name" required>
              <input
                type="text"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                maxLength={128}
                autoFocus
                className="input-base"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Short Tag">
                <input
                  type="text"
                  value={form.shortName}
                  onChange={(e) => update('shortName', e.target.value)}
                  maxLength={16}
                  placeholder="e.g. LDP"
                  className="input-base"
                />
              </Field>
              <Field label="Colour (hex)">
                <input
                  type="text"
                  value={form.colour}
                  onChange={(e) => update('colour', e.target.value)}
                  maxLength={7}
                  placeholder="#b94a48"
                  className="input-base font-mono"
                />
              </Field>
            </div>

            <Field label="Ideology">
              <textarea
                value={form.ideology}
                onChange={(e) => update('ideology', e.target.value)}
                rows={2}
                maxLength={256}
                className="input-base resize-y"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Faction ID (optional)">
                <input
                  type="text"
                  value={form.factionId}
                  onChange={(e) => update('factionId', e.target.value)}
                  placeholder="UUID"
                  className="input-base font-mono text-xs"
                />
              </Field>
              <Field label="Discord Role ID">
                <input
                  type="text"
                  value={form.discordRoleId}
                  onChange={(e) => update('discordRoleId', e.target.value)}
                  placeholder="snowflake"
                  className="input-base font-mono text-xs"
                />
              </Field>
            </div>

            <Field label="Access">
              <label className="flex items-center gap-2 text-body-sm">
                <input
                  type="checkbox"
                  checked={form.isInviteOnly}
                  onChange={(e) => update('isInviteOnly', e.target.checked)}
                />
                <span>Invite-only</span>
              </label>
            </Field>

            {isEdit && (
              <Field label="Status">
                <label className="flex items-center gap-2 text-body-sm">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => update('active', e.target.checked)}
                  />
                  <span>Active</span>
                </label>
              </Field>
            )}
          </div>

          {errorText && (
            <p className="text-body-sm text-status-rejected mt-3">{errorText}</p>
          )}

          <div className="flex justify-end gap-2 mt-6">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button
              onClick={() => onSubmit(form)}
              disabled={isPending || !form.name.trim()}
              className="px-4 py-1.5 rounded-card text-text-inverse font-medium bg-accent-offices hover:bg-accent-offices/90 disabled:opacity-50"
            >
              {isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Found Party'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-mono text-text-tertiary text-xs uppercase tracking-wider mb-1">
        {label} {required && <span className="text-status-rejected">*</span>}
      </label>
      {children}
    </div>
  );
}

function DissolveModal({
  party,
  onClose,
  onConfirm,
  isPending,
  errorText,
}: {
  party: PartyWithStats;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
  errorText: string | null;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card rounded-card shadow-modal-warm w-full max-w-md overflow-hidden">
        <div className="h-[3px] bg-accent-moderation" />
        <div className="p-6">
          <h2 className="text-heading-1 text-text-primary mb-3">Dissolve {party.name}?</h2>
          <p className="text-body-sm text-text-secondary mb-2">
            This is a soft delete. The party row stays for history, but{' '}
            <strong className="text-text-primary">{party.memberCount} active member{party.memberCount === 1 ? '' : 's'}</strong>{' '}
            will be unassigned and an event log entry written for each.
          </p>
          <p className="text-body-sm text-text-tertiary italic mb-4">
            You can revive the party later by editing it back to active.
          </p>

          {errorText && (
            <p className="text-body-sm text-status-rejected mb-3">{errorText}</p>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button
              onClick={onConfirm}
              disabled={isPending}
              className="px-4 py-1.5 rounded-card text-text-inverse font-medium bg-accent-moderation hover:bg-accent-moderation/90 disabled:opacity-50"
            >
              {isPending ? 'Dissolving…' : 'Dissolve'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Parties() {
  const { isStaff } = useAuth();
  const [showInactive, setShowInactive] = useState(false);
  const { data: parties, isLoading, isError, error: loadError } = useParties(showInactive);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PartyWithStats | null>(null);
  const [dissolving, setDissolving] = useState<PartyWithStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createMut = useCreateParty();
  const updateMut = useUpdateParty();
  const dissolveMut = useDissolveParty();

  if (isLoading) return <PageSkeleton />;
  if (isError) {
    return (
      <div className="p-8">
        <QueryErrorState title="Could not load parties" error={loadError} />
      </div>
    );
  }

  const handleCreate = async (form: PartyFormState) => {
    setError(null);
    const body: CreatePartyBody = {
      name: form.name.trim(),
      shortName: form.shortName.trim() || null,
      ideology: form.ideology.trim() || null,
      colour: form.colour.trim() || null,
      factionId: form.factionId.trim() || null,
      discordRoleId: form.discordRoleId.trim() || null,
      isInviteOnly: form.isInviteOnly,
    };
    try {
      await createMut.mutateAsync(body);
      setCreating(false);
    } catch (err: any) {
      setError(err?.message ?? 'Could not create party.');
    }
  };

  const handleUpdate = async (form: PartyFormState) => {
    if (!editing) return;
    setError(null);
    const body: UpdatePartyBody = {
      name: form.name.trim(),
      shortName: form.shortName.trim() || null,
      ideology: form.ideology.trim() || null,
      colour: form.colour.trim() || null,
      factionId: form.factionId.trim() || null,
      discordRoleId: form.discordRoleId.trim() || null,
      isInviteOnly: form.isInviteOnly,
      isActive: form.active,
    };
    try {
      await updateMut.mutateAsync({ id: editing.id, body });
      setEditing(null);
    } catch (err: any) {
      setError(err?.message ?? 'Could not update party.');
    }
  };

  const handleDissolve = async () => {
    if (!dissolving) return;
    setError(null);
    try {
      await dissolveMut.mutateAsync(dissolving.id);
      setDissolving(null);
    } catch (err: any) {
      setError(err?.message ?? 'Could not dissolve party.');
    }
  };

  const list = parties ?? [];

  return (
    <div className="p-8">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-display">Parties</h1>
          <p className="text-body-sm text-text-tertiary mt-1">
            Political coalitions, banners, and benches.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-body-sm text-text-secondary">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            <span>Show dissolved</span>
          </label>
          {isStaff && (
            <button
              onClick={() => { setError(null); setCreating(true); }}
              className="px-4 py-1.5 rounded-card text-text-inverse font-medium bg-accent-offices hover:bg-accent-offices/90"
            >
              + Found Party
            </button>
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="card border-l-accent-offices">
          <p className="text-body text-text-secondary italic">
            No parties have been founded yet. The benches sit empty.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((p) => (
            <div
              key={p.id}
              className={`card border-l-accent-offices ${p.isActive ? '' : 'opacity-60'}`}
              style={p.colour ? { borderLeftColor: p.colour } : undefined}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0">
                  <h3 className="font-display font-semibold text-text-primary flex items-center gap-2">
                    <ColourSwatch hex={p.colour} />
                    <span className="truncate">{p.name}</span>
                  </h3>
                  {p.shortName && (
                    <span className="text-mono text-xs text-text-tertiary">{p.shortName}</span>
                  )}
                </div>
                <Tag color={p.isActive ? 'active' : 'closed'}>
                  {p.isActive ? 'Active' : 'Dissolved'}
                </Tag>
              </div>

              {p.isInviteOnly && (
                <div className="mb-3">
                  <Tag color="pending">Invite-only</Tag>
                </div>
              )}

              {p.ideology && (
                <p className="text-body-sm italic text-text-secondary mb-3 line-clamp-2">
                  {p.ideology}
                </p>
              )}

              <dl className="space-y-1 text-body-sm mb-3">
                <div className="flex justify-between">
                  <dt className="text-text-tertiary">Members</dt>
                  <dd className="font-mono text-text-primary">{p.memberCount}</dd>
                </div>
                {p.factionName && (
                  <div className="flex justify-between">
                    <dt className="text-text-tertiary">Faction</dt>
                    <dd className="text-text-primary">{p.factionName}</dd>
                  </div>
                )}
                {p.leaderName && (
                  <div className="flex justify-between">
                    <dt className="text-text-tertiary">Leader</dt>
                    <dd className="text-text-primary">{p.leaderName}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-text-tertiary">Founded</dt>
                  <dd className="font-mono text-xs text-text-tertiary">{formatDate(p.foundedAt)}</dd>
                </div>
                {!p.isActive && p.dissolvedAt && (
                  <div className="flex justify-between">
                    <dt className="text-text-tertiary">Dissolved</dt>
                    <dd className="font-mono text-xs text-text-tertiary">{formatDate(p.dissolvedAt)}</dd>
                  </div>
                )}
              </dl>

              {isStaff && (
                <div className="flex gap-2 pt-2 border-t border-border-subtle">
                  <button
                    onClick={() => { setError(null); setEditing(p); }}
                    className="text-body-sm text-text-secondary hover:text-accent-primary transition-colors"
                  >
                    Edit
                  </button>
                  {p.isActive && (
                    <button
                      onClick={() => { setError(null); setDissolving(p); }}
                      className="text-body-sm text-status-rejected hover:opacity-80 transition-opacity ml-auto"
                    >
                      Dissolve
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {creating && (
        <PartyFormModal
          initial={emptyForm()}
          isEdit={false}
          onClose={() => setCreating(false)}
          onSubmit={handleCreate}
          isPending={createMut.isPending}
          errorText={error}
        />
      )}
      {editing && (
        <PartyFormModal
          initial={fromParty(editing)}
          isEdit
          onClose={() => setEditing(null)}
          onSubmit={handleUpdate}
          isPending={updateMut.isPending}
          errorText={error}
        />
      )}
      {dissolving && (
        <DissolveModal
          party={dissolving}
          onClose={() => setDissolving(null)}
          onConfirm={handleDissolve}
          isPending={dissolveMut.isPending}
          errorText={error}
        />
      )}
    </div>
  );
}
