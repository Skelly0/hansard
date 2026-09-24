import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api } from '../../api/client';
import { useAuth } from '../../api/hooks/useAuth';
import type { Player } from '../../api/hooks/usePlayers';
import type { Bill } from '../../api/hooks/useBills';
import type { Document } from '../../api/hooks/useDocuments';
import type { Election } from '../../api/hooks/useVoting';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useDialogBehaviour } from '../shared/Modal';
import { Icon, type IconName } from '../shared/Icon';
import { useTheme } from '../theme/ThemeProvider';
import { humanizeToken, recordNumber } from '../../lib/format';
import { NAV_ITEMS } from './navItems';

interface PaletteItem {
  key: string;
  group: string;
  label: string;
  hint?: string;
  icon: IconName;
  run: () => void;
}

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere. */
export const SHORTCUT_LABEL =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
    ? '⌘K'
    : 'Ctrl K';

/** Whether a keyboard event started in a text field (so "/" should type, not open search). */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Ctrl/⌘+K anywhere, or "/" outside a text field, opens the palette. */
export function useCommandPaletteShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open();
      } else if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        open();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <PaletteDialog onClose={onClose} />;
}

function useSearch<T>(kind: string, path: string, term: string) {
  return useQuery({
    queryKey: ['palette', kind, term],
    queryFn: () => api.get<{ data: T[]; total: number }>(`${path}${path.includes('?') ? '&' : '?'}search=${encodeURIComponent(term)}&limit=5`),
    enabled: term.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogBehaviour(true, onClose, panelRef);
  const navigate = useNavigate();
  const { user, isStaff } = useAuth();
  const { setTheme } = useTheme();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const term = useDebouncedValue(query.trim(), 150);
  const searching = term.length >= 2;

  const players = useSearch<Player>('players', '/players', term);
  const bills = useSearch<Bill>('bills', '/bills', term);
  const documents = useSearch<Document>('documents', '/documents', term);
  const votes = useSearch<Election>('votes', '/elections', term);
  const loading = searching && [players, bills, documents, votes].some((q) => q.isFetching);

  const go = (to: string, params?: Record<string, string>) => () => {
    onClose();
    navigate({ to, params } as never);
  };

  const items = useMemo<PaletteItem[]>(() => {
    const lower = query.trim().toLowerCase();
    const pages: PaletteItem[] = NAV_ITEMS
      .filter((item) => !item.staffOnly || isStaff)
      .filter((item) => !lower || item.label.toLowerCase().includes(lower))
      .map((item) => ({ key: `page:${item.path}`, group: 'Pages', label: item.label, icon: item.icon, run: go(item.path) }));

    const actions: PaletteItem[] = [
      ...(user ? [{ key: 'action:dossier', group: 'Actions', label: 'Your dossier', icon: 'players' as IconName, run: go('/players/$id', { id: user.id }) }] : []),
      { key: 'action:light', group: 'Actions', label: 'Switch to light theme', icon: 'sun', run: () => { setTheme('light'); onClose(); } },
      { key: 'action:dark', group: 'Actions', label: 'Switch to dark theme', icon: 'moon', run: () => { setTheme('dark'); onClose(); } },
      { key: 'action:system', group: 'Actions', label: 'Use system theme', icon: 'monitor', run: () => { setTheme('system'); onClose(); } },
    ].filter((a) => !lower || a.label.toLowerCase().includes(lower)) as PaletteItem[];

    if (!searching) return [...pages, ...actions];

    const found: PaletteItem[] = [
      ...(players.data?.data ?? []).map((p) => ({
        key: `player:${p.id}`, group: 'Characters', icon: 'players' as IconName,
        label: p.characterName || p.discordUsername,
        hint: [p.party?.shortName || p.party?.name, !p.isAlive ? 'deceased' : null].filter(Boolean).join(' · ') || `@${p.discordUsername}`,
        run: go('/players/$id', { id: p.id }),
      })),
      ...(bills.data?.data ?? []).map((b) => ({
        key: `bill:${b.id}`, group: 'Bills', icon: 'bills' as IconName,
        label: b.title, hint: `${recordNumber(b.billNumber)} · ${humanizeToken(b.status)}`,
        run: go('/bills/$slug', { slug: b.slug }),
      })),
      ...(votes.data?.data ?? []).map((v) => ({
        key: `vote:${v.id}`, group: 'Votes', icon: 'voting' as IconName,
        label: v.title, hint: humanizeToken(v.status),
        run: go('/voting/$id', { id: v.id }),
      })),
      ...(documents.data?.data ?? []).map((d) => ({
        key: `doc:${d.id}`, group: 'Documents', icon: 'documents' as IconName,
        label: d.title, hint: d.collection?.name ?? undefined,
        // Documents open in the registry's reader via ?doc=<slug>.
        run: () => { onClose(); navigate({ to: '/documents', search: { doc: d.slug } } as never); },
      })),
    ];
    return [...found, ...pages, ...actions];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searching, players.data, bills.data, votes.data, documents.data, isStaff, user]);

  // Back to the top whenever the list changes: pages and actions filter on
  // the raw query at once, so a stale index could point past the end.
  useEffect(() => setActive(0), [query, term]);
  const current = items.length ? Math.min(active, items.length - 1) : -1;
  useEffect(() => {
    if (current >= 0) document.getElementById(`palette-opt-${current}`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (current >= 0) items[current].run();
    }
  };

  let lastGroup = '';
  return createPortal(
    <div
      className="fixed inset-0 z-[120] bg-[#1b140c]/45 backdrop-blur-[2px] flex items-start justify-center px-3 pt-[8vh] sm:pt-[12vh] animate-fade-in"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search Hansard"
        className="w-full max-w-xl bg-card rounded-card shadow-modal-warm border border-border-subtle overflow-hidden flex flex-col max-h-[75vh] animate-rise-in"
      >
        <div className="flex items-center gap-3 px-4 border-b border-border-subtle">
          <Icon name="search" size={18} className="text-text-tertiary" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search characters, bills, votes, documents…"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-autocomplete="list"
            aria-activedescendant={current >= 0 ? `palette-opt-${current}` : undefined}
            className="flex-1 bg-transparent py-4 text-body text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />
          {loading && <span className="text-xs font-mono text-text-tertiary">searching…</span>}
          <kbd className="hidden sm:inline font-mono text-[0.6875rem] text-text-tertiary border border-border rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        <ul id="palette-list" role="listbox" aria-label="Results" className="overflow-y-auto py-2">
          {items.length === 0 && (
            <li className="px-4 py-6 text-center text-body-sm italic text-text-tertiary">
              {searching && !loading ? `Nothing on the record for “${term}”.` : 'Type at least two letters to search the record.'}
            </li>
          )}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <li key={item.key} role="presentation">
                {header && (
                  <div className="px-4 pt-3 pb-1 text-label-ui text-text-tertiary" aria-hidden="true">{header}</div>
                )}
                <div
                  id={`palette-opt-${i}`}
                  role="option"
                  aria-selected={i === current}
                  onMouseMove={() => setActive(i)}
                  onClick={item.run}
                  className={`mx-2 px-3 py-2 rounded-card flex items-center gap-3 cursor-pointer ${
                    i === current ? 'bg-hover' : ''
                  }`}
                >
                  <Icon name={item.icon} size={17} className={i === current ? 'text-accent-primary' : 'text-text-tertiary'} />
                  <span className="min-w-0 flex-1 truncate text-body-sm text-text-primary">{item.label}</span>
                  {item.hint && <span className="text-xs text-text-tertiary truncate max-w-[40%]">{item.hint}</span>}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="hidden sm:flex items-center gap-4 px-4 py-2 border-t border-border-subtle text-[0.6875rem] font-mono text-text-tertiary">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>/ or {SHORTCUT_LABEL} to search again</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
