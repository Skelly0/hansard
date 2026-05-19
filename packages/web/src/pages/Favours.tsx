import { useState, useMemo, useEffect } from 'react';
import {
  useFavourCategories,
  useAllFavourCategories,
  useAllFavourBalances,
  useFavourBalances,
  useFavourHistory,
  useCreateFavourCategory,
  useUpdateFavourCategory,
  useDeleteFavourCategory,
  type FavourCategory,
  type FavourTransaction,
} from '../api/hooks/useFavours';
import { useAuth } from '../api/hooks/useAuth';
import { DataTable, type Column } from '../components/shared/DataTable';
import { Tag } from '../components/shared/Tag';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { Modal, ConfirmModal } from '../components/shared/Modal';
import { QueryErrorState } from '../components/shared/QueryErrorState';

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

function formatCategoryLabel({
  category,
  categoryName,
  categoryEmoji,
  categoryId,
}: {
  category?: FavourCategory;
  categoryName?: string | null;
  categoryEmoji?: string | null;
  categoryId: string;
}): string {
  if (category) {
    return `${category.emoji || ''} ${category.name}`.trim();
  }

  const label = `${categoryEmoji || ''} ${categoryName || ''}`.trim();
  return label || categoryId;
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
  const { data: categories, isLoading: catLoading, isError: catIsError, error: catError } = useFavourCategories();
  const { data: allBalances, isLoading: balLoading, isError: balIsError, error: balError } = useAllFavourBalances();

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
          characterName: bal.player?.characterName || bal.playerName || bal.player?.discordUsername || bal.discordUsername || pid,
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
  if (catIsError || balIsError) {
    return (
      <QueryErrorState
        title="Could not load favour overview"
        error={catIsError ? catError : balError}
      />
    );
  }

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
        emptyMessage="No exchanges of favour on record."
      />
    </div>
  );
}

function MyFavours({ playerId }: { playerId: string }) {
  const { data: balances, isLoading: balLoading, isError: balIsError, error: balError } = useFavourBalances(playerId);
  const { data: history, isLoading: histLoading, isError: histIsError, error: histError } = useFavourHistory(playerId);
  const { data: categories, isError: catIsError, error: catError } = useFavourCategories();

  const isLoading = balLoading || histLoading;

  // Category lookup for history and for older balance responses that omit categoryName.
  const categoryMap = useMemo(() => {
    const map = new Map<string, FavourCategory>();
    if (categories) {
      for (const c of categories) map.set(c.id, c);
    }
    return map;
  }, [categories]);

  // Build bar data
  const barData = useMemo(() => {
    if (!balances) return [];
    return [...balances]
      .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))
      .map((bal) => ({
        categoryId: bal.categoryId,
        label: formatCategoryLabel({
          category: bal.category ?? categoryMap.get(bal.categoryId),
          categoryName: bal.categoryName,
          categoryEmoji: bal.categoryEmoji,
          categoryId: bal.categoryId,
        }),
        value: bal.balance,
      }));
  }, [balances, categoryMap]);

  const maxBar = useMemo(() => {
    if (!barData.length) return 1;
    return Math.max(...barData.map((b) => Math.abs(b.value)), 1);
  }, [barData]);

  if (isLoading) return <PageSkeleton />;
  if (balIsError || histIsError || catIsError) {
    return (
      <QueryErrorState
        title="Could not load your favours"
        error={balIsError ? balError : histIsError ? histError : catError}
      />
    );
  }

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
            {formatCategoryLabel({
              category: cat,
              categoryName: row.categoryName,
              categoryId: row.categoryId,
            })}
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

// ---- Manage categories (staff) ----

interface CategoryFormState {
  name: string;
  shortName: string;
  description: string;
  emoji: string;
  colour: string;
  spendableOn: string;
  sortOrder: number;
  isActive: boolean;
}

const EMPTY_FORM: CategoryFormState = {
  name: '',
  shortName: '',
  description: '',
  emoji: '',
  colour: '',
  spendableOn: '',
  sortOrder: 0,
  isActive: true,
};

