import { Link, useRouterState } from '@tanstack/react-router';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

interface NavItem {
  label: string;
  path: string;
  icon: string;
  section?: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: '📊' },
  // Administration
  { label: 'Tickets', path: '/tickets', icon: '📋', section: 'Administration' },
  { label: 'Moderation', path: '/moderation', icon: '🔨' },
  // Legislature
  { label: 'Bills', path: '/bills', icon: '📜', section: 'Legislature' },
  { label: 'Documents', path: '/documents', icon: '📄' },
  { label: 'Voting', path: '/voting', icon: '🗳️' },
  // People & Power
  { label: 'Players', path: '/players', icon: '👤', section: 'People & Power' },
  { label: 'Offices', path: '/offices', icon: '🏛️' },
  { label: 'Favours', path: '/favours', icon: '🤝' },
  // World
  { label: 'Simulation', path: '/simulation', icon: '⏳', section: 'World' },
  { label: 'Graveyard', path: '/graveyard', icon: '⚰️' },
];

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  return (
    <nav
      className="fixed left-0 top-0 h-full bg-page border-r border-border-subtle flex flex-col transition-[width] duration-200 z-50"
      style={{ width: collapsed ? 56 : 220 }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-border-subtle">
        {!collapsed && (
          <h1 className="font-display text-heading-1 text-text-primary tracking-tight">
            Hansard
          </h1>
        )}
        <button
          onClick={onToggle}
          className="ml-auto text-text-tertiary hover:text-text-primary transition-colors p-1"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '→' : '←'}
        </button>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-2">
        {NAV_ITEMS.map((item, i) => {
          const isActive = item.path === '/'
            ? currentPath === '/'
            : currentPath.startsWith(item.path);

          return (
            <div key={item.path}>
              {/* Section header */}
              {item.section && !collapsed && (
                <div className="text-label-ui text-text-tertiary px-4 pt-5 pb-2">
                  {item.section}
                </div>
              )}
              {item.section && collapsed && i > 0 && (
                <div className="mx-3 my-2 border-t border-border-subtle" />
              )}

              {/* Nav item */}
              <Link
                to={item.path}
                className={`
                  flex items-center gap-3 px-4 py-2.5 mx-2 rounded-card
                  text-body-sm transition-colors relative
                  ${isActive
                    ? 'text-text-primary bg-hover font-medium'
                    : 'text-text-secondary hover:text-text-primary hover:bg-hover'
                  }
                `}
              >
                {/* Active indicator — terracotta left border */}
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-accent-primary rounded-r" />
                )}
                <span className="text-base flex-shrink-0">{item.icon}</span>
                {!collapsed && <span>{item.label}</span>}
              </Link>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      {!collapsed && (
        <div className="px-4 py-3 border-t border-border-subtle">
          <p className="text-mono text-text-tertiary text-xs">
            DPS Season Manager
          </p>
        </div>
      )}
    </nav>
  );
}
