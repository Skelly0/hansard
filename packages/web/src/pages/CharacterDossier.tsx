import { useState } from 'react';
import { useParams, Link } from '@tanstack/react-router';
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

function healthDotClass(status: string): string {
  const map: Record<string, string> = {
    healthy: 'bg-[var(--health-healthy)]',
    minor: 'bg-[var(--health-minor)]',
    major: 'bg-[var(--health-major)]',
    critical: 'bg-[var(--health-critical)]',
  };
  return map[status] || map.healthy;
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
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [bioExpanded, setBioExpanded] = useState(false);

  if (isLoading) return <PageSkeleton />;
  if (isError || !player) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2 text-body-sm text-text-tertiary mb-4">
          <Link to="/players" className="hover:text-accent-primary transition-colors">Players</Link>
          <span>/</span>
          <span className="font-mono">{id}</span>
        </div>
        <div className="card border-l-status-rejected">
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

  const bioExcerptLength = 280;
  const hasBioOverflow = (player.characterBio?.length ?? 0) > bioExcerptLength;
  const bioText = player.characterBio || '';
  const bioExcerpt = hasBioOverflow && !bioExpanded
    ? bioText.slice(0, bioExcerptLength).replace(/\s+\S*$/, '') + '\u2026'
    : bioText;

  return (
    <div className="p-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-body-sm text-text-tertiary mb-4">
        <Link to="/players" className="hover:text-accent-primary transition-colors">
          Players
        </Link>
        <span>/</span>
        <span className="text-text-secondary">{displayName}</span>
      </div>

      {/* Deceased banner */}
      {isDeceased && (
        <div className="border-t-[3px] border-accent-graveyard bg-accent-graveyard/[0.06] rounded-card px-5 py-3 mb-6">
          <p className="text-body text-text-secondary italic font-body">
            Deceased
            {player.causeOfDeath && <> &mdash; {player.causeOfDeath}</>}
            {player.currentAge != null && <>, age {player.currentAge}</>}
          </p>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-start gap-6 mb-8">
        {/* Portrait */}
        <PlayerAvatar player={player} size="md" />

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          {/* Name row */}
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-display truncate">{displayName}</h1>
            <div
              className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                isDeceased ? 'bg-status-deceased' : healthDotClass(player.healthStatus)
              }`}
              title={isDeceased ? 'Deceased' : player.healthStatus}
            />
          </div>

          {/* Tags row */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {player.party && (
              <Tag color="players">{player.party.shortName || player.party.name}</Tag>
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

          {/* Bio excerpt */}
          {bioText && (
            <div>
              <p className="text-body text-text-primary">{bioExcerpt}</p>
              {hasBioOverflow && (
                <button
                  onClick={() => setBioExpanded(!bioExpanded)}
                  className="text-body-sm text-accent-primary hover:underline font-medium mt-1"
                >
                  {bioExpanded ? 'Show less' : 'Read more'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="border-b border-border-subtle mb-6">
        <nav className="flex gap-0 -mb-px">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`text-label-ui px-4 py-2.5 border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-accent-primary text-text-primary'
                  : 'border-transparent text-text-tertiary hover:text-text-secondary hover:border-border-subtle'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Tab content ── */}
      {activeTab === 'overview' && <OverviewTab player={player} />}
      {activeTab === 'offices' && <OfficesTab playerId={player.id} inlineOffices={player.offices} />}
      {activeTab === 'legislation' && <LegislationTab playerId={player.id} inlineBills={player.bills} />}
      {activeTab === 'votes' && <VotesTab playerId={player.id} inlineVotes={player.votes} />}
      {activeTab === 'favours' && <FavoursTab player={player} />}
      {activeTab === 'history' && <HistoryTab playerId={player.id} inlineEvents={player.events} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Overview
// ---------------------------------------------------------------------------

function OverviewTab({ player }: { player: PlayerDossier }) {
  return (
    <div className="space-y-6">
      {/* Full bio */}
      {player.characterBio && (
        <div>
          <h2 className="text-heading-2 text-text-secondary mb-3">Biography</h2>
          <div className="card border-l-accent-players">
            <p className="text-body text-text-primary whitespace-pre-wrap leading-relaxed">
              {player.characterBio}
            </p>
          </div>
        </div>
      )}

      {/* Basic stats grid */}
      <div>
        <h2 className="text-heading-2 text-text-secondary mb-3">At a Glance</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Party"
            value={player.party?.name || 'Independent'}
          />
          <StatCard
            label="Faction"
            value={player.faction?.name || 'None'}
          />
          <StatCard
            label="Health"
            value={player.isAlive ? player.healthStatus : 'Deceased'}
          />
          <StatCard
            label="Bills authored"
            value={String(player.bills?.length ?? 0)}
            mono
          />
        </div>
      </div>

      {/* Ailments */}
      {player.ailments && player.ailments.length > 0 && (
        <div>
          <h2 className="text-heading-2 text-text-secondary mb-3">Ailments</h2>
          <div className="space-y-2">
            {player.ailments.map((a, i) => (
              <div key={i} className="card border-l-accent-graveyard flex items-start gap-3">
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

function StatCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="card border-l-accent-players">
      <p className="text-label-ui text-text-tertiary mb-1">{label}</p>
      <p className={`text-body text-text-primary font-medium ${mono ? 'font-mono text-sm' : ''}`}>
        {value}
      </p>
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
      <div className="card border-l-accent-offices">
        <p className="text-body text-text-tertiary italic">No offices held.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-heading-2 text-text-secondary mb-1">Offices Held</h2>
      {offices.map((office, i) => {
        const isCurrent = !office.endDate;
        return (
          <div
            key={`${office.officeId}-${i}`}
            className={`card border-l-accent-offices flex items-start gap-4 ${
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
          className="text-text-primary hover:text-accent-primary transition-colors font-display font-medium"
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
      <h2 className="text-heading-2 text-text-secondary mb-3">Legislation</h2>
      <div className="card border-l-accent-bills">
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
        <span className="text-text-primary font-display font-medium">
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
      <h2 className="text-heading-2 text-text-secondary mb-3">Voting Record</h2>
      <div className="card border-l-accent-voting">
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
        <h2 className="text-heading-2 text-text-secondary mb-3">Favours</h2>
        <div className="card border-l-accent-favours">
          <p className="text-body text-text-tertiary italic">No favour balances recorded.</p>
        </div>
      </div>
    );
  }

  const maxBalance = Math.max(...favours.map((f) => Math.abs(f.balance)), 1);

  return (
    <div>
      <h2 className="text-heading-2 text-text-secondary mb-3">Favour Balances</h2>

      {/* Horizontal bar chart */}
      <div className="card border-l-accent-favours space-y-4">
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
        <h2 className="text-heading-2 text-text-secondary mb-3">Event History</h2>
        <div className="card border-l-accent-graveyard">
          <p className="text-body text-text-tertiary italic">No events recorded.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-heading-2 text-text-secondary mb-3">Event History</h2>
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
