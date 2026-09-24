import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../api/hooks/useAuth';
import { useNavigate } from '@tanstack/react-router';
import { PlayerAvatar } from '../shared/PlayerAvatar';
import { Icon, type IconName } from '../shared/Icon';
import { useTheme, type ThemePreference } from '../theme/ThemeProvider';

interface UserMenuProps {
  collapsed: boolean;
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'monitor' },
];

export function UserMenu({ collapsed }: UserMenuProps) {
  const { user, isStaff, logout, isLoading } = useAuth();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (isLoading) {
    return (
      <div className={`px-4 py-3 border-t border-border-subtle ${collapsed ? 'flex justify-center' : ''}`}>
        <div className="w-7 h-7 rounded-full bg-inset animate-pulse" />
      </div>
    );
  }

  if (!user) return null;

  const displayName = user.username;

  const handleLogout = async () => {
    setOpen(false);
    try {
      await logout();
    } catch {
      // POST /auth/logout is best-effort server-side cookie cleanup. If it
      // rejects (network blip / 5xx / dead-session 401), the mutation's
      // onSettled has already cleared the client cache; we still want to
      // land on /login so the user isn't stranded on a protected page.
    } finally {
      navigate({ to: '/login' });
    }
  };

  return (
    <div ref={rootRef} className="border-t border-border-subtle relative flex-shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className={`w-full px-4 py-3 flex items-center gap-2.5 hover:bg-hover transition-colors ${collapsed ? 'justify-center px-0' : ''}`}
        aria-label="User menu"
        aria-expanded={open}
        title={collapsed ? displayName : undefined}
      >
        <PlayerAvatar player={{ id: user.id, characterName: null, discordUsername: displayName }} size="md" />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-body-sm text-text-primary truncate">{displayName}</span>
              <span className="block text-[0.6875rem] font-mono text-text-tertiary truncate">
                {isStaff ? user.staffRole || 'staff' : 'member'}
              </span>
            </span>
            <Icon name="chevron-down" size={16} className={`text-text-tertiary transition-transform ${open ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {open && (
        <div

          className={`absolute bottom-full mb-1 bg-card border border-border-subtle rounded-card shadow-modal py-1 z-50 animate-fade-in ${
            collapsed ? 'left-2 w-56' : 'left-2 right-2'
          }`}
        >
          <button
            onClick={() => {
              setOpen(false);
              navigate({ to: '/players/$id', params: { id: user.id } });
            }}
            className="w-full px-3 py-2 flex items-center gap-2 text-left text-body-sm text-text-primary hover:bg-hover"
          >
            <Icon name="players" size={16} className="text-text-tertiary" />
            Your dossier
          </button>
          <div className="border-t border-border-subtle my-1" />
          <div className="px-3 pt-1 pb-1.5 text-label-ui text-text-tertiary">Theme</div>
          <div className="px-2 pb-2">
            <div
              role="radiogroup"
              aria-label="Theme"
              className="flex bg-inset border border-border-subtle rounded-full p-0.5 gap-0.5"
            >
              {THEME_OPTIONS.map((opt) => {
                const active = theme === opt.value;
                return (
                  <button
                    key={opt.value}
                    role="radio"
                    aria-checked={active}
                    onClick={() => setTheme(opt.value)}
                    title={opt.label}
                    className={`flex-1 flex items-center justify-center gap-1 text-label-ui normal-case tracking-normal rounded-full px-2 py-1 transition-colors ${
                      active
                        ? 'bg-card text-text-primary shadow-modal'
                        : 'text-text-tertiary hover:text-text-secondary'
                    }`}
                  >
                    <Icon name={opt.icon} size={13} />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="border-t border-border-subtle my-1" />
          <button
            onClick={handleLogout}
            className="w-full px-3 py-2 flex items-center gap-2 text-left text-body-sm text-text-primary hover:bg-hover"
          >
            <Icon name="sign-out" size={16} className="text-text-tertiary" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
