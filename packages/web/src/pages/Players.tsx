import { useState, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { usePlayers } from '../api/hooks/usePlayers';
import { useParties } from '../api/hooks/useParties';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { Tag } from '../components/shared/Tag';
import { Pagination } from '../components/shared/Pagination';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { PlayerAvatar } from '../components/shared/PlayerAvatar';
import { QueryErrorState } from '../components/shared/QueryErrorState';
import { PageHeader, EmptyState } from '../components/shared/PageHeader';
import { FilterBar, FilterField, SearchInput } from '../components/shared/FilterBar';
import { plural } from '../lib/format';
import type { Player } from '../api/hooks/usePlayers';

const HEALTH_DOT: Record<string, string> = {
  healthy: 'bg-health-healthy',
  minor: 'bg-health-minor',
  major: 'bg-health-major',
  critical: 'bg-health-critical',
};

const HEALTH_LABEL: Record<string, string> = {
  healthy: 'Healthy',
  minor: 'Minor ailment',
  major: 'Major ailment',
  critical: 'Critical condition',
};

export function Players() {
  const [search, setSearch] = useState('');
  const [factionFilter, setFactionFilter] = useState('');
  const [partyFilter, setPartyFilter] = useState('');
  const [aliveFilter, setAliveFilter] = useState<boolean | undefined>(true);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const limit = 24;

  const { data, isLoading, isError, error, isPlaceholderData } = usePlayers({
    search: debouncedSearch || undefined,
    faction: factionFilter || undefined,
    party: partyFilter || undefined,
    alive: aliveFilter,
    page,
    limit,
  });
  const { data: partyList } = useParties();

  const players = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  // Filter options come from the party registry (stable), not from the
  // current page of results — otherwise choosing a party would empty the
  // dropdown of every other party.
  const { factions, parties } = useMemo(() => {
    const factionMap = new Map<string, string>();
    const partyMap = new Map<string, string>();
    for (const party of partyList ?? []) {
      partyMap.set(party.id, party.name);
      if (party.factionId && party.factionName) factionMap.set(party.factionId, party.factionName);
    }
    for (const p of players) {
      if (p.faction) factionMap.set(p.faction.id, p.faction.name);
      if (p.party) partyMap.set(p.party.id, p.party.name);
    }
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    return {
      factions: Array.from(factionMap, ([id, name]) => ({ id, name })).sort(byName),
      parties: Array.from(partyMap, ([id, name]) => ({ id, name })).sort(byName),
    };
  }, [partyList, players]);

  if (isLoading && !data) return <PageSkeleton />;
  if (isError && !data) {
    return (
      <div className="page">
        <QueryErrorState title="Could not load players" error={error} />
      </div>
    );
  }

  const filtered = !!(debouncedSearch || factionFilter || partyFilter);

  return (
    <div className="page">
      <PageHeader
        title="Players"
        subtitle={<>Character registry &mdash; {plural(total, aliveFilter === false ? 'departed character' : 'character')}</>}
      />

      <FilterBar>
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Search by name…"
          label="Search characters"
        />

        {factions.length > 0 && (
          <FilterField label="Faction">
            <select
              value={factionFilter}
              onChange={(e) => { setFactionFilter(e.target.value); setPage(1); }}
              className="field"
            >
              <option value="">All factions</option>
              {factions.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </FilterField>
        )}

        {parties.length > 0 && (
          <FilterField label="Party">
            <select
              value={partyFilter}
              onChange={(e) => { setPartyFilter(e.target.value); setPage(1); }}
              className="field"
            >
              <option value="">All parties</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </FilterField>
        )}

        <FilterField label="Status">
          <select
            value={aliveFilter === undefined ? 'all' : aliveFilter ? 'alive' : 'deceased'}
            onChange={(e) => {
              const v = e.target.value;
              setAliveFilter(v === 'all' ? undefined : v === 'alive');
              setPage(1);
            }}
            className="field"
          >
            <option value="all">All</option>
            <option value="alive">Living</option>
            <option value="deceased">Deceased</option>
          </select>
        </FilterField>
      </FilterBar>

      {players.length === 0 ? (
        <div className="card border-l-accent-players">
          <EmptyState title={filtered ? 'No characters match these filters.' : 'No characters registered yet.'}>
            {!filtered && 'Players create characters in Discord with /character create.'}
          </EmptyState>
        </div>
      ) : (
        <ul
          className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 sm:gap-4 transition-opacity ${isPlaceholderData ? 'opacity-60' : ''}`}
          aria-busy={isPlaceholderData}
        >
          {players.map((player) => (
            <li key={player.id}>
              <PlayerCard player={player} />
            </li>
          ))}
        </ul>
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
  const health = player.healthStatus ?? null;
  const partyColour = player.party?.colour && /^#[0-9a-f]{6}$/i.test(player.party.colour)
    ? player.party.colour
    : null;

  return (
    <Link
      to="/players/$id"
      params={{ id: player.id }}
      className={`card border-l-accent-players flex items-start gap-3 h-full hover:bg-hover/40 ${isDeceased ? 'opacity-75' : ''}`}
      style={partyColour ? { borderLeftColor: partyColour } : undefined}
    >
      <PlayerAvatar player={player} size="md" muted={isDeceased} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-heading-2 text-text-primary truncate">
            {displayName}
          </h2>
          {(isDeceased || health) && (
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                isDeceased ? 'bg-status-deceased' : HEALTH_DOT[health!] ?? HEALTH_DOT.healthy
              }`}
              title={isDeceased ? 'Deceased' : HEALTH_LABEL[health!] ?? health!}
              role="img"
              aria-label={isDeceased ? 'Deceased' : HEALTH_LABEL[health!] ?? health!}
            />
          )}
        </div>

        <div className="flex flex-wrap gap-1 mb-1.5">
          {player.party ? (
            <Tag color="players">{player.party.shortName || player.party.name}</Tag>
          ) : (
            <span className="text-xs italic text-text-tertiary">Independent</span>
          )}
          {player.faction && (
            <Tag color="primary">{player.faction.shortName || player.faction.name}</Tag>
          )}
          {isDeceased && <Tag color="deceased">Deceased</Tag>}
        </div>

        <div className="flex items-center gap-3 text-text-tertiary font-mono text-xs">
          {player.currentAge != null && <span>Age {player.currentAge}</span>}
          <span className="truncate">@{player.discordUsername}</span>
        </div>
      </div>
    </Link>
  );
}
