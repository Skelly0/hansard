import type { IconName } from '../shared/Icon';

/** Module colour keys; each maps to `--c-<key>` fills and `--c-<key>-ink` text. */
export type ModuleAccent =
  | 'primary'
  | 'bills'
  | 'voting'
  | 'players'
  | 'offices'
  | 'favours'
  | 'tickets'
  | 'moderation'
  | 'graveyard'
  | 'simulation';

export interface NavItem {
  label: string;
  path: string;
  icon: IconName;
  accent: ModuleAccent;
  /** Starts a new labelled group in the sidebar. */
  section?: string;
  staffOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: 'dashboard', accent: 'primary' },
  // Administration
  { label: 'Tickets', path: '/tickets', icon: 'tickets', accent: 'tickets', section: 'Administration' },
  { label: 'Moderation', path: '/moderation', icon: 'moderation', accent: 'moderation', staffOnly: true },
  // Legislature
  { label: 'Bills', path: '/bills', icon: 'bills', accent: 'bills', section: 'Legislature' },
  { label: 'Documents', path: '/documents', icon: 'documents', accent: 'bills' },
  { label: 'Voting', path: '/voting', icon: 'voting', accent: 'voting' },
  // People & Power
  { label: 'Players', path: '/players', icon: 'players', accent: 'players', section: 'People & Power' },
  { label: 'Parties', path: '/parties', icon: 'parties', accent: 'offices' },
  { label: 'Offices', path: '/offices', icon: 'offices', accent: 'offices' },
  { label: 'Favours', path: '/favours', icon: 'favours', accent: 'favours' },
  // World
  { label: 'Simulation', path: '/simulation', icon: 'simulation', accent: 'simulation', section: 'World' },
  { label: 'Graveyard', path: '/graveyard', icon: 'graveyard', accent: 'graveyard' },
];

export function isNavItemActive(itemPath: string, currentPath: string): boolean {
  if (itemPath === '/') return currentPath === '/';
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
}

/** The nav entry a path belongs to, with the sidebar section it sits under. */
export function moduleForPath(path: string): (NavItem & { sectionLabel?: string }) | null {
  let section: string | undefined;
  for (const item of NAV_ITEMS) {
    if (item.section) section = item.section;
    if (isNavItemActive(item.path, path)) return { ...item, sectionLabel: section };
  }
  return null;
}

// Literal class names so Tailwind's scanner emits them.
export const ACCENT_TEXT: Record<ModuleAccent, string> = {
  primary: 'text-accent-primary',
  bills: 'text-accent-bills',
  voting: 'text-accent-voting',
  players: 'text-accent-players',
  offices: 'text-accent-offices',
  favours: 'text-accent-favours',
  tickets: 'text-accent-tickets',
  moderation: 'text-accent-moderation',
  graveyard: 'text-accent-graveyard',
  simulation: 'text-accent-simulation',
};

export const ACCENT_FILL: Record<ModuleAccent, string> = {
  primary: 'bg-accent-primary',
  bills: 'bg-accent-bills',
  voting: 'bg-accent-voting',
  players: 'bg-accent-players',
  offices: 'bg-accent-offices',
  favours: 'bg-accent-favours',
  tickets: 'bg-accent-tickets',
  moderation: 'bg-accent-moderation',
  graveyard: 'bg-accent-graveyard',
  simulation: 'bg-accent-simulation',
};
