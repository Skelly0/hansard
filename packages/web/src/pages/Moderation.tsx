import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useModActions, useModStats, type ModAction } from '../api/hooks/useModeration';
import { usePlayers } from '../api/hooks/usePlayers';
import { DataTable, type Column } from '../components/shared/DataTable';
import { Tag } from '../components/shared/Tag';
import { MetricCard } from '../components/shared/MetricCard';
import { Pagination } from '../components/shared/Pagination';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { ModActionModal } from '../components/shared/ModActionModal';
import { QueryErrorState } from '../components/shared/QueryErrorState';
import { PageHeader } from '../components/shared/PageHeader';
import { SearchInput } from '../components/shared/FilterBar';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { formatDate as formatDisplayDate, relativeTime } from '../lib/format';

// ---- Type helpers ----

const TYPE_LABELS: Record<string, string> = {
  note: 'Note',
  verbal_warning: 'Verbal Warning',
  formal_warning: 'Formal Warning',
  mute: 'Mute',
  temporary_suspension: 'Suspension',
  permanent_ban: 'Ban',
};

/** Map mod action types to tag colour presets */
function modTypeTagColor(type: string): string {
  switch (type) {
    case 'verbal_warning':
    case 'formal_warning':
      return 'pending';      // amber
    case 'mute':
      return 'tickets';      // slate blue
    case 'temporary_suspension':
      return 'rejected';     // red
    case 'permanent_ban':
      return 'moderation';   // dark red
    default:
      return 'closed';       // muted grey
  }
}

function statusLabel(action: ModAction): string {
  if (action.appealStatus === 'pending') return 'Appealed';
  if (action.appealStatus === 'accepted') return 'Appeal Accepted';
  if (action.appealStatus === 'denied') return 'Appeal Denied';
  return action.isActive ? 'Active' : 'Expired';
}

function statusTagColor(action: ModAction): string {
  if (action.appealStatus === 'pending') return 'pending';
  if (action.appealStatus === 'accepted') return 'passed';
  if (action.appealStatus === 'denied') return 'rejected';
  return action.isActive ? 'active' : 'closed';
}

const formatDate = (iso: string) => formatDisplayDate(iso);

function formatExpiry(iso?: string): string {
  if (!iso) return 'Permanent';
  const d = new Date(iso);
  if (d < new Date()) return 'Expired';
  return `${formatDate(iso)} (${relativeTime(iso)})`;
}

function PlayerLink({ id, player }: { id: string; player?: { characterName?: string | null; discordUsername?: string } | null }) {
  return (
    <Link to="/players/$id" params={{ id }} className="hover:text-accent-primary transition-colors">
      {player?.characterName || player?.discordUsername || 'Unknown player'}
    </Link>
  );
}

// ---- Main Page ----

