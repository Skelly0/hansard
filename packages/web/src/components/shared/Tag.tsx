interface TagProps {
  children: React.ReactNode;
  color?: string;
  className?: string;
}

/**
 * Colour presets keyed by semantic name.
 * Each maps to [textColour, bgAtOpacity, borderAtOpacity].
 */
const PRESETS: Record<string, { text: string; bg: string; border: string }> = {
  bills:      { text: 'text-accent-bills',      bg: 'bg-accent-bills/[0.08]',      border: 'border-accent-bills/20' },
  voting:     { text: 'text-accent-voting',      bg: 'bg-accent-voting/[0.08]',     border: 'border-accent-voting/20' },
  players:    { text: 'text-accent-players',     bg: 'bg-accent-players/[0.08]',    border: 'border-accent-players/20' },
  offices:    { text: 'text-accent-offices',     bg: 'bg-accent-offices/[0.08]',    border: 'border-accent-offices/20' },
  favours:    { text: 'text-accent-favours',     bg: 'bg-accent-favours/[0.08]',    border: 'border-accent-favours/20' },
  tickets:    { text: 'text-accent-tickets',     bg: 'bg-accent-tickets/[0.08]',    border: 'border-accent-tickets/20' },
  moderation: { text: 'text-accent-moderation',  bg: 'bg-accent-moderation/[0.08]', border: 'border-accent-moderation/20' },
  graveyard:  { text: 'text-accent-graveyard',   bg: 'bg-accent-graveyard/[0.08]',  border: 'border-accent-graveyard/20' },
  simulation: { text: 'text-accent-simulation',  bg: 'bg-accent-simulation/[0.08]', border: 'border-accent-simulation/20' },
  primary:    { text: 'text-accent-primary',     bg: 'bg-accent-primary/[0.08]',    border: 'border-accent-primary/20' },
  // Status presets
  open:       { text: 'text-status-open',        bg: 'bg-status-open/[0.08]',       border: 'border-status-open/20' },
  active:     { text: 'text-status-active',      bg: 'bg-status-active/[0.08]',     border: 'border-status-active/20' },
  pending:    { text: 'text-status-pending',     bg: 'bg-status-pending/[0.08]',    border: 'border-status-pending/20' },
  closed:     { text: 'text-status-closed',      bg: 'bg-status-closed/[0.08]',     border: 'border-status-closed/20' },
  rejected:   { text: 'text-status-rejected',    bg: 'bg-status-rejected/[0.08]',   border: 'border-status-rejected/20' },
  passed:     { text: 'text-status-passed',      bg: 'bg-status-passed/[0.08]',     border: 'border-status-passed/20' },
  deceased:   { text: 'text-status-deceased',    bg: 'bg-status-deceased/[0.08]',   border: 'border-status-deceased/20' },
};

/**
 * Pill-shaped tag with 8% opacity accent background.
 * Pass a `color` key from the design system (e.g. "bills", "passed", "primary")
 * or omit for default primary styling.
 */
export function Tag({ children, color = 'primary', className = '' }: TagProps) {
  const preset = PRESETS[color] || PRESETS.primary;

  return (
    <span
      className={`
        tag border inline-flex items-center
        ${preset.text} ${preset.bg} ${preset.border}
        ${className}
      `}
    >
      {children}
    </span>
  );
}

/** Maps common status strings to tag colour presets */
export function statusToTagColor(status: string): string {
  const map: Record<string, string> = {
    open: 'open',
    draft: 'open',
    submitted: 'open',
    nominations_open: 'open',
    nominations_closed: 'pending',
    voting_open: 'active',
    voting: 'active',
    active: 'active',
    enacted: 'active',
    pending: 'pending',
    npc_pending: 'pending',
    player_passed: 'passed',
    npc_passed: 'passed',
    passed: 'passed',
    certified: 'passed',
    tallied: 'passed',
    voting_closed: 'closed',
    closed: 'closed',
    resolved: 'closed',
    repealed: 'closed',
    player_rejected: 'rejected',
    npc_rejected: 'rejected',
    rejected: 'rejected',
    cancelled: 'rejected',
    runoff_needed: 'pending',
    deceased: 'deceased',
    amended: 'bills',
  };
  return map[status] || 'primary';
}
