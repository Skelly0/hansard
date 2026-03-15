import { useState, useMemo } from 'react';
import {
  useFavourCategories,
  useAllFavourBalances,
  useFavourBalances,
  useFavourHistory,
  type FavourBalance,
  type FavourCategory,
  type FavourTransaction,
} from '../api/hooks/useFavours';
import { DataTable, type Column } from '../components/shared/DataTable';
import { Tag } from '../components/shared/Tag';
import { PageSkeleton } from '../components/shared/SkeletonLoader';

// ---- Types for the matrix view ----

interface PlayerRow {
  playerId: string;
  characterName: string;
  balances: Record<string, number>; // categoryId → balance
}

// ---- Helpers ----

/** Returns an inline style for warm amber tinting based on balance magnitude */
function amberTint(value: number, maxValue: number): React.CSSProperties {
  if (value <= 0 || maxValue <= 0) return {};
  const intensity = Math.min(value / maxValue, 1);
  // Amber tint from transparent to warm amber at 25% opacity
  const alpha = Math.round(intensity * 25);
  return { backgroundColor: `rgba(196, 135, 59, ${alpha / 100})` };
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const TYPE_COLOURS: Record<string, string> = {
  grant: 'passed',
  spend: 'pending',
  remove: 'rejected',
  transfer: 'voting',
  system: 'simulation',
};

// ---- Sub-components ----

function StaffOverview() {
  const { data: categories, isLoading: catLoading } = useFavourCategories();
  const { data: allBalances, isLoading: balLoading } = useAllFavourBalances();

  const isLoading = catLoading || balLoading;

  // Build rows: group balances by player, sorted by name
  const { rows, maxBalance, sortedCategories } = useMemo(() => {
    if (!allBalances || !categories) return { rows: [], maxBalance: 0, sortedCategories: [] };

    const sorted = [...categories].filter((c) => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder);

    const playerMap = new Map<string, PlayerRow>();
    let max = 0;

    for (const bal of allBalances) {
      const pid = bal.playerId;
      if (!playerMap.has(pid)) {
        playerMap.set(pid, {
          playerId: pid,
          characterName: bal.player?.characterName || bal.player?.discordUsername || pid,
          balances: {},
        });
      }
      const row = playerMap.get(pid)!;
      row.balances[bal.categoryId] = bal.balance;
      if (bal.balance > max) max = bal.balance;
    }

    const rowArray = Array.from(playerMap.values()).sort((a, b) =>
      a.characterName.localeCompare(b.characterName),
    );

    return { rows: rowArray, maxBalance: max, sortedCategories: sorted };
  }, [allBalances, categories]);

  if (isLoading) return <PageSkeleton />;

  const columns: Column<PlayerRow>[] = [
    {
      key: 'characterName',
      header: 'Player',
      minWidth: '160px',
      render: (row) => (
        <span className="font-display font-medium text-text-primary">{row.characterName}</span>
      ),
    },
    ...sortedCategories.map(
      (cat): Column<PlayerRow> => ({
        key: cat.id,
        header: `${cat.emoji || ''} ${cat.shortName || cat.name}`.trim(),
        align: 'center',
        mono: true,
        minWidth: '80px',
        render: (row) => {
          const value = row.balances[cat.id] ?? 0;
          return (
            <span
              className="inline-block w-full px-2 py-1 rounded"
              style={amberTint(value, maxBalance)}
            >
              {value}
            </span>
          );
        },
      }),
    ),
  ];

  return (
    <div className="card border-l-accent-favours">
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => row.playerId}
        emptyMessage="No favour balances recorded yet."
      />
    </div>
  );
}

