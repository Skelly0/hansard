import type { Ailment, ArchivedCharacter, ProfileData } from '../types/players.js';
import type { HealthStatus } from '../constants/statuses.js';

// Subset of the players row that we need to build an archive entry. Kept
// structurally compatible with both Drizzle's $inferSelect and PlayerProfile
// so the helper can be called from either layer without coupling shared to db.
export interface ArchivableCharacter {
  characterName: string | null;
  characterBio: string | null;
  characterPortraitUrl: string | null;
  factionId: string | null;
  partyId: string | null;
  birthDate: string | null;
  startingAge: number | null;
  currentAge: number | null;
  deathDate: string | null;
  causeOfDeath: string | null;
  healthStatus: HealthStatus | string | null;
  ailments: Ailment[] | unknown;
  registeredAt: string | Date;
  profileData?: ProfileData | null | unknown;
}

function toIsoString(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function normalizeHealth(value: HealthStatus | string | null): HealthStatus | null {
  if (value == null) return null;
  return value as HealthStatus;
}

function normalizeAilments(value: Ailment[] | unknown): Ailment[] {
  if (Array.isArray(value)) return value as Ailment[];
  return [];
}

/**
 * Build an ArchivedCharacter snapshot from a player row. Caller is responsible
 * for ensuring this represents a *deceased* character — the helper does not
 * inspect isAlive itself.
 */
export function buildArchivedCharacter(
  player: ArchivableCharacter,
  archivedAt: Date = new Date(),
): ArchivedCharacter {
  if (!player.characterName) {
    throw new Error('Cannot archive a character without a name');
  }
  return {
    characterName: player.characterName,
    characterBio: player.characterBio,
    characterPortraitUrl: player.characterPortraitUrl,
    factionId: player.factionId,
    partyId: player.partyId,
    birthDate: player.birthDate,
    startingAge: player.startingAge,
    currentAge: player.currentAge,
    deathDate: player.deathDate,
    causeOfDeath: player.causeOfDeath,
    healthStatus: normalizeHealth(player.healthStatus),
    ailments: normalizeAilments(player.ailments),
    registeredAt: toIsoString(player.registeredAt),
    archivedAt: archivedAt.toISOString(),
  };
}

/**
 * Append a new archive entry to a player's profileData, preserving any other
 * fields (timezone, pronouns, etc.) and clearing transient lifecycle state
 * (pendingDeath) that does not belong on the new character.
 */
export function profileDataWithArchive(
  profileData: ProfileData | null | unknown,
  archive: ArchivedCharacter,
): ProfileData {
  const base: Record<string, unknown> =
    profileData && typeof profileData === 'object' && !Array.isArray(profileData)
      ? { ...(profileData as Record<string, unknown>) }
      : {};

  delete base.pendingDeath;

  const existing = Array.isArray(base.previousCharacters)
    ? (base.previousCharacters as ArchivedCharacter[])
    : [];

  return {
    ...base,
    previousCharacters: [...existing, archive],
  } as ProfileData;
}
