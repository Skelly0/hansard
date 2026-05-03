import { useState } from 'react';
import { useAuth } from '../../api/hooks/useAuth';
import { useNavigate } from '@tanstack/react-router';
import { PlayerAvatar } from '../shared/PlayerAvatar';

interface UserMenuProps {
  collapsed: boolean;
}

export function UserMenu({ collapsed }: UserMenuProps) {
  const { user, logout, isLoading } = useAuth();
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