export function Moderation() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<'warn' | 'mute' | 'suspend' | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const limit = 20;

  // Look up players matching search to get their ID for filtering
  const { data: playerResults, isError: playerSearchIsError, error: playerSearchError } = usePlayers(
    debouncedSearch.length >= 2 ? { search: debouncedSearch, limit: 5 } : undefined,
  );
  const matchedPlayerId =
    debouncedSearch.length >= 2 && playerResults?.data?.length === 1
      ? playerResults.data[0].id
      : undefined;

  const { data: stats, isLoading: statsLoading, isError: statsIsError, error: statsError } = useModStats();
  const { data: actionsData, isLoading: actionsLoading, isError: actionsIsError, error: actionsError } = useModActions({
    targetPlayerId: matchedPlayerId,
    page,
    limit,
  });

  const isLoading = (statsLoading && !stats) || (actionsLoading && !actionsData);
  if (isLoading) return <PageSkeleton />;
  if ((statsIsError && !stats) || (actionsIsError && !actionsData)) {
    return (
      <div className="page">
        <QueryErrorState
          title="Could not load moderation data"
          error={statsIsError ? statsError : actionsError}
        />
      </div>
    );
  }

  const actions = actionsData?.data ?? [];
  const total = actionsData?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  const activeActions = actions.filter((a) => a.isActive);

  // Prefer the server's full-table count; fall back to the recent-actions
  // window for older APIs that don't report it.
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const warningsThisWeek =
    stats?.warningsThisWeek ??
    stats?.recentActions?.filter(
      (a) =>
        (a.type === 'verbal_warning' || a.type === 'formal_warning') &&
        new Date(a.createdAt) >= oneWeekAgo,
    ).length ?? 0;

  // ---- Table columns ----

  const columns: Column<ModAction>[] = [
    {
      key: 'createdAt',
      header: 'Date',
      mono: true,
      minWidth: '100px',
      render: (row) => formatDate(row.createdAt),
    },
    {
      key: 'target',
      header: 'Target',
      primary: true,
      render: (row) => (
        <span className="text-body-sm font-medium text-text-primary">
          <PlayerLink id={row.targetPlayerId} player={row.targetPlayer} />
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      minWidth: '120px',
      render: (row) => (
        <Tag color={modTypeTagColor(row.type)}>
          {TYPE_LABELS[row.type] || row.type}
        </Tag>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (row) => (
        <span className="text-body-sm text-text-secondary line-clamp-2" title={row.reason}>
          {row.reason}
        </span>
      ),
    },
    {
      key: 'moderator',
      header: 'Moderator',
      render: (row) => (
        <span className="text-body-sm text-text-secondary">
          <PlayerLink id={row.moderatorId} player={row.moderator} />
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      minWidth: '100px',
      render: (row) => (
        <Tag color={statusTagColor(row)}>
          {statusLabel(row)}
        </Tag>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Moderation"
        subtitle="Staff moderation panel — every action here is mirrored to the mod log."
        actions={
          <>
            <button
              onClick={() => setModal('warn')}
              className="btn-secondary !border-status-pending !text-status-pending hover:!bg-status-pending/10"
            >
              Warn
            </button>
            <button
              onClick={() => setModal('mute')}
              className="btn-secondary !border-accent-tickets !text-accent-tickets hover:!bg-accent-tickets/10"
            >
              Mute
            </button>
            <button
              onClick={() => setModal('suspend')}
              className="btn-secondary !border-accent-moderation !text-accent-moderation hover:!bg-accent-moderation/10"
            >
              Suspend
            </button>
          </>
        }
      />

      <div className="mb-6">
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Filter the log by player…"
          label="Filter moderation actions by player"
          className="sm:max-w-md"
        />
        {debouncedSearch.length >= 2 && playerResults?.data && playerResults.data.length > 1 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-body-sm">
            <span className="text-text-tertiary">Several matches:</span>
            {playerResults.data.map((p) => (
              <button
                key={p.id}
                onClick={() => setSearch(p.characterName || p.discordUsername)}
                className="text-accent-primary hover:underline"
              >
                {p.characterName || p.discordUsername}
              </button>
            ))}
          </div>
        )}
        {debouncedSearch.length >= 2 && playerResults?.data?.length === 0 && (
          <p className="mt-2 text-body-sm text-text-tertiary italic">No player matches “{debouncedSearch}”.</p>
        )}
        {playerSearchIsError && (
          <QueryErrorState
            title="Could not search players"
            error={playerSearchError}
            className="mt-3 max-w-md"
          />
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
        <MetricCard
          label="Total Actions"
          value={stats?.totalActions ?? 0}
          color="text-accent-moderation"
          borderColor="border-l-accent-moderation"
        />
        <MetricCard
          label="Active Actions"
          value={stats?.activeActions ?? 0}
          color="text-status-rejected"
          borderColor="border-l-accent-moderation"
          subtitle={stats?.activeActions ? 'Currently enforced' : undefined}
        />
        <MetricCard
          label="Warnings This Week"
          value={warningsThisWeek}
          color="text-status-pending"
          borderColor="border-l-accent-moderation"
        />
        <MetricCard
          label="Pending Appeals"
          value={stats?.pendingAppeals ?? 0}
          color="text-accent-primary"
          borderColor="border-l-accent-moderation"
          subtitle={stats?.pendingAppeals ? 'Awaiting review' : undefined}
        />
      </div>

      {/* Active mod actions */}
      {activeActions.length > 0 && (
        <section className="mb-8">
          <h2 className="text-heading-1 mb-4">Active Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {activeActions.map((action) => (
              <div
                key={action.id}
                className="card border-l-accent-moderation"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-heading-2 text-text-primary">
                    <PlayerLink id={action.targetPlayerId} player={action.targetPlayer} />
                  </span>
                  <Tag color={modTypeTagColor(action.type)}>
                    {TYPE_LABELS[action.type] || action.type}
                  </Tag>
                </div>
                <p className="text-body-sm text-text-secondary mb-3">
                  {action.reason}
                </p>
                {action.appealStatus === 'pending' && (
                  <div className="mb-3 rounded-card bg-status-pending/10 border border-status-pending/30 px-3 py-2">
                    <p className="text-label-ui text-status-pending mb-0.5">Appeal pending</p>
                    {action.appealReason && <p className="text-body-sm text-text-secondary italic">“{action.appealReason}”</p>}
                    <p className="text-xs text-text-tertiary mt-1">Review with <code className="font-mono">/mod appeal-review</code> in Discord.</p>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-mono text-xs text-text-tertiary">
                  <span>Expires: {formatExpiry(action.expiresAt)}</span>
                  <span>
                    by <PlayerLink id={action.moderatorId} player={action.moderator} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Full action log */}
      <section>
        <h2 className="text-heading-1 mb-4">Action Log</h2>
        <div className="card border-l-accent-moderation">
          <DataTable
            columns={columns}
            data={actions}
            rowKey={(row) => row.id}
            caption="Moderation action log"
            emptyMessage={matchedPlayerId ? 'No moderation actions for this player.' : 'No moderation actions found.'}
          />
        </div>
      </section>

      {/* Pagination */}
      <Pagination
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
        className="mt-6 justify-center flex"
      />

      {modal && (
        <ModActionModal
          type={modal}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
