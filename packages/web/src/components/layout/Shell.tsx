import React, { useCallback, useEffect, useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Sidebar } from './Sidebar';
import { Icon } from '../shared/Icon';

interface ShellProps {
  children: React.ReactNode;
}

const COLLAPSE_STORAGE_KEY = 'hansard-sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function Shell({ children }: ShellProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Storage unavailable (private mode) — keep the in-memory preference.
      }
      return next;
    });
  }, []);

  // Navigating closes the mobile drawer and resets scroll like a page load.
  useEffect(() => {
    setDrawerOpen(false);
    window.scrollTo?.(0, 0);
  }, [pathname]);

  // Close the drawer with Escape, and when the viewport grows past the
  // breakpoint where the sidebar becomes a permanent rail.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    const mq = window.matchMedia?.('(min-width: 1024px)');
    const onChange = (e: MediaQueryListEvent) => { if (e.matches) setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    mq?.addEventListener?.('change', onChange);
    return () => {
      document.removeEventListener('keydown', onKey);
      mq?.removeEventListener?.('change', onChange);
    };
  }, [drawerOpen]);

  return (
    <div className="min-h-screen bg-page">
      <a href="#main" className="skip-link">Skip to content</a>

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center gap-2 h-14 px-3 bg-page/95 backdrop-blur border-b border-border-subtle">
        <button
          onClick={() => setDrawerOpen(true)}
          className="p-2 -ml-1 rounded-card text-text-secondary hover:text-text-primary hover:bg-hover transition-colors"
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
        >
          <Icon name="menu" size={22} />
        </button>
        <Link to="/" className="font-display italic text-[1.35rem] leading-none text-text-primary">
          Hansard
        </Link>
      </header>

      <Sidebar
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        mobileOpen={drawerOpen}
        onMobileClose={() => setDrawerOpen(false)}
      />

      <main
        id="main"
        tabIndex={-1}
        className={`min-w-0 focus:outline-none transition-[padding] duration-200 ${collapsed ? 'lg:pl-16' : 'lg:pl-60'}`}
      >
        <div key={pathname} className="animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
