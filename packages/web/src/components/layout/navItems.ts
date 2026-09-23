import type { IconName } from '../shared/Icon';

export interface NavItem {
  label: string;
  path: string;
  icon: IconName;
  /** Starts a new labelled group in the sidebar. */
  section?: string;
  staffOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: 'dashboard' },
  // Administration
  { label: 'Tickets', path: '/tickets', icon: 'tickets', section: 'Administration' },
  { label: 'Moderation', path: '/moderation', icon: 'moderation', staffOnly: true },
  // Legislature
  { label: 'Bills', path: '/bills', icon: 'bills', section: 'Legislature' },
  { label: 'Documents', path: '/documents', icon: 'documents' },
  { label: 'Voting', path: '/voting', icon: 'voting' },
  // People & Power
  { label: 'Players', path: '/players', icon: 'players', section: 'People & Power' },
  { label: 'Parties', path: '/parties', icon: 'parties' },
  { label: 'Offices', path: '/offices', icon: 'offices' },
  { label: 'Favours', path: '/favours', icon: 'favours' },
  // World
  { label: 'Simulation', path: '/simulation', icon: 'simulation', section: 'World' },
  { label: 'Graveyard', path: '/graveyard', icon: 'graveyard' },
];

export function isNavItemActive(itemPath: string, currentPath: string): boolean {
  if (itemPath === '/') return currentPath === '/';
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
}
