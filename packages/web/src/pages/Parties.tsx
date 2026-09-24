import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  useParty,
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
import { Modal } from '../components/shared/Modal';
import { PageHeader, EmptyState } from '../components/shared/PageHeader';
import { PlayerAvatar } from '../components/shared/PlayerAvatar';
import { Skeleton } from '../components/shared/SkeletonLoader';
import { useUrlState } from '../hooks/useUrlState';
import { formatDate, plural } from '../lib/format';

function ColourSwatch({ hex }: { hex: string | null }) {
  if (!hex) return null;
  return (
    <span
      role="img"
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

  const update = <K extends keyof PartyFormState>(k: K, v: PartyFormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Edit Party' : 'Found a Party'}
      railClass="bg-accent-offices"
      maxWidth="max-w-lg"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={() => onSubmit(form)}
            disabled={isPending || !form.name.trim()}
            className="btn-primary"
          >
            {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Found party'}
          </button>
        </>
      }
    >
          <div className="space-y-4">
            <Field label="Name" required>
              <input
                type="text"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                maxLength={128}
                autoFocus
                className="field w-full"
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
                  className="field w-full"
                />
              </Field>
              <Field label="Colour (hex)">
                <span className="flex items-center gap-2">
                  <input
                    type="text"
                    value={form.colour}
                    onChange={(e) => update('colour', e.target.value)}
                    maxLength={7}
                    placeholder="#b94a48"
                    className="field w-full font-mono"
                  />
                  <input
                    type="color"
                    aria-label="Pick party colour"
                    value={/^#[0-9a-f]{6}$/i.test(form.colour) ? form.colour : '#b94a48'}
                    onChange={(e) => update('colour', e.target.value)}
                    className="h-9 w-10 flex-shrink-0 rounded-card border border-border bg-card cursor-pointer p-0.5"
                  />
                </span>
              </Field>
            </div>

            <Field label="Ideology">
              <textarea
                value={form.ideology}
                onChange={(e) => update('ideology', e.target.value)}
                rows={2}
                maxLength={256}
                className="field w-full resize-y"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Faction ID (optional)">
                <input
                  type="text"
                  value={form.factionId}
                  onChange={(e) => update('factionId', e.target.value)}
                  placeholder="UUID"
                  className="field w-full font-mono text-xs"
                />
              </Field>
              <Field label="Discord Role ID">
                <input
                  type="text"
                  value={form.discordRoleId}
                  onChange={(e) => update('discordRoleId', e.target.value)}
                  placeholder="snowflake"
                  className="field w-full font-mono text-xs"
                />
              </Field>
            </div>

            <Field label="Access">
              <span className="flex items-center gap-2 text-body-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isInviteOnly}
                  onChange={(e) => update('isInviteOnly', e.target.checked)}
                  className="accent-accent-offices"
                />
                <span>Invite-only</span>
              </span>
            </Field>

            {isEdit && (
              <Field label="Status">
                <span className="flex items-center gap-2 text-body-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => update('active', e.target.checked)}
                    className="accent-accent-offices"
                  />
                  <span>Active</span>
                </span>
              </Field>
            )}
          </div>

          {errorText && (
            <p role="alert" className="text-body-sm text-status-rejected mt-3">{errorText}</p>
          )}
    </Modal>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block">
        <span className="field-label">
          {label} {required && <span className="text-status-rejected" aria-hidden="true">*</span>}
        </span>
        {children}
      </label>
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
  return (
    <Modal
      open
      onClose={onClose}
      title={`Dissolve ${party.name}?`}
      railClass="bg-accent-moderation"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={onConfirm} disabled={isPending} className="btn-danger">
            {isPending ? 'Dissolving…' : 'Dissolve'}
          </button>
        </>
      }
    >
      <p className="text-body-sm text-text-secondary mb-2">
        This is a soft delete. The party row stays for history, but{' '}
        <strong className="text-text-primary">{party.memberCount} active member{party.memberCount === 1 ? '' : 's'}</strong>{' '}
        will be unassigned and an event log entry written for each.
      </p>
      <p className="text-body-sm text-text-tertiary italic">
        You can revive the party later by editing it back to active.
      </p>
      {errorText && (
        <p role="alert" className="text-body-sm text-status-rejected mt-3">{errorText}</p>
      )}
    </Modal>
  );
}

/** Party roster and particulars; opened via `?party=<id>` so it can be linked. */
function PartyDetailModal({ partyId, onClose }: { partyId: string; onClose: () => void }) {
  const { data: party, isLoading, isError } = useParty(partyId);

  return (
    <Modal
      open
      onClose={onClose}
      title={
        party ? (
          <span className="inline-flex items-center gap-2">
            <ColourSwatch hex={party.colour} />
            {party.name}
          </span>
        ) : 'Party'
      }
      eyebrow={party?.shortName ?? undefined}
      railClass="bg-accent-offices"
      maxWidth="max-w-lg"
      footer={<button onClick={onClose} className="btn-secondary">Close</button>}
    >
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton height="h-5" />
          <Skeleton height="h-24" />
        </div>
      ) : isError || !party ? (
        <p className="text-body-sm text-text-secondary">This party could not be loaded.</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Tag color={party.isActive ? 'active' : 'closed'}>{party.isActive ? 'Active' : 'Dissolved'}</Tag>
            {party.isInviteOnly && <Tag color="pending">Invite-only</Tag>}
          </div>

          {party.ideology && (
            <p className="text-body italic text-text-secondary whitespace-pre-line">{party.ideology}</p>
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-body-sm">
            <dt className="text-text-tertiary">Leader</dt>
            <dd className="text-text-primary">
              {party.leaderId && party.leaderName ? (
                <Link to="/players/$id" params={{ id: party.leaderId }} className="hover:text-accent-primary">
                  {party.leaderName}
                </Link>
              ) : (
                <span className="italic text-text-tertiary">None named</span>
              )}
            </dd>
            {party.factionName && (
              <>
                <dt className="text-text-tertiary">Faction</dt>
                <dd className="text-text-primary">{party.factionName}</dd>
              </>
            )}
            <dt className="text-text-tertiary">Founded</dt>
            <dd className="font-mono text-xs text-text-secondary self-center">{formatDate(party.foundedAt)}</dd>
            {!party.isActive && party.dissolvedAt && (
              <>
                <dt className="text-text-tertiary">Dissolved</dt>
                <dd className="font-mono text-xs text-text-secondary self-center">{formatDate(party.dissolvedAt)}</dd>
              </>
            )}
          </dl>

          <section aria-labelledby="party-members-heading">
            <h3 id="party-members-heading" className="text-label-ui text-text-tertiary mb-2">
              {plural(party.members.length, 'member')}
            </h3>
            {party.members.length === 0 ? (
              <p className="text-body-sm italic text-text-tertiary">The benches are empty.</p>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {party.members.map((m) => (
                  <li key={m.id}>
                    <Link
                      to="/players/$id"
                      params={{ id: m.id }}
                      className="flex items-center gap-2 rounded-card px-2 py-1.5 hover:bg-hover text-body-sm text-text-primary"
                    >
                      <PlayerAvatar player={m} size="sm" />
                      <span className="truncate">{m.characterName ?? m.discordUsername}</span>
                      {m.id === party.leaderId && <span className="ml-auto text-xs text-text-tertiary">leader</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {party.isActive && (
            <p className="text-xs text-text-tertiary border-t border-border-subtle pt-3">
              {party.isInviteOnly
                ? 'Membership is by invitation; staff assign new members.'
                : <>Join from Discord with <code className="font-mono">/party join</code>, which also grants the party role.</>}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

export function Parties() {
  const { isStaff } = useAuth();
  const [url, setUrl] = useUrlState({ party: '', dissolved: '' });
  const showInactive = url.dissolved === '1';
  const setShowInactive = (on: boolean) => setUrl({ dissolved: on ? '1' : '' });
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
      <div className="page">
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
    <div className="page">
      <PageHeader
        title="Parties"
        subtitle="Political coalitions, banners, and benches."
        actions={
          <>
            <label className="flex items-center gap-2 text-body-sm text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="accent-accent-primary"
              />
              <span>Show dissolved</span>
            </label>
            {isStaff && (
              <button
                onClick={() => { setError(null); setCreating(true); }}
                className="btn-primary"
              >
                Found a party
              </button>
            )}
          </>
        }
      />

      {list.length === 0 ? (
        <div className="card">
          <EmptyState title="No parties have been founded yet. The benches sit empty." />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
          {list.map((p) => (
            <div
              key={p.id}
              className={`card relative overflow-hidden ${p.isActive ? '' : 'bg-page border-dashed shadow-none'}`}
            >
              {/* The party's colours, worn as a ribbon along the top. */}
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[3px] bg-border"
                style={p.colour ? { backgroundColor: p.colour } : undefined}
              />
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0">
                  <h2 className="font-display font-semibold text-[1.25rem] leading-tight text-text-primary">
                    <button
                      type="button"
                      onClick={() => setUrl({ party: p.id })}
                      className="flex items-center gap-2 max-w-full text-left hover:text-accent-primary transition-colors"
                    >
                      <ColourSwatch hex={p.colour} />
                      <span className="truncate">{p.name}</span>
                    </button>
                  </h2>
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
                  <dd>
                    <button
                      type="button"
                      onClick={() => setUrl({ party: p.id })}
                      className="font-mono text-text-primary hover:text-accent-primary underline decoration-dotted underline-offset-2"
                      aria-label={`View the ${plural(p.memberCount, 'member')} of ${p.name}`}
                    >
                      {p.memberCount}
                    </button>
                  </dd>
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

      {url.party && <PartyDetailModal partyId={url.party} onClose={() => setUrl({ party: '' })} />}
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
