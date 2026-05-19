import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Favours } from './Favours';
import { useAuth } from '../api/hooks/useAuth';
import {
  useAllFavourBalances,
  useAllFavourCategories,
  useCreateFavourCategory,
  useDeleteFavourCategory,
  useFavourBalances,
  useFavourCategories,
  useFavourHistory,
  useUpdateFavourCategory,
} from '../api/hooks/useFavours';

vi.mock('../api/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../api/hooks/useFavours', () => ({
  useFavourCategories: vi.fn(),
  useAllFavourCategories: vi.fn(),
  useAllFavourBalances: vi.fn(),
  useFavourBalances: vi.fn(),
  useFavourHistory: vi.fn(),
  useCreateFavourCategory: vi.fn(),
  useUpdateFavourCategory: vi.fn(),
  useDeleteFavourCategory: vi.fn(),
}));

describe('Favours', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 'player-1',
        discordId: 'discord-1',
        username: 'ada',
        avatar: null,
        isStaff: false,
        staffRole: null,
        permissions: [],
      },
      isStaff: false,
      permissions: [],
      isLoading: false,
      isError: false,
      error: null,
      hasPermission: () => false,
      logout: vi.fn(),
    } as any);

    vi.mocked(useFavourCategories).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    } as any);
    vi.mocked(useFavourHistory).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    } as any);
    vi.mocked(useAllFavourCategories).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    } as any);
    vi.mocked(useAllFavourBalances).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    } as any);
    vi.mocked(useCreateFavourCategory).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as any);
    vi.mocked(useUpdateFavourCategory).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as any);
    vi.mocked(useDeleteFavourCategory).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as any);
  });

  it('shows the category name returned with a personal favour balance', () => {
    const categoryId = 'c9055a81-e905-4a84-a3b0-2b524f2976fc';
    vi.mocked(useFavourBalances).mockReturnValue({
      data: [
        {
          id: 'balance-1',
          playerId: 'player-1',
          categoryId,
          categoryName: 'Merchant Guild',
          categoryEmoji: null,
          balance: 1,
          updatedAt: '2026-05-19T00:00:00.000Z',
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    render(<Favours />);

    expect(screen.getByText('Merchant Guild')).toBeInTheDocument();
    expect(screen.queryByText(categoryId)).not.toBeInTheDocument();
  });
});
