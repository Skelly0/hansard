import { useEffect, useRef } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useAuth } from '../../api/hooks/useAuth';
import { useSimulationClock } from '../../api/hooks/useSimulation';
import { Icon } from '../shared/Icon';
import { formatSimDate } from '../../lib/format';
import { UserMenu } from './UserMenu';
import { NAV_ITEMS, isNavItemActive } from './navItems';

interface SidebarProps {
  /** Desktop rail collapsed to icons only. Ignored in the mobile drawer. */
  collapsed: boolean;
  onToggle: () => void;
  /** Mobile drawer visibility (below the `lg` breakpoint). */
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const { isStaff, isLoading: authLoading } = useAuth();
  const { data: clock } = useSimulationClock();

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
        className={`fixed inset-0 z-40 bg-black/40 lg:hidden transition-opacity duration-200 ${
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onMobileClose}
        aria-hidden="true"
      />

      <nav
        data-testid="app-sidebar"
        aria-label="Primary"
        className={`
          fixed left-0 top-0 z-50 h-full bg-page border-r border-border-subtle flex flex-col
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

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto overscroll-contain py-2">
          {visibleNavItems.map((item, i) => {
            const isActive = isNavItemActive(item.path, currentPath);
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
                  title={railCollapsed ? item.label : undefined}
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
                  <Icon
                    name={item.icon}
                    size={19}
                    className={isActive ? 'text-accent-primary' : 'text-text-tertiary group-hover:text-text-secondary'}
                  />
                  <span className={railCollapsed ? 'lg:sr-only' : ''}>{item.label}</span>
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
