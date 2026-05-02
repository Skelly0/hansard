const PALETTE = [
  'bg-accent-bills',
  'bg-accent-voting',
  'bg-accent-players',
  'bg-accent-offices',
  'bg-accent-tickets',
  'bg-accent-simulation',
  'bg-accent-graveyard',
] as const;

/**
 * Deterministic color from id by hashing characters mod palette length.
 */
export function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length];
}

interface PlayerAvatarProps {
  player: {
    id: string;
    characterName: string | null;
    discordUsername: string;
  };
  size?: 'sm' | 'md';
}

export function PlayerAvatar({ player, size = 'sm' }: PlayerAvatarProps) {
  const initial = (player.characterName ?? player.discordUsername ?? '')
    .trim()
    .charAt(0)
    .toUpperCase() || '?';

  const sizeClasses = size === 'sm'
    ? 'w-[18px] h-[18px] text-[10px]'
    : 'w-8 h-8 text-sm';

  const color = colorForId(player.id);

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full text-text-inverse font-semibold ${sizeClasses} ${color}`}
      aria-label={player.characterName ?? player.discordUsername ?? 'Player'}
    >
      {initial}
    </span>
  );
}
