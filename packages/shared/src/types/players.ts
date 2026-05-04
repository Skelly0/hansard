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
  notes?: string;
}

// ============================================================
// Profile Data (JSONB on players table)
// ============================================================

export interface ProfileData {
  timezone?: string;
  pronouns?: string;
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
  healthStatus: HealthStatus;
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
}

export interface UpdatePartyInput {
  name?: string;
  shortName?: string | null;
  factionId?: string | null;
  leaderId?: string | null;
  ideology?: string | null;
  colour?: string | null;
  discordRoleId?: string | null;
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
