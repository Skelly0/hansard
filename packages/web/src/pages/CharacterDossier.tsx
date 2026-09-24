import { useState } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { EditCharacterModal } from '../components/players/EditCharacterModal';
import { MetricStrip } from '../components/shared/MetricCard';
import { Tabs, tabPanelProps } from '../components/shared/Tabs';
import { useUrlState } from '../hooks/useUrlState';
import {
  usePlayer,
  usePlayerEvents,
  usePlayerBills,
  usePlayerVotes,
  usePlayerOffices,
} from '../api/hooks/usePlayers';
import { Tag, statusToTagColor } from '../components/shared/Tag';
import { DataTable, type Column } from '../components/shared/DataTable';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { PlayerAvatar } from '../components/shared/PlayerAvatar';
import { useAuth } from '../api/hooks/useAuth';
import { Breadcrumbs, SectionHeading } from '../components/shared/PageHeader';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { sentenceCase } from '../lib/format';
import type { PlayerDossier, PlayerEvent } from '../api/hooks/usePlayers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Tab = 'overview' | 'offices' | 'legislation' | 'votes' | 'favours' | 'history';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'offices', label: 'Offices' },
  { key: 'legislation', label: 'Legislation' },
  { key: 'votes', label: 'Votes' },
  { key: 'favours', label: 'Favours' },
  { key: 'history', label: 'History' },
];

function healthDotClass(status?: string | null): string {
  const map: Record<string, string> = {
    healthy: 'bg-[var(--health-healthy)]',
    minor: 'bg-[var(--health-minor)]',
    major: 'bg-[var(--health-major)]',
    critical: 'bg-[var(--health-critical)]',
  };
  return status ? map[status] || map.healthy : 'bg-border-strong';
}

