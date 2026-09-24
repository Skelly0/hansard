import { describe, expect, it, vi } from 'vitest';
import { updateCharacter } from './playerService';

function playerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1', discordId: '1', discordUsername: 'ada', characterName: 'Ada', characterBio: null,
    characterPortraitUrl: 'https://cdn.discordapp.com/attachments/1/2/old.png', factionId: null, partyId: null,
    birthDate: null, startingAge: null, currentAge: null, deathDate: null, causeOfDeath: null, isAlive: true,
    healthStatus: 'healthy', ailments: [], startingFavoursGranted: false, isActive: true, isStaff: false,
    staffRole: null, registeredAt: new Date('2026-01-01'), lastActiveAt: null,
    profileData: { pronouns: 'she/her', characterPortraitAttachment: { channelId: 'c', messageId: 'm', attachmentId: 'a' } },
    ...overrides,
  };
}

function fakeDb(existing: Record<string, unknown>, { failUpdate = false } = {}) {
  const set = vi.fn(() => ({
    where: () => ({
      returning: async () => {
        if (failUpdate) throw Object.assign(new Error('duplicate key'), { code: '23505' });
        return [{ ...existing, ...set.mock.calls[0]?.[0] }];
      },
    }),
  }));
  const values = vi.fn(async () => {});
  const db: any = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [existing], then: (r: any) => Promise.resolve([existing]).then(r) }) }) }),
    update: () => ({ set }),
    insert: () => ({ values }),
  };
  db.transaction = async (fn: (tx: unknown) => unknown) => fn(db);
  return { db, set, values };
}

describe('updateCharacter portrait handling', () => {
  it('drops the Discord upload reference when a new portrait URL is set', async () => {
    const { db, set } = fakeDb(playerRow());
    await updateCharacter(db as any, 'p1', { characterPortraitUrl: 'https://example.org/new.png' });
    expect(set).toHaveBeenCalledWith({
      characterPortraitUrl: 'https://example.org/new.png',
      profileData: { pronouns: 'she/her' },
    });
  });

  it('stores null when the portrait is cleared', async () => {
    const { db, set } = fakeDb(playerRow({ profileData: null }));
    await updateCharacter(db as any, 'p1', { characterPortraitUrl: '' });
    expect(set).toHaveBeenCalledWith({ characterPortraitUrl: null });
  });
});

describe('updateCharacter renames', () => {
  it('logs the name change together with the update', async () => {
    const { db, values } = fakeDb(playerRow());
    await updateCharacter(db as any, 'p1', { characterName: 'Ada Vance' });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ newValue: { characterName: 'Ada Vance' } }));
  });

  it('writes no name-change event when the rename hits a taken name', async () => {
    const { db, values } = fakeDb(playerRow(), { failUpdate: true });
    await expect(updateCharacter(db as any, 'p1', { characterName: 'Taken Name' })).rejects.toThrow('duplicate key');
    expect(values).not.toHaveBeenCalled();
  });
});
