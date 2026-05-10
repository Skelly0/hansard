import { describe, it, expect, vi } from 'vitest';
import { createParty, updateParty } from './partyService';

describe('createParty', () => {
  it('rejects malformed colour', async () => {
    const db: any = { insert: vi.fn() };
    await expect(createParty(db, { name: 'X', colour: 'red' })).rejects.toThrow(/hex/);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('inserts a party with sane defaults and returns the row mapped', async () => {
    const inserted = {
      id: 'p1',
      name: 'New Republic',
      shortName: null,
      factionId: null,
      leaderId: null,
      ideology: null,
      colour: null,
      discordRoleId: null,
      isInviteOnly: false,
      isActive: true,
      foundedAt: new Date('2026-01-01T00:00:00Z'),
      dissolvedAt: null,
    };
    const returning = vi.fn().mockResolvedValue([inserted]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const db: any = { insert };

    const result = await createParty(db, { name: 'New Republic' });
    expect(result.id).toBe('p1');
    expect(result.isInviteOnly).toBe(false);
    expect(result.foundedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Republic', isInviteOnly: false, isActive: true }));
  });

  it('can create an invite-only party', async () => {
    const inserted = {
      id: 'p1',
      name: 'New Republic',
      shortName: null,
      factionId: null,
      leaderId: null,
      ideology: null,
      colour: null,
      discordRoleId: null,
      isInviteOnly: true,
      isActive: true,
      foundedAt: new Date('2026-01-01T00:00:00Z'),
      dissolvedAt: null,
    };
    const returning = vi.fn().mockResolvedValue([inserted]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const db: any = { insert };

    const result = await createParty(db, { name: 'New Republic', isInviteOnly: true });
    expect(result.isInviteOnly).toBe(true);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ isInviteOnly: true }));
  });
});

describe('updateParty', () => {
  it('returns null when the party does not exist', async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db: any = { select };

    const result = await updateParty(db, 'missing-id', { name: 'Y' });
    expect(result).toBeNull();
  });

  it('sets dissolvedAt when isActive flips to false', async () => {
    const existing = {
      id: 'p1', name: 'Old', shortName: null, factionId: null, leaderId: null,
      ideology: null, colour: null, discordRoleId: null, isInviteOnly: false, isActive: true,
      foundedAt: new Date(), dissolvedAt: null,
    };
    const limit = vi.fn().mockResolvedValue([existing]);
    const where1 = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where: where1 });
    const select = vi.fn().mockReturnValue({ from });

    const returning = vi.fn().mockResolvedValue([{ ...existing, isActive: false, dissolvedAt: new Date() }]);
    const where2 = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where: where2 });
    const update = vi.fn().mockReturnValue({ set });

    const db: any = { select, update };

    await updateParty(db, 'p1', { isActive: false });
    const setArg = set.mock.calls[0][0];
    expect(setArg.isActive).toBe(false);
    expect(setArg.dissolvedAt).toBeInstanceOf(Date);
  });

  it('updates invite-only state', async () => {
    const existing = {
      id: 'p1', name: 'Old', shortName: null, factionId: null, leaderId: null,
      ideology: null, colour: null, discordRoleId: null, isInviteOnly: false, isActive: true,
      foundedAt: new Date(), dissolvedAt: null,
    };
    const limit = vi.fn().mockResolvedValue([existing]);
    const where1 = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where: where1 });
    const select = vi.fn().mockReturnValue({ from });

    const returning = vi.fn().mockResolvedValue([{ ...existing, isInviteOnly: true }]);
    const where2 = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where: where2 });
    const update = vi.fn().mockReturnValue({ set });

    const db: any = { select, update };

    const result = await updateParty(db, 'p1', { isInviteOnly: true });
    expect(result?.isInviteOnly).toBe(true);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ isInviteOnly: true }));
  });
});
