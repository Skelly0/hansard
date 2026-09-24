import { useEffect, useRef } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useAuth } from '../../api/hooks/useAuth';
import { useSimulationClock } from '../../api/hooks/useSimulation';
import { useAwaitingBallots } from '../../api/hooks/useVoting';
import { Icon } from '../shared/Icon';
import { formatSimDate } from '../../lib/format';
import { UserMenu } from './UserMenu';
import { SHORTCUT_LABEL } from './CommandPalette';
import { NAV_ITEMS, isNavItemActive } from './navItems';

interface SidebarProps {
  /** Desktop rail collapsed to icons only. Ignored in the mobile drawer. */
  collapsed: boolean;
  onToggle: () => void;
  /** Mobile drawer visibility (below the `lg` breakpoint). */
  mobileOpen: boolean;
  onMobileClose: () => void;
  onOpenSearch: () => void;
}

export function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose, onOpenSearch }: SidebarProps) {
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const { isStaff, isLoading: authLoading } = useAuth();
  const { data: clock } = useSimulationClock();
  const { data: awaiting } = useAwaitingBallots();
  const awaitingCount = awaiting?.total ?? 0;

  const visibleNavItems = NAV_ITEMS.filter((item) => !item.staffOnly || (isStaff && !authLoading));

  // The drawer always shows full labels; the desktop rail may be collapsed.
  const railCollapsed = collapsed && !mobileOpen;

  // Move keyboard focus into the drawer when it opens on small screens.
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (mobileOpen) closeRef.current?.focus({ preventScroll: true });
  }, [mobileOpen]);

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 lg:hidden print:hidden transition-opacity duration-200 ${
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onMobileClose}
        aria-hidden="true"
      />

      <nav
        data-testid="app-sidebar"
        aria-label="Primary"
        className={`
          fixed left-0 top-0 z-50 h-full bg-page border-r border-border-subtle flex flex-col print:hidden
          w-72 transition-[transform,width] duration-200 ease-out
          ${mobileOpen ? 'translate-x-0 shadow-modal-warm' : '-translate-x-full'}
          lg:translate-x-0 lg:shadow-none
          ${collapsed ? 'lg:w-16' : 'lg:w-60'}
        `}
      >
        {/* Masthead */}
        <div className={`flex items-center gap-2 border-b border-border-subtle ${railCollapsed ? 'lg:justify-center lg:px-2' : ''} px-4 h-[68px] flex-shrink-0`}>
          <Link
            to="/"
            className={`min-w-0 flex-1 group ${railCollapsed ? 'lg:hidden' : ''}`}
            aria-label="Hansard — dashboard"
          >
            <div className="font-display italic text-[1.45rem] leading-none text-text-primary tracking-tight group-hover:text-accent-primary transition-colors">
              Hansard
            </div>
            {clock && (
              <div
                className="text-mono text-[0.6875rem] text-text-tertiary truncate mt-1"
                title={`${clock.seasonName} — ${clock.currentDate}${clock.isPaused ? ' (paused)' : ''}`}
              >
                {formatSimDate(clock.currentDate)}
                {clock.isPaused && <span className="text-status-pending"> · paused</span>}
              </div>
            )}
          </Link>
          <button
            onClick={onToggle}
            className="hidden lg:inline-flex text-text-tertiary hover:text-text-primary hover:bg-hover rounded-card transition-colors p-1.5"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={18} />
          </button>
          <button
            ref={closeRef}
            onClick={onMobileClose}
            className="lg:hidden text-text-tertiary hover:text-text-primary hover:bg-hover rounded-card transition-colors p-1.5"
            aria-label="Close navigation"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Search */}
        <div className={`px-2 pt-3 ${railCollapsed ? 'lg:px-2' : ''}`}>
          <button
            onClick={onOpenSearch}
            title={railCollapsed ? `Search (${SHORTCUT_LABEL})` : undefined}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-card border border-border-subtle bg-card text-body-sm text-text-tertiary hover:text-text-secondary hover:border-border transition-colors ${
              railCollapsed ? 'lg:justify-center lg:px-0 lg:border-transparent lg:bg-transparent' : ''
            }`}
          >
            <Icon name="search" size={17} />
            <span className={`flex-1 text-left ${railCollapsed ? 'lg:sr-only' : ''}`}>Search…</span>
            <kbd className={`font-mono text-[0.625rem] border border-border rounded px-1 py-px ${railCollapsed ? 'lg:hidden' : ''}`}>{SHORTCUT_LABEL}</kbd>
          </button>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto overscroll-contain py-2">
          {visibleNavItems.map((item, i) => {
            const isActive = isNavItemActive(item.path, currentPath);
            const badge = item.path === '/voting' && awaitingCount > 0 ? awaitingCount : 0;
            return (
              <div key={item.path}>
                {item.section && (
                  <>
                    <div className={`text-label-ui text-text-tertiary px-5 pt-5 pb-1.5 ${railCollapsed ? 'lg:hidden' : ''}`}>
                      {item.section}
                    </div>
                    {i > 0 && (
                      <div className={`hidden mx-4 my-2 border-t border-border-subtle ${railCollapsed ? 'lg:block' : ''}`} />
                    )}
                  </>
                )}
                <Link
                  to={item.path}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={badge ? `${item.label}, ${badge} awaiting your ballot` : undefined}
                  title={railCollapsed ? (badge ? `${item.label} — ${badge} awaiting your ballot` : item.label) : undefined}
                  className={`
                    group flex items-center gap-3 mx-2 px-3 py-2 rounded-card text-body-sm transition-colors relative
                    ${railCollapsed ? 'lg:justify-center lg:px-0' : ''}
                    ${isActive
                      ? 'text-text-primary bg-hover font-medium'
                      : 'text-text-secondary hover:text-text-primary hover:bg-hover'}
                  `}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-accent-primary rounded-r" aria-hidden="true" />
                  )}
                  <span className="relative flex-shrink-0">
                    <Icon
                      name={item.icon}
                      size={19}
                      className={isActive ? 'text-accent-primary' : 'text-text-tertiary group-hover:text-text-secondary'}
                    />
                    {badge > 0 && railCollapsed && (
                      <span className="hidden lg:block absolute -top-1 -right-1 w-2 h-2 rounded-full bg-accent-primary ring-2 ring-page" aria-hidden="true" />
                    )}
                  </span>
                  <span className={railCollapsed ? 'lg:sr-only' : ''}>{item.label}</span>
                  {badge > 0 && (
                    <span
                      className={`ml-auto min-w-[1.25rem] h-5 px-1.5 rounded-full bg-ink-primary text-text-inverse text-[0.6875rem] font-mono leading-5 text-center ${railCollapsed ? 'lg:hidden' : ''}`}
                      aria-hidden="true"
                    >
                      {badge}
                    </span>
                  )}
                </Link>
              </div>
            );
          })}
        </div>

        <UserMenu collapsed={railCollapsed} />
      </nav>
    </>
  );
}
