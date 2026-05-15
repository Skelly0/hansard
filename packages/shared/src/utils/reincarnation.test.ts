import { describe, expect, it } from 'vitest';
import { buildArchivedCharacter, profileDataWithArchive } from './reincarnation.js';
import type { Ailment, ArchivedCharacter, ProfileData } from '../types/players.js';

const ailment: Ailment = {
  condition: 'sepsis',
  severity: 'critical',
  acquiredAtTick: 12,
  acquiredAtAge: 64,
};

const baseRow = {
  characterName: 'Lord Edmund Blackwood',
  characterBio: 'A grim aristocrat.',
  characterPortraitUrl: 'https://example.test/edmund.png',
  factionId: 'fac-1',
  partyId: 'party-1',
  birthDate: '2010-03-04',
  startingAge: 30,
  currentAge: 65,
  deathDate: '2075-08-12',
  causeOfDeath: 'sepsis',
  healthStatus: 'deceased' as const,
  ailments: [ailment],
  registeredAt: new Date('2026-05-01T12:00:00Z'),
  profileData: { timezone: 'Europe/London', pendingDeath: { cause: 'sepsis' } as never } as ProfileData,
};

describe('buildArchivedCharacter', () => {
  it('snapshots the character-shaped fields from a player row', () => {
    const archive = buildArchivedCharacter(baseRow, new Date('2075-09-01T00:00:00Z'));
    expect(archive).toEqual({
      characterName: 'Lord Edmund Blackwood',
      characterBio: 'A grim aristocrat.',
      characterPortraitUrl: 'https://example.test/edmund.png',
      factionId: 'fac-1',
      partyId: 'party-1',
      birthDate: '2010-03-04',
      startingAge: 30,
      currentAge: 65,
      deathDate: '2075-08-12',
      causeOfDeath: 'sepsis',
      healthStatus: 'deceased',
      ailments: [ailment],
      registeredAt: '2026-05-01T12:00:00.000Z',
      archivedAt: '2075-09-01T00:00:00.000Z',
    });
  });

  it('coerces non-array ailments to an empty list', () => {
    const archive = buildArchivedCharacter({ ...baseRow, ailments: null });
    expect(archive.ailments).toEqual([]);
  });

  it('preserves a string registeredAt', () => {
    const archive = buildArchivedCharacter({ ...baseRow, registeredAt: '2026-05-01T12:00:00Z' });
    expect(archive.registeredAt).toBe('2026-05-01T12:00:00Z');
  });

  it('refuses to archive a row without a character name', () => {
    expect(() => buildArchivedCharacter({ ...baseRow, characterName: null })).toThrow();
  });
});

describe('profileDataWithArchive', () => {
  const archive: ArchivedCharacter = buildArchivedCharacter(baseRow, new Date('2075-09-01T00:00:00Z'));

  it('appends to an existing profileData while clearing pendingDeath', () => {
    const next = profileDataWithArchive(
      { timezone: 'Europe/London', pronouns: 'he/him', pendingDeath: { cause: 'sepsis' } as never },
      archive,
    );
    expect(next.timezone).toBe('Europe/London');
    expect(next.pronouns).toBe('he/him');
    expect(next.pendingDeath).toBeUndefined();
    expect(next.previousCharacters).toHaveLength(1);
    expect(next.previousCharacters![0]).toEqual(archive);
  });

  it('handles null profileData by initialising a fresh object', () => {
    const next = profileDataWithArchive(null, archive);
    expect(next.previousCharacters).toEqual([archive]);
    expect(next.pendingDeath).toBeUndefined();
  });

  it('appends to an existing previousCharacters array in order', () => {
    const earlier = { ...archive, characterName: 'Earlier Char' };
    const next = profileDataWithArchive({ previousCharacters: [earlier] }, archive);
    expect(next.previousCharacters).toEqual([earlier, archive]);
  });

  it('treats unexpected shapes for previousCharacters as empty', () => {
    const next = profileDataWithArchive({ previousCharacters: 'not-an-array' as never }, archive);
    expect(next.previousCharacters).toEqual([archive]);
  });
});
