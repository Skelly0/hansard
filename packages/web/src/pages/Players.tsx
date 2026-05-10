import { useState, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { usePlayers } from '../api/hooks/usePlayers';
import { Tag } from '../components/shared/Tag';
import { Pagination } from '../components/shared/Pagination';
import { Skeleton, PageSkeleton } from '../components/shared/SkeletonLoader';
import { PlayerAvatar } from '../components/shared/PlayerAvatar';
import { QueryErrorState } from '../components/shared/QueryErrorState';
import type { Player } from '../api/hooks/usePlayers';

/** Health status to dot colour mapping */
function healthDotClass(status?: string | null): string {
  const map: Record<string, string> = {
    healthy: 'bg-[var(--health-healthy)]',
    minor: 'bg-[var(--health-minor)]',
    major: 'bg-[var(--health-major)]',
    critical: 'bg-[var(--health-critical)]',
  };
  return status ? map[status] || map.healthy : 'bg-border-default';
}

/** Skeleton for a single player card while loading */
function PlayerCardSkeleton() {
  return (
    <div className="card border-l-accent-players p-4">
      <div className="flex items-start gap-3">
        <Skeleton width="w-16" height="h-16" circle />
        <div className="flex-1 min-w-0">
          <Skeleton width="w-3/4" height="h-5" className="mb-2" />
          <Skeleton width="w-1/2" height="h-3.5" className="mb-2" />
          <Skeleton width="w-1/3" height="h-3" />
        </div>
      </div>
    </div>
  );
}

export function Players() {
  const [search, setSearch] = useState('');
  const [factionFilter, setFactionFilter] = useState('');
  const [partyFilter, setPartyFilter] = useState('');
  const [aliveFilter, setAliveFilter] = useState<boolean | undefined>(true);
  const [page, setPage] = useState(1);
  const limit = 24;

  const { data, isLoading, isError, error } = usePlayers({
    search: search || undefined,
    faction: factionFilter || undefined,
    party: partyFilter || undefined,
    alive: aliveFilter,
    page,
    limit,
  });

  const players = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  // Extract unique factions and parties from current results for filter dropdowns.
  // In a production app you'd fetch these from dedicated endpoints, but this works
  // for the initial scaffold.
  const { factions, parties } = useMemo(() => {
    const factionMap = new Map<string, string>();
    const partyMap = new Map<string, string>();
    for (const p of players) {
      if (p.faction) factionMap.set(p.faction.id, p.faction.name);
      if (p.party) partyMap.set(p.party.id, p.party.name);
    }
    return {
      factions: Array.from(factionMap, ([id, name]) => ({ id, name })),
      parties: Array.from(partyMap, ([id, name]) => ({ id, name })),
    };
  }, [players]);

  if (isLoading && page === 1) return <PageSkeleton />;
  if (isError) {
    return (
      <div className="p-8">
        <QueryErrorState title="Could not load players" error={error} />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Page header */}
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-display">Players</h1>
          <p className="text-body-sm text-text-tertiary mt-1">
            Character registry &mdash; {total} player{total !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        {/* Search */}
        <div className="flex-1 min-w-[200px] max-w-sm">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by name..."
            className="w-full bg-card border border-border-subtle rounded-card px-3 py-1.5 text-body-sm font-body text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
          />
        </div>

        {/* Faction */}
        {factions.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-label-ui text-text-tertiary">Faction</label>
            <select
              value={factionFilter}
              onChange={(e) => { setFactionFilter(e.target.value); setPage(1); }}
              className="bg-card border border-border-subtle rounded-card px-3 py-1.5 text-body-sm font-body text-text-primary focus:outline-none focus:border-accent-primary"
            >
              <option value="">All Factions</option>
              {factions.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Party */}
        {parties.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-label-ui text-text-tertiary">Party</label>
            <select
              value={partyFilter}
              onChange={(e) => { setPartyFilter(e.target.value); setPage(1); }}
              className="bg-card border border-border-subtle rounded-card px-3 py-1.5 text-body-sm font-body text-text-primary focus:outline-none focus:border-accent-primary"
            >
              <option value="">All Parties</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Alive / Deceased toggle */}
        <div className="flex items-center gap-2">
          <label className="text-label-ui text-text-tertiary">Status</label>
          <select
            value={aliveFilter === undefined ? 'all' : aliveFilter ? 'alive' : 'deceased'}
            onChange={(e) => {
              const v = e.target.value;
              setAliveFilter(v === 'all' ? undefined : v === 'alive');
              setPage(1);
            }}
            className="bg-card border border-border-subtle rounded-card px-3 py-1.5 text-body-sm font-body text-text-primary focus:outline-none focus:border-accent-primary"
          >
            <option value="all">All</option>
            <option value="alive">Living</option>
            <option value="deceased">Deceased</option>
          </select>
        </div>
      </div>

      {/* Player grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <PlayerCardSkeleton key={i} />
          ))}
        </div>
      ) : players.length === 0 ? (
        <div className="card border-l-accent-players">
          <p className="text-body text-text-tertiary italic">
            No players match the current filters.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {players.map((player) => (
            <PlayerCard key={player.id} player={player} />
          ))}
        </div>
      )}

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
        className="mt-6 justify-center flex"
      />
    </div>
  );
}

function PlayerCard({ player }: { player: Player }) {
  const displayName = player.characterName || player.discordUsername;
  const isDeceased = !player.isAlive;

  return (
    <Link
      to="/players/$id"
      params={{ id: player.id }}
      className="block"
    >
      <div
        className={`card border-l-accent-players p-4 hover:border-border-default transition-colors cursor-pointer ${
          isDeceased ? 'opacity-75' : ''
        }`}
      >
        <div className="flex items-start gap-3">
          {/* Portrait */}
          <PlayerAvatar player={player} size="sm" />

          {/* Info */}
          <div className="flex-1 min-w-0">
            {/* Name + health dot */}
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-heading-2 text-text-primary truncate">
                {displayName}
              </h2>
              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  isDeceased ? 'bg-status-deceased' : healthDotClass(player.healthStatus)
                }`}
                title={isDeceased ? 'Deceased' : player.healthStatus ?? 'Private'}
              />
            </div>

            {/* Party / Faction tags */}
            <div className="flex flex-wrap gap-1 mb-2">
              {player.party && (
                <Tag color="players">{player.party.shortName || player.party.name}</Tag>
              )}
              {player.faction && (
                <Tag color="primary">{player.faction.shortName || player.faction.name}</Tag>
              )}
              {isDeceased && (
                <Tag color="deceased">Deceased</Tag>
              )}
            </div>

            {/* Age + office */}
            <div className="flex items-center gap-3 text-text-tertiary">
              {player.currentAge != null && (
                <span className="font-mono text-xs">
                  Age {player.currentAge}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