function MyFavours({ playerId }: { playerId: string }) {
  const { data: balances, isLoading: balLoading } = useFavourBalances(playerId);
  const { data: history, isLoading: histLoading } = useFavourHistory(playerId);
  const { data: categories } = useFavourCategories();

  const isLoading = balLoading || histLoading;

  // Build bar data
  const barData = useMemo(() => {
    if (!balances) return [];
    return [...balances]
      .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))
      .map((bal) => ({
        categoryId: bal.categoryId,
        label: bal.category
          ? `${bal.category.emoji || ''} ${bal.category.name}`.trim()
          : bal.categoryId,
        value: bal.balance,
      }));
  }, [balances]);

  const maxBar = useMemo(() => {
    if (!barData.length) return 1;
    return Math.max(...barData.map((b) => Math.abs(b.value)), 1);
  }, [barData]);

  // Category lookup for history
  const categoryMap = useMemo(() => {
    const map = new Map<string, FavourCategory>();
    if (categories) {
      for (const c of categories) map.set(c.id, c);
    }
    return map;
  }, [categories]);

  if (isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      {/* Horizontal bar chart */}
      <div className="card border-l-accent-favours">
        <h2 className="text-heading-2 mb-4">Balances</h2>
        {barData.length === 0 ? (
          <p className="text-body-sm text-text-tertiary italic">No balances to display.</p>
        ) : (
          <div className="space-y-3">
            {barData.map((bar) => (
              <div key={bar.categoryId} className="flex items-center gap-3">
                <span className="text-body-sm text-text-secondary w-40 shrink-0 text-right">
                  {bar.label}
                </span>
                <div className="flex-1 h-7 bg-inset rounded overflow-hidden">
                  <div
                    className="h-full rounded transition-all duration-400 ease-out"
                    style={{
                      width: `${Math.max((Math.abs(bar.value) / maxBar) * 100, 2)}%`,
                      backgroundColor: '#C4873B',
                    }}
                  />
                </div>
                <span className="font-mono text-sm text-text-primary w-12 text-right">
                  {bar.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Transaction history */}
      <div className="card border-l-accent-favours">
        <h2 className="text-heading-2 mb-4">Transaction History</h2>
        {(!history || history.length === 0) ? (
          <p className="text-body-sm text-text-tertiary italic">No transactions yet.</p>
        ) : (
          <TransactionList transactions={history} categoryMap={categoryMap} />
        )}
      </div>
    </div>
  );
}

function TransactionList({
  transactions,
  categoryMap,
}: {
  transactions: FavourTransaction[];
  categoryMap: Map<string, FavourCategory>;
}) {
  const columns: Column<FavourTransaction>[] = [
    {
      key: 'createdAt',
      header: 'Date',
      mono: true,
      minWidth: '110px',
      render: (row) => formatDate(row.createdAt),
    },
    {
      key: 'category',
      header: 'Category',
      minWidth: '120px',
      render: (row) => {
        const cat = row.category || categoryMap.get(row.categoryId);
        return (
          <span className="text-body-sm text-text-secondary">
            {cat ? `${cat.emoji || ''} ${cat.name}`.trim() : row.categoryId}
          </span>
        );
      },
    },
    {
      key: 'amount',
      header: 'Amount',
      mono: true,
      align: 'right',
      minWidth: '80px',
      render: (row) => (
        <span className={row.amount >= 0 ? 'text-status-passed' : 'text-status-rejected'}>
          {row.amount >= 0 ? '+' : ''}{row.amount}
        </span>
      ),
    },
    {
      key: 'balanceAfter',
      header: 'Balance',
      mono: true,
      align: 'right',
      minWidth: '80px',
    },
    {
      key: 'type',
      header: 'Type',
      minWidth: '100px',
      render: (row) => (
        <Tag color={TYPE_COLOURS[row.type] || 'primary'}>
          {row.type}
        </Tag>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (row) => (
        <span className="text-body-sm text-text-secondary">
          {row.reason || '\u2014'}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={transactions}
      rowKey={(row) => row.id}
      emptyMessage="No transactions recorded."
    />
  );
}

// ---- Main Page ----

type TabKey = 'staff' | 'my';

// TODO: Replace with real auth context when available
const MOCK_PLAYER_ID = '';

export function Favours() {
  const [tab, setTab] = useState<TabKey>('staff');

  // If we have a player ID from auth, use it. Otherwise fall back to empty (disabled query).
  const playerId = MOCK_PLAYER_ID;

  return (
    <div className="p-8">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-display">Favours</h1>
          <p className="text-body-sm text-text-tertiary mt-1">
            Favour balances and transaction ledger
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border-subtle">
        <TabButton active={tab === 'staff'} onClick={() => setTab('staff')}>
          Staff Overview
        </TabButton>
        <TabButton active={tab === 'my'} onClick={() => setTab('my')}>
          My Favours
        </TabButton>
      </div>

      {/* Content */}
      {tab === 'staff' && <StaffOverview />}
      {tab === 'my' && (
        playerId ? (
          <MyFavours playerId={playerId} />
        ) : (
          <div className="card border-l-accent-favours">
            <p className="text-body text-text-secondary italic">
              Sign in to view your personal favour balances and history.
            </p>
          </div>
        )
      )}
    </div>
  );
}

// ---- Tab button ----

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        px-4 py-2.5 text-body-sm font-medium transition-colors relative
        ${active
          ? 'text-text-primary'
          : 'text-text-tertiary hover:text-text-secondary'
        }
      `}
    >
      {children}
      {active && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent-favours" />
      )}
    </button>
  );
}
