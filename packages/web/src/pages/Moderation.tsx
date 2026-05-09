import { useState } from 'react';
import { useModActions, useModStats, type ModAction } from '../api/hooks/useModeration';
import { usePlayers } from '../api/hooks/usePlayers';
import { DataTable, type Column } from '../components/shared/DataTable';
import { Tag } from '../components/shared/Tag';
import { MetricCard } from '../components/shared/MetricCard';
import { Pagination } from '../components/shared/Pagination';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { ModActionModal } from '../components/shared/ModActionModal';
import { QueryErrorState } from '../components/shared/QueryErrorState';

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatExpiry(iso?: string): string {
  if (!iso) return 'Permanent';
  const d = new Date(iso);
  const now = new Date();
  if (d < now) return 'Expired';
  return formatDate(iso);
}

// ---- Main Page ----

export function Moderation() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<'warn' | 'mute' | 'suspend' | null>(null);
  const limit = 20;

  // Look up players matching search to get their ID for filtering
  const { data: playerResults, isError: playerSearchIsError, error: playerSearchError } = usePlayers(
    search.length >= 2 ? { search, limit: 5 } : undefined,
  );
  const matchedPlayerId =
    search.length >= 2 && playerResults?.data?.length === 1
      ? playerResults.data[0].id
      : undefined;

  const { data: stats, isLoading: statsLoading, isError: statsIsError, error: statsError } = useModStats();
  const { data: actionsData, isLoading: actionsLoading, isError: actionsIsError, error: actionsError } = useModActions({
    targetPlayerId: matchedPlayerId,
    page,
    limit,
  });

  const isLoading = statsLoading || actionsLoading;
  if (isLoading) return <PageSkeleton />;
  if (statsIsError || actionsIsError) {
    return (
      <div className="p-8">
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

  // Count warnings this week
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const warningsThisWeek =
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
      render: (row) => (
        <span className="text-body-sm font-medium text-text-primary">
          {row.targetPlayer?.characterName || row.targetPlayer?.discordUsername || row.targetPlayerId}
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
        <span className="text-body-sm text-text-secondary line-clamp-1">
          {row.reason}
        </span>
      ),
    },
    {
      key: 'moderator',
      header: 'Moderator',
      render: (row) => (
        <span className="text-body-sm text-text-secondary">
          {row.moderator?.characterName || row.moderator?.discordUsername || '---'}
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
    <div className="p-8">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-display">Moderation</h1>
          <p className="text-body-sm text-text-tertiary mt-1">
            Staff moderation panel
          </p>
        </div>

        {/* Quick actions */}
        <div className="flex gap-2">
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
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search player by name..."
          className="w-full max-w-md bg-card border border-border-subtle rounded-card px-4 py-2.5 text-body-sm font-body text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-moderation transition-colors"
        />
        {search.length >= 2 && playerResults?.data && playerResults.data.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {playerResults.data.map((p) => (
              <button
                key={p.id}
                onClick={() => setSearch(p.characterName || p.discordUsername)}
                className="text-body-sm text-accent-primary hover:underline"
              >
                {p.characterName || p.discordUsername}
              </button>
            ))}
          </div>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard
          label="Total Actions"
          value={stats?.totalActions ?? 0}
          color="text-accent-moderation"
          borderColor="border-l-accent-moderation"
        />
        <MetricCard
          label="Active Suspensions"
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
                <div className="flex items-start justify-between mb-2">
                  <span className="text-heading-2 text-text-primary">
                    {action.targetPlayer?.characterName ||
                      action.targetPlayer?.discordUsername ||
                      action.targetPlayerId}
                  </span>
                  <Tag color={modTypeTagColor(action.type)}>
                    {TYPE_LABELS[action.type] || action.type}
                  </Tag>
                </div>
                <p className="text-body-sm text-text-secondary mb-3">
                  {action.reason}
                </p>
                <div className="flex items-center justify-between text-mono text-text-tertiary">
                  <span>Expires: {formatExpiry(action.expiresAt)}</span>
                  <span>
                    by {action.moderator?.characterName || action.moderator?.discordUsername || '---'}
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
            emptyMessage="No moderation actions found."
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
