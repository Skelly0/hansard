import type {
  AilmentSeverity,
  HealthStatus,
  PlayerEventType,
  OfficeTier,
  OfficeFilledBy,
  AppointmentMethod,
} from '../constants/statuses.js';

// ============================================================
// Ailment (JSONB on players table)
// ============================================================

export interface Ailment {
  condition: string;
  severity: AilmentSeverity;
  acquiredAtTick: number;
  acquiredAtAge: number;
  durationYears?: number;
  healsAtDate?: string;
  notes?: string;
}

export interface DeathAilment {
  condition: string;
  severity: AilmentSeverity;
}

export interface PendingDeath {
  cause: string;
  triggeredTick: number;
  triggeredDate: string;
  eligibleFromTick: number;
  eligibleFromDate: string;
  ageAtProc: number | null;
  ailments?: DeathAilment[];
}

// ============================================================
// Archived Character (JSONB on players.profileData.previousCharacters)
// ============================================================
// When a player reincarnates after their character dies, the previous
// character's snapshot is appended to profileData.previousCharacters so the
// graveyard and dossier can still surface the dead character on the same
// player row.

export interface ArchivedCharacter {
  characterName: string;
  characterBio: string | null;
  characterPortraitUrl: string | null;
  factionId: string | null;
  partyId: string | null;
  birthDate: string | null;
  startingAge: number | null;
  currentAge: number | null;
  deathDate: string | null;
  causeOfDeath: string | null;
  healthStatus: HealthStatus | null;
  ailments: Ailment[];
  registeredAt: string;
  archivedAt: string;
}

// ============================================================
// Profile Data (JSONB on players table)
// ============================================================

export interface ProfileData {
  timezone?: string;
  pronouns?: string;
  pendingDeath?: PendingDeath;
  previousCharacters?: ArchivedCharacter[];
  [key: string]: unknown;
}

// ============================================================
// Player Profile — the shape returned by API / used in webapp
// ============================================================

export interface PlayerProfile {
  id: string;
  discordId: string;
  discordUsername: string;

  // Character
  characterName: string | null;
  characterBio: string | null;
  characterPortraitUrl: string | null;

  // Affiliation
  factionId: string | null;
  partyId: string | null;

  // Aging & lifecycle
  birthDate: string | null;
  startingAge: number | null;
  currentAge: number | null;
  deathDate: string | null;
  causeOfDeath: string | null;
  isAlive: boolean;

  // Health
  healthStatus: HealthStatus | null;
  ailments: Ailment[];

  // Starting favour bonus
  startingFavoursGranted: boolean;

  // Status
  isActive: boolean;
  isStaff: boolean;
  staffRole: string | null;

  // Metadata
  registeredAt: string;
  lastActiveAt: string | null;
  profileData: ProfileData | null;
}

// ============================================================
// Player Event Log Entry
// ============================================================

export interface PlayerEvent {
  id: string;
  playerId: string;
  eventType: PlayerEventType;
  description: string;
  oldValue: unknown;
  newValue: unknown;
  simTick: number | null;
  simDate: string | null;
  triggeredById: string | null;
  isAutomatic: boolean;
  createdAt: string;
}

// ============================================================
// Faction & Party
// ============================================================

export interface Faction {
  id: string;
  name: string;
  shortName: string | null;
  description: string | null;
  colour: string | null;
  discordRoleId: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface Party {
  id: string;
  name: string;
  shortName: string | null;
  factionId: string | null;
  leaderId: string | null;
  ideology: string | null;
  colour: string | null;
  discordRoleId: string | null;
  isInviteOnly: boolean;
  isActive: boolean;
  foundedAt: string;
  dissolvedAt: string | null;
}

export interface CreatePartyInput {
  name: string;
  shortName?: string | null;
  factionId?: string | null;
  leaderId?: string | null;
  ideology?: string | null;
  colour?: string | null;
  discordRoleId?: string | null;
  isInviteOnly?: boolean;
}

export interface UpdatePartyInput {
  name?: string;
  shortName?: string | null;
  factionId?: string | null;
  leaderId?: string | null;
  ideology?: string | null;
  colour?: string | null;
  discordRoleId?: string | null;
  isInviteOnly?: boolean;
  isActive?: boolean;
}

export interface PartyWithStats extends Party {
  memberCount: number;
  factionName?: string | null;
  leaderName?: string | null;
}

// ============================================================
// Office & Office Holders
// ============================================================

export interface Office {
  id: string;
  name: string;
  tier: OfficeTier;
  factionId: string | null;
  maxHolders: number;
  permissions: string[] | null;
  filledBy: OfficeFilledBy;
  appointableBy: string | null;
  requiresConfirmation: boolean;
  discordRoleId: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface OfficeHolder {
  id: string;
  officeId: string;
  playerId: string;
  startDate: string;
  endDate: string | null;
  appointedBy: string | null;
  appointmentMethod: AppointmentMethod;
  electionId: string | null;
  removalReason: string | null;
  removedById: string | null;
  simTick: number | null;
  simDate: string | null;
}
