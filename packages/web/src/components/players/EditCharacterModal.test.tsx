import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EditCharacterModal } from './EditCharacterModal';

const mutateAsync = vi.fn();

vi.mock('../../api/hooks/usePlayers', () => ({
  CHARACTER_BIO_MAX: 2000,
  CHARACTER_PORTRAIT_URL_MAX: 512,
  useUpdatePlayer: () => ({ mutateAsync, isPending: false }),
}));

const legacy = {
  id: 'p1',
  characterName: 'Ada Vance',
  discordUsername: 'ada',
  characterBio: 'Old bio',
  characterPortraitUrl: 'http://img.example/a.png',
};

describe('EditCharacterModal', () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue({});
  });

  it('saves a bio edit even when the stored portrait predates the https rule', async () => {
    const onClose = vi.fn();
    render(<EditCharacterModal character={legacy} canRename={false} onClose={onClose} />);

    expect(screen.getByText(/not an https link/)).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: /biography/i }), { target: { value: 'New bio' } });
    const save = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.submit(save.form!);

    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    // The untouched legacy portrait is not re-sent, so the API has nothing to reject.
    expect(mutateAsync).toHaveBeenCalledWith({ id: 'p1', characterBio: 'New bio' });
  });

  it('rejects a newly entered http portrait', () => {
    render(<EditCharacterModal character={{ ...legacy, characterPortraitUrl: null }} canRename={false} onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('https://…'), { target: { value: 'http://img.example/b.png' } });
    expect(screen.getByText(/Use an https link/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
