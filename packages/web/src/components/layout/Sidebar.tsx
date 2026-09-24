import { useEffect, useRef } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useAuth } from '../../api/hooks/useAuth';
import { useSimulationClock } from '../../api/hooks/useSimulation';
import { useAwaitingBallots } from '../../api/hooks/useVoting';
import { Icon } from '../shared/Icon';
import { formatSimDate } from '../../lib/format';
import { UserMenu } from './UserMenu';
import { SHORTCUT_LABEL } from './CommandPalette';
import { ACCENT_TEXT, NAV_ITEMS, isNavItemActive } from './navItems';

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
          fixed left-0 top-0 z-50 h-full bg-sidebar border-r border-border-subtle flex flex-col print:hidden
          w-72 transition-[transform,width] duration-200 ease-out
          ${mobileOpen ? 'translate-x-0 shadow-modal-warm' : '-translate-x-full'}
          lg:translate-x-0 lg:shadow-none
          ${collapsed ? 'lg:w-16' : 'lg:w-60'}
        `}
      >
        {/* Masthead */}
        <div className={`flex items-start gap-2 px-5 pt-5 pb-4 flex-shrink-0 ${railCollapsed ? 'lg:justify-center lg:px-2' : ''}`}>
          <Link
            to="/"
            className={`min-w-0 flex-1 group ${railCollapsed ? 'lg:hidden' : ''}`}
            aria-label="Hansard — dashboard"
          >
            <div className="font-display italic font-medium text-[1.875rem] leading-[0.9] text-text-primary tracking-tight group-hover:text-accent-primary transition-colors">
              Hansard
            </div>
            <div className="text-label-ui text-[0.625rem] tracking-[0.2em] text-text-tertiary mt-1.5">
              The Official Report
            </div>
          </Link>
          {railCollapsed && (
            <Link
              to="/"
              className="hidden lg:flex items-center justify-center w-9 h-9 font-display italic font-semibold text-[1.5rem] text-text-primary hover:text-accent-primary"
              aria-label="Hansard — dashboard"
            >
              H
            </Link>
          )}
          <button
            onClick={onToggle}
            className={`hidden lg:inline-flex text-text-tertiary hover:text-text-primary hover:bg-hover rounded-card transition-colors p-1.5 -mr-1.5 ${railCollapsed ? 'lg:hidden' : ''}`}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={18} />
          </button>
          <button
            ref={closeRef}
            onClick={onMobileClose}
            className="lg:hidden text-text-tertiary hover:text-text-primary hover:bg-hover rounded-card transition-colors p-1.5 -mr-1.5"
            aria-label="Close navigation"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Sitting: season and simulation date */}
        {clock && (
          <div
            className={`mx-5 mb-4 ${railCollapsed ? 'lg:hidden' : ''}`}
            title={`${clock.seasonName} — ${clock.currentDate}${clock.isPaused ? ' (paused)' : ''}`}
          >
            <div className="rule-masthead mb-2.5 opacity-80" aria-hidden="true" />
            <div className="font-display italic text-[0.9375rem] leading-snug text-text-secondary truncate">{clock.seasonName}</div>
            <div className="font-mono text-[0.6875rem] text-text-tertiary mt-0.5 flex items-center gap-1.5">
              {formatSimDate(clock.currentDate)}
              {clock.isPaused && <span className="text-status-pending">· paused</span>}
            </div>
          </div>
        )}
        {railCollapsed && (
          <button
            onClick={onToggle}
            className="hidden lg:flex mx-auto mb-2 text-text-tertiary hover:text-text-primary hover:bg-hover rounded-card transition-colors p-1.5"
            aria-label="Expand sidebar"
            aria-expanded={false}
            title="Expand sidebar"
          >
            <Icon name="chevron-right" size={18} />
          </button>
        )}

        {/* Search */}
        <div className="px-3">
          <button
            onClick={onOpenSearch}
            title={railCollapsed ? `Search (${SHORTCUT_LABEL})` : undefined}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-card border border-border-subtle bg-card shadow-card text-body-sm text-text-tertiary hover:text-text-secondary hover:border-border transition-colors ${
              railCollapsed ? 'lg:justify-center lg:px-0 lg:border-transparent lg:bg-transparent' : ''
            }`}
          >
            <Icon name="search" size={17} />
            <span className={`flex-1 text-left ${railCollapsed ? 'lg:sr-only' : ''}`}>Search…</span>
            <kbd className={`font-mono text-[0.625rem] border border-border rounded px-1 py-px ${railCollapsed ? 'lg:hidden' : ''}`}>{SHORTCUT_LABEL}</kbd>
          </button>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto overscroll-contain pt-1 pb-4">
          {visibleNavItems.map((item, i) => {
            const isActive = isNavItemActive(item.path, currentPath);
            const badge = item.path === '/voting' && awaitingCount > 0 ? awaitingCount : 0;
            return (
              <div key={item.path}>
                {item.section && (
                  <>
                    <div className={`flex items-center gap-2 text-label-ui text-[0.6875rem] tracking-[0.14em] text-text-tertiary px-5 pt-5 pb-1.5 ${railCollapsed ? 'lg:hidden' : ''}`}>
                      {item.section}
                      <span className="flex-1 h-px bg-border" aria-hidden="true" />
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
                    group flex items-center gap-3 mx-3 px-3 py-[7px] rounded-card text-[0.9375rem] font-body border transition-colors relative
                    ${railCollapsed ? 'lg:justify-center lg:px-0' : ''}
                    ${isActive
                      ? 'text-text-primary bg-card border-border-subtle shadow-card font-medium'
                      : 'text-text-secondary border-transparent hover:text-text-primary hover:bg-hover/70'}
                  `}
                >
                  {isActive && (
                    <span className="absolute -left-3 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-accent-primary rounded-r" aria-hidden="true" />
                  )}
                  <span className="relative flex-shrink-0">
                    <Icon
                      name={item.icon}
                      size={19}
                      className={isActive ? ACCENT_TEXT[item.accent] : 'text-text-tertiary group-hover:text-text-secondary'}
                    />
                    {badge > 0 && railCollapsed && (
                      <span className="hidden lg:block absolute -top-1 -right-1 w-2 h-2 rounded-full bg-accent-primary ring-2 ring-sidebar" aria-hidden="true" />
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