function ManageCategories() {
  const { data: categories, isLoading, isError, error: queryError } = useAllFavourCategories();
  const create = useCreateFavourCategory();
  const update = useUpdateFavourCategory();
  const remove = useDeleteFavourCategory();

  const [editing, setEditing] = useState<FavourCategory | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FavourCategory | null>(null);
  const [form, setForm] = useState<CategoryFormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setCreating(true);
  };

  const openEdit = (cat: FavourCategory) => {
    setCreating(false);
    setEditing(cat);
    setForm({
      name: cat.name,
      shortName: cat.shortName ?? '',
      description: cat.description ?? '',
      emoji: cat.emoji ?? '',
      colour: cat.colour ?? '',
      spendableOn: (cat.spendableOn ?? []).join(', '),
      sortOrder: cat.sortOrder,
      isActive: cat.isActive,
    });
    setError(null);
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
    setError(null);
  };

  const handleSubmit = async () => {
    setError(null);
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    const spendableOn = form.spendableOn
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          name: form.name.trim(),
          shortName: form.shortName.trim() || null,
          description: form.description.trim() || null,
          emoji: form.emoji.trim() || null,
          colour: form.colour.trim() || null,
          spendableOn: spendableOn.length ? spendableOn : null,
          sortOrder: form.sortOrder,
          isActive: form.isActive,
        });
      } else {
        await create.mutateAsync({
          name: form.name.trim(),
          shortName: form.shortName.trim() || undefined,
          description: form.description.trim() || undefined,
          emoji: form.emoji.trim() || undefined,
          colour: form.colour.trim() || undefined,
          spendableOn: spendableOn.length ? spendableOn : undefined,
          sortOrder: form.sortOrder,
        });
      }
      closeForm();
    } catch (e: any) {
      setError(e?.message ?? 'Save failed.');
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await remove.mutateAsync(confirmDelete.id);
      setConfirmDelete(null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not deactivate category.');
    }
  };

  if (isLoading) return <PageSkeleton />;
  if (isError) {
    return <QueryErrorState title="Could not load favour categories" error={queryError} />;
  }

  const sorted = [...(categories ?? [])].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-body-sm text-text-tertiary">
          {sorted.length} categor{sorted.length === 1 ? 'y' : 'ies'} on record
        </p>
        <button onClick={openNew} className="btn-primary text-sm">
          New Category
        </button>
      </div>

      <div className="card border-l-accent-favours">
        {sorted.length === 0 ? (
          <p className="text-body text-text-tertiary italic">
            No categories defined yet.
          </p>
        ) : (
          <div className="space-y-2">
            {sorted.map((cat) => (
              <div
                key={cat.id}
                className={`flex items-center gap-3 py-2 px-2 -mx-2 rounded transition-colors duration-150 hover:bg-hover ${cat.isActive ? '' : 'opacity-60'}`}
              >
                <span className="text-lg w-6 text-center">{cat.emoji || '·'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-display font-medium text-text-primary truncate">
                      {cat.name}
                    </span>
                    {cat.shortName && (
                      <span className="font-mono text-xs text-text-tertiary">
                        {cat.shortName}
                      </span>
                    )}
                    {!cat.isActive && <Tag color="closed">Inactive</Tag>}
                  </div>
                  {cat.description && (
                    <p className="text-body-sm text-text-secondary truncate italic">
                      {cat.description}
                    </p>
                  )}
                </div>
                <span className="font-mono text-xs text-text-tertiary w-10 text-right">
                  #{cat.sortOrder}
                </span>
                <button
                  onClick={() => openEdit(cat)}
                  className="text-body-sm text-accent-primary hover:underline"
                >
                  Edit
                </button>
                {cat.isActive && (
                  <button
                    onClick={() => setConfirmDelete(cat)}
                    className="text-body-sm text-status-rejected hover:underline"
                  >
                    Deactivate
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={creating || !!editing}
        onClose={closeForm}
        title={editing ? `Edit ${editing.name}` : 'New Favour Category'}
        railClass="bg-accent-favours"
        maxWidth="max-w-lg"
        footer={
          <>
            <button onClick={closeForm} className="btn-secondary">Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={create.isPending || update.isPending}
              className="btn-primary disabled:opacity-50"
            >
              {(create.isPending || update.isPending) ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <CategoryFormFields form={form} setForm={setForm} showActiveToggle={!!editing} />
          {error && <p className="text-body-sm text-status-rejected">{error}</p>}
        </div>
      </Modal>

      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        variant="danger"
        title="Deactivate category?"
        message={
          <>
            Deactivating <strong>{confirmDelete?.name}</strong> hides it from spend / grant flows.
            Existing balances and transactions are preserved. You can reactivate it via Edit.
          </>
        }
        confirmLabel="Deactivate"
        pending={remove.isPending}
      />
    </div>
  );
}

function CategoryFormFields({
  form,
  setForm,
  showActiveToggle,
}: {
  form: CategoryFormState;
  setForm: (f: CategoryFormState) => void;
  showActiveToggle: boolean;
}) {
  const fieldClass = 'w-full bg-card border border-border-default rounded-card px-3 py-2 text-body-sm font-body text-text-primary focus:outline-none focus:border-accent-primary transition-colors duration-150';
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-label-ui text-text-tertiary block mb-1">Name *</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={fieldClass}
            autoFocus
          />
        </div>
        <div>
          <label className="text-label-ui text-text-tertiary block mb-1">Short name</label>
          <input
            value={form.shortName}
            onChange={(e) => setForm({ ...form, shortName: e.target.value })}
            className={fieldClass}
          />
        </div>
      </div>
      <div>
        <label className="text-label-ui text-text-tertiary block mb-1">Description</label>
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={2}
          className={`${fieldClass} resize-y`}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-label-ui text-text-tertiary block mb-1">Emoji</label>
          <input
            value={form.emoji}
            onChange={(e) => setForm({ ...form, emoji: e.target.value })}
            placeholder="🤝"
            className={fieldClass}
          />
        </div>
        <div>
          <label className="text-label-ui text-text-tertiary block mb-1">Colour</label>
          <input
            value={form.colour}
            onChange={(e) => setForm({ ...form, colour: e.target.value })}
            placeholder="#C4873B"
            className={`${fieldClass} font-mono`}
          />
        </div>
        <div>
          <label className="text-label-ui text-text-tertiary block mb-1">Sort order</label>
          <input
            type="number"
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })}
            className={`${fieldClass} font-mono`}
          />
        </div>
      </div>
      <div>
        <label className="text-label-ui text-text-tertiary block mb-1">
          Spendable on <span className="italic normal-case text-text-tertiary">(comma-separated tags)</span>
        </label>
        <input
          value={form.spendableOn}
          onChange={(e) => setForm({ ...form, spendableOn: e.target.value })}
          placeholder="bills, appointments, …"
          className={fieldClass}
        />
      </div>
      {showActiveToggle && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            className="accent-accent-favours"
          />
          <span className="text-body-sm text-text-secondary">Active</span>
        </label>
      )}
    </>
  );
}

// ---- Main Page ----

type TabKey = 'staff' | 'my' | 'categories';

export function Favours() {
  const { user, isStaff } = useAuth();
  const [tab, setTab] = useState<TabKey>(isStaff ? 'staff' : 'my');

  // Snap non-staff users away from staff-only tabs if their auth state changes.
  useEffect(() => {
    if (!isStaff && (tab === 'staff' || tab === 'categories')) setTab('my');
  }, [isStaff, tab]);

  // Use the signed-in player's ID; empty disables the query for unauthed users.
  const playerId = user?.id ?? '';

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
        {isStaff && (
          <TabButton active={tab === 'staff'} onClick={() => setTab('staff')}>
            Staff Overview
          </TabButton>
        )}
        <TabButton active={tab === 'my'} onClick={() => setTab('my')}>
          My Favours
        </TabButton>
        {isStaff && (
          <TabButton active={tab === 'categories'} onClick={() => setTab('categories')}>
            Manage Categories
          </TabButton>
        )}
      </div>

      {/* Content */}
      {isStaff && tab === 'categories' && <ManageCategories />}
      {isStaff && tab === 'staff' && <StaffOverview />}
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
