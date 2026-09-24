import { useState } from 'react';
import { isSafeHttpUrl } from '../../lib/url';

// Ink tones so the cream initial clears WCAG AA on every disc.
const PALETTE = [
  'bg-ink-bills',
  'bg-ink-voting',
  'bg-ink-players',
  'bg-ink-offices',
  'bg-ink-tickets',
  'bg-ink-simulation',
  'bg-ink-graveyard',
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
    characterName?: string | null;
    discordUsername: string;
    characterPortraitUrl?: string | null;
  };
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Greyscale portrait, for the deceased. */
  muted?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<PlayerAvatarProps['size']>, string> = {
  sm: 'w-[22px] h-[22px] text-[11px]',
  md: 'w-8 h-8 text-sm',
  lg: 'w-16 h-16 text-2xl',
  xl: 'w-20 h-20 sm:w-24 sm:h-24 text-[2.25rem] sm:text-[2.75rem]',
};

export function PlayerAvatar({ player, size = 'sm', muted = false }: PlayerAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const name = player.characterName ?? player.discordUsername ?? 'Player';
  const initial = (player.characterName ?? player.discordUsername ?? '')
    .trim()
    .charAt(0)
    .toUpperCase() || '?';

  const sizeClasses = SIZE_CLASSES[size];
  const portrait = player.characterPortraitUrl;
  // Discord attachment URLs expire; fall back to the initial on load error.
  if (portrait && !imageFailed && isSafeHttpUrl(portrait)) {
    return (
      <img
        src={portrait}
        alt={name}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setImageFailed(true)}
        className={`inline-block flex-shrink-0 rounded-full object-cover bg-inset ${sizeClasses} ${muted ? 'grayscale opacity-80' : ''}`}
      />
    );
  }

  const color = muted ? 'bg-ink-graveyard' : colorForId(player.id);

  return (
    <span
      role="img"
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-full text-text-inverse font-display font-semibold leading-none ${sizeClasses} ${color}`}
      aria-label={name}
    >
      {initial}
    </span>
  );
}
