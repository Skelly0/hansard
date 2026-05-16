import { Link } from '@tanstack/react-router';
import { useOffices } from '../api/hooks/useOffices';
import { Tag } from '../components/shared/Tag';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { PlayerAvatar } from '../components/shared/PlayerAvatar';
import { QueryErrorState } from '../components/shared/QueryErrorState';

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

export function Offices() {
  const { data: offices, isLoading, isError, error } = useOffices();

  if (isLoading) return <PageSkeleton />;
  if (isError) {
    return (
      <div className="p-8">
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
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-display">Offices</h1>
        <p className="text-body-sm text-text-tertiary mt-1">
          Government positions and their current holders
        </p>
      </div>

      <div className="space-y-8">
        {grouped.map((group) => (
          <div key={group.tier}>
            <h2 className="text-heading-1 text-text-secondary mb-4">{group.label}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {group.offices.map((office) => {
                const holders = office.currentHolders || [];
                const vacant = holders.length === 0;

                return (
                  <div
                    key={office.id}
                    className={`card border-l-accent-offices ${
                      vacant ? 'opacity-70' : ''
                    }`}
                  >
                    {/* Office name */}
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-display font-semibold text-text-primary">
                        {office.name}
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
                                <span className="font-mono text-xs text-text-tertiary block">
                                  Since {new Date(holder.startDate).toLocaleDateString('en-GB', {
                                    day: 'numeric', month: 'short', year: 'numeric',
                                  })}
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
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