function formatDate(iso?: string): string {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function CharacterDossier() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: player, isLoading, isError } = usePlayer(id);
  const { user, isStaff } = useAuth();
  const [url, setUrl] = useUrlState({ tab: 'overview' });
  const activeTab = (TABS.some((t) => t.key === url.tab) ? url.tab : 'overview') as Tab;
  const setActiveTab = (tab: Tab) => setUrl({ tab });
  const [editing, setEditing] = useState(false);
  useDocumentTitle(player ? player.characterName || player.discordUsername : null);

  if (isLoading) return <PageSkeleton />;
  if (isError || !player) {
    return (
      <div className="page">
        <Breadcrumbs items={[{ label: 'Players', to: '/players' }, { label: 'Not found' }]} />
        <div className="notice notice-danger">
          <h1 className="text-heading-1 text-text-primary mb-2">Character not found</h1>
          <p className="text-body text-text-secondary">
            We couldn&rsquo;t load this dossier. The character may have been removed, or the link may be wrong.
          </p>
        </div>
      </div>
    );
  }

  const displayName = player.characterName || player.discordUsername;
  const isDeceased = !player.isAlive;
  const isSelf = user?.id === player.id;
  const canViewFavours = isStaff || isSelf;
  // Placeholder login rows have no character to edit yet.
  const canEdit = (isStaff || isSelf) && !!player.characterName;
  const visibleTabs = canViewFavours ? TABS : TABS.filter((tab) => tab.key !== 'favours');
  const currentTab = activeTab === 'favours' && !canViewFavours ? 'overview' : activeTab;

  // One-line epigraph under the name; the full biography lives in Overview.
  const bioText = player.characterBio || '';
  const firstSentence = bioText.split(/(?<=[.!?])\s/)[0] ?? '';
  const epigraph = firstSentence.length > 180 ? `${firstSentence.slice(0, 177).replace(/\s+\S*$/, '')}\u2026` : firstSentence;

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: isDeceased ? 'Graveyard' : 'Players', to: isDeceased ? '/graveyard' : '/players' }, { label: displayName }]} />

      {/* Deceased banner */}
      {isDeceased && (
        <div className="notice notice-muted mb-6 flex items-center gap-3">
          <span className="text-label-ui text-text-tertiary">In memoriam</span>
          <p className="text-dek text-text-secondary">
            {player.causeOfDeath ? player.causeOfDeath : 'Deceased'}
            {player.currentAge != null && <>, aged {player.currentAge}</>}
          </p>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-start gap-5 sm:gap-7 mb-6">
        {/* Portrait, mounted like a photograph in a file */}
        <div className="rounded-full p-1 bg-card border border-border-subtle shadow-card flex-shrink-0">
          <PlayerAvatar player={player} size="xl" muted={isDeceased} />
        </div>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          {/* Name row */}
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-display break-words min-w-0">{displayName}</h1>
            {(isDeceased || player.healthStatus) && (
              <span
                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  isDeceased ? 'bg-status-deceased' : healthDotClass(player.healthStatus)
                }`}
                role="img"
                aria-label={isDeceased ? 'Deceased' : `Health: ${player.healthStatus}`}
                title={isDeceased ? 'Deceased' : sentenceCase(player.healthStatus)}
              />
            )}
          </div>

          {/* Tags row */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {player.party && (
              <Link
                to="/parties"
                search={{ party: player.party.id } as never}
                className="rounded-tag hover:opacity-80"
                title={`${player.party.name}: view party`}
              >
                <Tag color="players">{player.party.shortName || player.party.name}</Tag>
              </Link>
            )}
            {player.faction && (
              <Tag color="primary">{player.faction.shortName || player.faction.name}</Tag>
            )}
            {isDeceased && <Tag color="deceased">Deceased</Tag>}
          </div>

          {/* Metadata line */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-text-secondary mb-3">
            {player.currentAge != null && (
              <span>
                <span className="text-label-ui text-text-tertiary mr-1">Age</span>
                <span className="font-mono text-xs">{player.currentAge}</span>
              </span>
            )}
            {player.birthDate && (
              <span>
                <span className="text-label-ui text-text-tertiary mr-1">Born</span>
                <span className="font-mono text-xs">{formatDate(player.birthDate)}</span>
              </span>
            )}
            {player.deathDate && (
              <span>
                <span className="text-label-ui text-text-tertiary mr-1">Died</span>
                <span className="font-mono text-xs">{formatDate(player.deathDate)}</span>
              </span>
            )}
            <span>
              <span className="text-label-ui text-text-tertiary mr-1">Registered</span>
              <span className="font-mono text-xs">{formatDate(player.registeredAt)}</span>
            </span>
          </div>

          {canEdit && (
            <button type="button" onClick={() => setEditing(true)} className="btn-secondary text-body-sm mb-3">
              {isSelf ? 'Edit your character' : 'Edit character'}
            </button>
          )}

          {/* Epigraph */}
          {epigraph && currentTab !== 'overview' && (
            <p className="text-dek text-text-secondary">{epigraph}</p>
          )}
        </div>
      </div>

      <div className="rule-masthead mb-1" aria-hidden="true" />

      {/* ── Tabs ── */}
      <Tabs
        idPrefix="dossier"
        label="Dossier sections"
        items={visibleTabs}
        value={currentTab}
        onChange={setActiveTab}
        className="mb-7 -mx-4 px-4 sm:mx-0 sm:px-0"
      />

      {/* ── Tab content ── */}
      <div {...tabPanelProps('dossier', currentTab)}>
        {currentTab === 'overview' && <OverviewTab player={player} onEdit={isSelf && canEdit ? () => setEditing(true) : undefined} />}
        {currentTab === 'offices' && <OfficesTab playerId={player.id} inlineOffices={player.offices} />}
        {currentTab === 'legislation' && <LegislationTab playerId={player.id} inlineBills={player.bills} />}
        {currentTab === 'votes' && <VotesTab playerId={player.id} inlineVotes={player.votes} />}
        {currentTab === 'favours' && canViewFavours && <FavoursTab player={player} />}
        {currentTab === 'history' && <HistoryTab playerId={player.id} inlineEvents={player.events} />}
      </div>

      {editing && (
        <EditCharacterModal character={player} canRename={isStaff} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Overview
// ---------------------------------------------------------------------------

function OverviewTab({ player, onEdit }: { player: PlayerDossier; onEdit?: () => void }) {
  return (
    <div className="space-y-6">
      {!player.characterBio && onEdit && (
        <div className="card border-dashed bg-page flex flex-wrap items-center justify-between gap-3">
          <p className="text-body-sm italic text-text-secondary">
            Your dossier has no biography yet. Other players see this page.
          </p>
          <button type="button" onClick={onEdit} className="btn-secondary text-body-sm">Write one</button>
        </div>
      )}

      {/* Full bio */}
      {player.characterBio && (
        <div>
          <SectionHeading>Biography</SectionHeading>
          <div className="card">
            <p className="text-body text-text-primary whitespace-pre-wrap leading-relaxed">
              {player.characterBio}
            </p>
          </div>
        </div>
      )}

      {/* Basic stats grid */}
      <div>
        <SectionHeading>At a Glance</SectionHeading>
        <MetricStrip
          size="sm"
          className="grid-cols-2 md:grid-cols-4"
          metrics={[
            { label: 'Party', value: player.party?.name || 'Independent' },
            { label: 'Faction', value: player.faction?.name || 'None' },
            {
              label: 'Health',
              value: player.isAlive ? (player.healthStatus ? sentenceCase(player.healthStatus) : 'Private') : 'Deceased',
            },
            { label: 'Bills authored', value: String(player.bills?.length ?? 0) },
          ]}
        />
      </div>

      {/* Ailments */}
      {player.ailments && player.ailments.length > 0 && (
        <div>
          <SectionHeading>Ailments</SectionHeading>
          <div className="space-y-2">
            {player.ailments.map((a, i) => (
              <div key={i} className="card flex items-start gap-3">
                <div
                  className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${
                    a.severity === 'critical'
                      ? 'bg-[var(--health-critical)]'
                      : a.severity === 'major'
                      ? 'bg-[var(--health-major)]'
                      : 'bg-[var(--health-minor)]'
                  }`}
                />
                <div>
                  <p className="text-body-sm text-text-primary font-medium">{a.condition}</p>
                  <p className="text-body-sm text-text-tertiary">
                    <Tag color={a.severity === 'critical' ? 'rejected' : a.severity === 'major' ? 'pending' : 'closed'}>
                      {a.severity}
                    </Tag>
                    <span className="ml-2 font-mono text-xs">acquired age {a.acquiredAtAge}</span>
                  </p>
                  {a.healsAtDate && (
                    <p className="text-body-sm text-text-tertiary mt-1">
                      Expected recovery: <span className="font-mono text-xs">{a.healsAtDate}</span>
                    </p>
                  )}
                  {a.notes && (
                    <p className="text-body-sm text-text-tertiary italic mt-1">{a.notes}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Tab: Offices
// ---------------------------------------------------------------------------

function OfficesTab({
  playerId,
  inlineOffices,
}: {
  playerId: string;
  inlineOffices?: PlayerDossier['offices'];
}) {
  const { data: fetched } = usePlayerOffices(inlineOffices ? undefined : playerId);
  const offices = inlineOffices ?? fetched ?? [];

  if (offices.length === 0) {
    return (
      <div className="card">
        <p className="text-body text-text-tertiary italic">No offices held.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <SectionHeading>Offices Held</SectionHeading>
      {offices.map((office, i) => {
        const isCurrent = !office.endDate;
        return (
          <div
            key={`${office.officeId}-${i}`}
            className={`card flex items-start gap-4 ${
              isCurrent ? '' : 'opacity-80'
            }`}
          >
            {/* Dot */}
            <div className="flex flex-col items-center pt-1">
              <div
                className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${
                  isCurrent
                    ? 'bg-accent-primary border-accent-primary'
                    : 'bg-text-tertiary border-text-tertiary'
                }`}
              />
            </div>

            {/* Detail */}
            <div className="flex-1 min-w-0">
              <p className="text-body text-text-primary font-medium">
                {office.officeName}
                {isCurrent && (
                  <Tag color="active" className="ml-2">Current</Tag>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-text-tertiary mt-1">
                <span>
                  <span className="text-label-ui mr-1">Appointed</span>
                  <span className="font-mono text-xs">{formatDate(office.startDate)}</span>
                </span>
                {office.endDate && (
                  <span>
                    <span className="text-label-ui mr-1">Left</span>
                    <span className="font-mono text-xs">{formatDate(office.endDate)}</span>
                  </span>
                )}
                <Tag color="offices">{office.appointmentMethod}</Tag>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Legislation
// ---------------------------------------------------------------------------

function LegislationTab({
  playerId,
  inlineBills,
}: {
  playerId: string;
  inlineBills?: PlayerDossier['bills'];
}) {
  const { data: fetched } = usePlayerBills(inlineBills ? undefined : playerId);
  const bills = inlineBills ?? fetched ?? [];

  const columns: Column<NonNullable<PlayerDossier['bills']>[number]>[] = [
    {
      key: 'billNumber',
      header: 'Bill #',
      mono: true,
      minWidth: '70px',
      render: (row) => (
        <Link
          to="/bills/$slug"
          params={{ slug: row.slug }}
          className="text-accent-primary hover:underline"
        >
          #{String(row.billNumber).padStart(3, '0')}
        </Link>
      ),
    },
    {
      key: 'title',
      header: 'Title',
      render: (row) => (
        <Link
          to="/bills/$slug"
          params={{ slug: row.slug }}
          className="text-text-primary hover:text-accent-primary transition-colors font-display font-semibold text-[1.0625rem] leading-snug"
        >
          {row.title}
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      minWidth: '110px',
      render: (row) => (
        <Tag color={statusToTagColor(row.status)}>
          {row.status.replace(/_/g, ' ')}
        </Tag>
      ),
    },
    {
      key: 'submittedAt',
      header: 'Submitted',
      mono: true,
      minWidth: '100px',
      render: (row) => formatDate(row.submittedAt),
    },
  ];

  return (
    <div>
      <SectionHeading>Legislation</SectionHeading>
      <div className="card card-flush">
        <DataTable
          columns={columns}
          data={bills}
          rowKey={(row) => row.id}
          emptyMessage="No bills authored or co-sponsored."
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Votes
// ---------------------------------------------------------------------------

function VotesTab({
  playerId,
  inlineVotes,
}: {
  playerId: string;
  inlineVotes?: PlayerDossier['votes'];
}) {
  const { data: fetched } = usePlayerVotes(inlineVotes ? undefined : playerId);
  const votes = inlineVotes ?? fetched ?? [];

  const columns: Column<NonNullable<PlayerDossier['votes']>[number]>[] = [
    {
      key: 'electionTitle',
      header: 'Election / Bill',
      render: (row) => (
        <span className="text-text-primary font-display font-semibold text-[1.0625rem] leading-snug">
          {row.electionTitle}
        </span>
      ),
    },
    {
      key: 'choice',
      header: 'Vote',
      minWidth: '90px',
      render: (row) => {
        const choice = row.choice ?? 'Private';
        const choiceColor: Record<string, string> = {
          yea: 'passed',
          nay: 'rejected',
          abstain: 'closed',
        };
        return (
          <Tag color={row.choice ? choiceColor[row.choice] || 'primary' : 'closed'}>
            {choice}
          </Tag>
        );
      },
    },
    {
      key: 'castAt',
      header: 'Cast',
      mono: true,
      minWidth: '100px',
      render: (row) => row.castAt ? formatDate(row.castAt) : 'Private',
    },
  ];

  return (
    <div>
      <SectionHeading>Voting Record</SectionHeading>
      <div className="card card-flush">
        <DataTable
          columns={columns}
          data={votes}
          rowKey={(row) => row.electionId}
          emptyMessage="No votes recorded."
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Favours
// ---------------------------------------------------------------------------

function FavoursTab({ player }: { player: PlayerDossier }) {
  const favours = player.favours ?? [];

  if (favours.length === 0) {
    return (
      <div>
        <SectionHeading>Favours</SectionHeading>
        <div className="card">
          <p className="text-body text-text-tertiary italic">No favour balances recorded.</p>
        </div>
      </div>
    );
  }

  const maxBalance = Math.max(...favours.map((f) => Math.abs(f.balance)), 1);

  return (
    <div>
      <SectionHeading>Favour Balances</SectionHeading>

      {/* Horizontal bar chart */}
      <div className="card space-y-4">
        {favours.map((fav) => {
          const pct = Math.abs(fav.balance) / maxBalance * 100;
          const isNegative = fav.balance < 0;

          return (
            <div key={fav.categoryId}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-body-sm text-text-primary font-medium">
                  {fav.categoryName}
                </span>
                <span className={`font-mono text-sm ${isNegative ? 'text-status-rejected' : 'text-accent-players'}`}>
                  {isNegative ? '' : '+'}{fav.balance}
                </span>
              </div>
              <div className="h-5 bg-inset rounded overflow-hidden">
                <div
                  className={`h-full rounded transition-all duration-400 ease-out ${
                    isNegative ? 'bg-status-rejected/60' : 'bg-accent-players/60'
                  }`}
                  style={{ width: `${Math.max(pct, 3)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: History (Event Log)
// ---------------------------------------------------------------------------

function HistoryTab({
  playerId,
  inlineEvents,
}: {
  playerId: string;
  inlineEvents?: PlayerEvent[];
}) {
  const { data: fetched } = usePlayerEvents(inlineEvents ? undefined : playerId);
  const events = inlineEvents ?? fetched ?? [];

  if (events.length === 0) {
    return (
      <div>
        <SectionHeading>Event History</SectionHeading>
        <div className="card">
          <p className="text-body text-text-tertiary italic">No events recorded.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeading>Event History</SectionHeading>
      <div className="space-y-1">
        {events.map((event) => (
          <div
            key={event.id}
            className="flex items-start gap-3 py-3 border-b border-border-subtle last:border-0"
          >
            {/* Timestamp */}
            <div className="w-28 flex-shrink-0">
              <span className="font-mono text-xs text-text-tertiary">
                {formatDate(event.createdAt)}
              </span>
              {event.simDate && (
                <span className="block font-mono text-xs text-text-tertiary">
                  Sim: {event.simDate}
                </span>
              )}
            </div>

            {/* Event type tag */}
            <Tag color="primary" className="flex-shrink-0">
              {event.eventType.replace(/_/g, ' ')}
            </Tag>

            {/* Description */}
            <div className="flex-1 min-w-0">
              <p className="text-body-sm text-text-primary">{event.description}</p>
              {event.triggeredBy && (
                <p className="text-body-sm text-text-tertiary mt-0.5">
                  by{' '}
                  <Link
                    to="/players/$id"
                    params={{ id: event.triggeredById! }}
                    className="hover:text-accent-primary transition-colors"
                  >
                    {event.triggeredBy.characterName}
                  </Link>
                </p>
              )}
            </div>

            {/* Auto badge */}
            {event.isAutomatic && (
              <Tag color="simulation" className="flex-shrink-0">auto</Tag>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
