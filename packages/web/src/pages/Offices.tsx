import { Link } from '@tanstack/react-router';
import { useOffice, useOffices } from '../api/hooks/useOffices';
import { useUrlState } from '../hooks/useUrlState';
import { Modal } from '../components/shared/Modal';
import { Skeleton } from '../components/shared/SkeletonLoader';
import { Tag } from '../components/shared/Tag';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { PlayerAvatar } from '../components/shared/PlayerAvatar';
import { QueryErrorState } from '../components/shared/QueryErrorState';
import { PageHeader, EmptyState, SectionHeading } from '../components/shared/PageHeader';
import { formatDate, formatSimDate, humanizeToken, relativeTime, sentenceCase } from '../lib/format';

const tierOrder = ['head_of_state', 'head_of_government', 'cabinet', 'legislature', 'regional'];
const tierLabel: Record<string, string> = {
  head_of_state: 'Head of State',
  head_of_government: 'Head of Government',
  cabinet: 'Cabinet',
  legislature: 'Legislature',
  regional: 'Regional',
};

const filledByLabel: Record<string, string> = {
  elected: 'Elected',
  appointed: 'Appointed',
  succession: 'Succession',
  staff: 'Staff Assigned',
};

/** Everyone who has held an office, newest first; opened via `?office=<id>`. */
function OfficeHistoryModal({ officeId, onClose }: { officeId: string; onClose: () => void }) {
  const { data: office, isLoading, isError } = useOffice(officeId);
  const history = office?.holderHistory ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      title={office?.name ?? 'Office'}
      eyebrow={office ? tierLabel[office.tier] ?? humanizeToken(office.tier) : undefined}
      railClass="bg-accent-offices"
      maxWidth="max-w-lg"
      footer={<button onClick={onClose} className="btn-secondary">Close</button>}
    >
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton height="h-12" />
          <Skeleton height="h-12" />
        </div>
      ) : isError || !office ? (
        <p className="text-body-sm text-text-secondary">This office could not be loaded.</p>
      ) : history.length === 0 ? (
        <p className="text-body-sm italic text-text-tertiary">No one has held this office yet.</p>
      ) : (
        <ol className="relative border-l border-border-subtle ml-2 space-y-4" aria-label="Holders, newest first">
          {history.map((h) => {
            const current = !h.endDate;
            const name = h.playerName || h.discordUsername || 'Unknown';
            return (
              <li key={h.id} className="pl-5 relative">
                <span
                  aria-hidden="true"
                  className={`absolute -left-[5px] top-2 w-2.5 h-2.5 rounded-full ${current ? 'bg-accent-offices' : 'bg-border-strong'}`}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <PlayerAvatar player={{ id: h.playerId, characterName: h.playerName, discordUsername: h.discordUsername ?? '?' }} size="sm" />
                  <Link to="/players/$id" params={{ id: h.playerId }} className="text-body-sm font-medium text-text-primary hover:text-accent-primary">
                    {name}
                  </Link>
                  {current && <Tag color="active">Incumbent</Tag>}
                </div>
                <p className="font-mono text-xs text-text-tertiary mt-1">
                  {formatDate(h.startDate)} &ndash; {h.endDate ? formatDate(h.endDate) : 'present'}
                  {h.simDate && <> · {formatSimDate(h.simDate)}</>}
                </p>
                <p className="text-xs text-text-secondary mt-0.5">
                  {sentenceCase(h.appointmentMethod)}
                  {h.electionId && (
                    <>
                      {' · '}
                      <Link to="/voting/$id" params={{ id: h.electionId }} className="text-accent-primary hover:underline">
                        the election
                      </Link>
                    </>
                  )}
                </p>
                {/* Public record: the same reason appears in the holder's OFFICE_LEFT event. */}
                {h.removalReason && (
                  <p className="text-xs italic text-text-tertiary mt-0.5">Left office: {sentenceCase(h.removalReason)}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Modal>
  );
}

export function Offices() {
  const { data: offices, isLoading, isError, error } = useOffices();
  const [url, setUrl] = useUrlState({ office: '' });

  if (isLoading) return <PageSkeleton />;
  if (isError) {
    return (
      <div className="page">
        <QueryErrorState title="Could not load offices" error={error} />
      </div>
    );
  }

  // Group by tier
  const grouped = tierOrder
    .map((tier) => ({
      tier,
      label: tierLabel[tier] || tier,
      offices: (offices || [])
        .filter((o) => o.tier === tier)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .filter((g) => g.offices.length > 0);

  // Any offices with unknown tiers
  const uncategorized = (offices || []).filter(
    (o) => !tierOrder.includes(o.tier),
  );
  if (uncategorized.length > 0) {
    grouped.push({ tier: 'other', label: 'Other', offices: uncategorized });
  }

  return (
    <div className="page">
      <PageHeader
        title="Offices"
        subtitle={(() => {
          const all = offices ?? [];
          const vacant = all.filter((o) => (o.currentHolders ?? []).length === 0).length;
          return <>Government positions and their current holders &mdash; {all.length} offices{vacant > 0 ? `, ${vacant} vacant` : ''}</>;
        })()}
      />

      {grouped.length === 0 && (
        <div className="card">
          <EmptyState title="No offices have been established yet." />
        </div>
      )}

      <div className="space-y-8">
        {grouped.map((group) => (
          <div key={group.tier}>
            <SectionHeading size="lg" className="mb-4">{group.label}</SectionHeading>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
              {group.offices.map((office) => {
                const holders = office.currentHolders || [];
                const vacant = holders.length === 0;

                return (
                  <div
                    key={office.id}
                    className={`card ${
                      vacant ? 'border-dashed bg-page' : ''
                    }`}
                  >
                    {/* Office name */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <h3 className="font-display font-semibold text-text-primary leading-snug">
                        <button
                          type="button"
                          onClick={() => setUrl({ office: office.id })}
                          className="text-left hover:text-accent-primary transition-colors"
                          title="View past holders"
                        >
                          {office.name}
                        </button>
                      </h3>
                      <Tag color={vacant ? 'closed' : 'active'}>
                        {vacant ? 'Vacant' : 'Held'}
                      </Tag>
                    </div>

                    {/* Current holders */}
                    {holders.length > 0 ? (
                      <div className="space-y-2 mb-3">
                        {holders.map((holder) => {
                          const player = {
                            id: holder.player?.id ?? holder.playerId,
                            characterName: holder.player?.characterName ?? holder.playerName ?? null,
                            discordUsername: holder.player?.discordUsername ?? holder.discordUsername ?? '?',
                          };
                          const holderName = player.characterName || player.discordUsername || '—';

                          return (
                            <div key={holder.id} className="flex items-center gap-2">
                              <PlayerAvatar
                                player={player}
                                size="md"
                              />
                              <div>
                                <Link
                                  to="/players/$id"
                                  params={{ id: holder.playerId }}
                                  className="text-body-sm font-medium text-text-primary hover:text-accent-primary transition-colors"
                                >
                                  {holderName}
                                </Link>
                                <span className="font-mono text-xs text-text-tertiary block" title={relativeTime(holder.startDate)}>
                                  Since {formatDate(holder.startDate)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-body-sm text-text-tertiary italic mb-3">
                        No current holder
                      </p>
                    )}

                    {/* Metadata */}
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-border-subtle">
                      <Tag color="offices">{filledByLabel[office.filledBy] || office.filledBy}</Tag>
                      {office.faction && (
                        <Tag color="players">{office.faction.shortName || office.faction.name}</Tag>
                      )}
                      {office.requiresConfirmation && (
                        <Tag color="voting">Needs confirmation</Tag>
                      )}
                      {office.maxHolders > 1 && (
                        <span className="font-mono text-xs text-text-tertiary">
                          {holders.length}/{office.maxHolders} seats
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setUrl({ office: office.id })}
                        className="ml-auto text-xs text-text-tertiary hover:text-accent-primary"
                        aria-label={`Past holders of ${office.name}`}
                      >
                        History →
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {url.office && <OfficeHistoryModal officeId={url.office} onClose={() => setUrl({ office: '' })} />}
    </div>
  );
}
