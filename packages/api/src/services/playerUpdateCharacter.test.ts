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

function fakeDb(existing: Record<string, unknown>) {
  const set = vi.fn(() => ({ where: () => ({ returning: async () => [{ ...existing, ...set.mock.calls[0]?.[0] }] }) }));
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [existing], then: (r: any) => Promise.resolve([existing]).then(r) }) }) }),
    update: () => ({ set }),
    insert: () => ({ values: async () => {} }),
  };
  return { db, set };
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
