import { useState } from 'react';
import { useAuth } from '../../api/hooks/useAuth';
import { useNavigate } from '@tanstack/react-router';
import { PlayerAvatar } from '../shared/PlayerAvatar';
import { useTheme, type ThemePreference } from '../theme/ThemeProvider';

interface UserMenuProps {
  collapsed: boolean;
}

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function UserMenu({ collapsed }: UserMenuProps) {
  const { user, logout, isLoading } = useAuth();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

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
    await logout();
    navigate({ to: '/login' });
  };

  return (
    <div className="border-t border-border-subtle relative">
      <button
        onClick={() => setOpen(!open)}
        className={`w-full px-3 py-3 flex items-center gap-2 hover:bg-hover transition-colors ${collapsed ? 'justify-center' : ''}`}
        aria-label="User menu"
      >
        <PlayerAvatar player={{ id: user.id, characterName: null, discordUsername: displayName }} size="sm" />
        {!collapsed && (
          <>
            <span className="text-body-sm text-text-primary truncate flex-1 text-left">{displayName}</span>
            <span className="text-text-tertiary text-xs">▾</span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-2 right-2 mb-1 bg-card border border-border-subtle rounded-card shadow-modal py-1 z-50">
          <div className="px-3 pt-2 pb-1 text-label-ui text-text-tertiary">Theme</div>
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
                    className={`flex-1 text-label-ui rounded-full px-2 py-1 transition-colors ${
                      active
                        ? 'bg-card text-text-primary shadow-modal'
                        : 'text-text-tertiary hover:text-text-secondary'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="border-t border-border-subtle my-1" />
          <button
            onClick={handleLogout}
            className="w-full px-3 py-2 text-left text-body-sm text-text-primary hover:bg-hover"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
