import { pgTable, uuid, varchar, text, integer, boolean, timestamp, jsonb, type AnyPgColumn } from 'drizzle-orm/pg-core';

export const players = pgTable('players', {
  id: uuid('id').primaryKey().defaultRandom(),
  discordId: varchar('discord_id', { length: 20 }).notNull().unique(),
  discordUsername: varchar('discord_username', { length: 64 }).notNull(),

  // === CHARACTER CREATION ===
  // Players create a character via /character create -- fills in these fields.
  characterName: varchar('character_name', { length: 128 }),
  characterBio: text('character_bio'),                     // free-form biography/description
  characterPortraitUrl: varchar('character_portrait_url', { length: 512 }),
  // Player uploads an image to Discord or provides a URL. Stored for display in webapp/embeds.

  factionId: uuid('faction_id').references((): AnyPgColumn => factions.id),
  partyId: uuid('party_id').references((): AnyPgColumn => parties.id),

  // === AGING & LIFECYCLE ===
  birthDate: varchar('birth_date', { length: 32 }),     // in-sim date
  startingAge: integer('starting_age'),                   // the age they chose at character creation
  currentAge: integer('current_age'),                     // calculated on time advance
  deathDate: varchar('death_date', { length: 32 }),
  causeOfDeath: varchar('cause_of_death', { length: 256 }),
  isAlive: boolean('is_alive').default(true).notNull(),

  // Health / ailments
  healthStatus: varchar('health_status', { length: 32 }).default('healthy').notNull(),
  ailments: jsonb('ailments').$type<{
    condition: string;
    severity: 'minor' | 'major' | 'critical';
    acquiredAtTick: number;
    acquiredAtAge: number;
    notes?: string;
  }[]>().default([]),

  // === STARTING AGE FAVOUR BONUS ===
  // Older characters start with bonus favours but are closer to ailments/death.
  // The bonus is applied once at character creation and logged as a transaction.
  startingFavoursGranted: boolean('starting_favours_granted').default(false).notNull(),

  // Status
  isActive: boolean('is_active').default(true).notNull(),
  isStaff: boolean('is_staff').default(false).notNull(),
  staffRole: varchar('staff_role', { length: 64 }),

  // Metadata
  registeredAt: timestamp('registered_at').defaultNow().notNull(),
  lastActiveAt: timestamp('last_active_at'),
  profileData: jsonb('profile_data').$type<{
    timezone?: string;
    pronouns?: string;
    [key: string]: unknown;
  }>(),
});

// === PLAYER EVENT LOG ===
// Tracks party changes, faction changes, office appointments, ailments, deaths -- everything.
export const playerEventLog = pgTable('player_event_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').references(() => players.id).notNull(),

  eventType: varchar('event_type', { length: 64 }).notNull(),
  // 'party_change' | 'faction_change' | 'office_appointed' | 'office_left'
  // | 'ailment_acquired' | 'ailment_recovered' | 'health_changed' | 'death'
  // | 'registration' | 'name_change' | 'suspension' | 'unsuspension'

  description: varchar('description', { length: 512 }).notNull(),

  // Flexible before/after for any change
  oldValue: jsonb('old_value'),  // e.g. { partyId: "...", partyName: "Liberal Democrats" }
  newValue: jsonb('new_value'),  // e.g. { partyId: "...", partyName: "Conservative Party" }

  // Context
  simTick: integer('sim_tick'),
  simDate: varchar('sim_date', { length: 32 }),
  triggeredById: uuid('triggered_by_id').references(() => players.id),  // who/what caused it (self, staff, system)
  isAutomatic: boolean('is_automatic').default(false).notNull(),        // true if caused by time advance

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const factions = pgTable('factions', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 128 }).notNull(),
  shortName: varchar('short_name', { length: 16 }),
  description: text('description'),
  colour: varchar('colour', { length: 7 }),  // hex colour for embeds
  discordRoleId: varchar('discord_role_id', { length: 20 }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const parties = pgTable('parties', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 128 }).notNull(),
  shortName: varchar('short_name', { length: 16 }),
  factionId: uuid('faction_id').references(() => factions.id),
  leaderId: uuid('leader_id').references((): AnyPgColumn => players.id),
  ideology: varchar('ideology', { length: 256 }),
  colour: varchar('colour', { length: 7 }),
  discordRoleId: varchar('discord_role_id', { length: 20 }),  // mapped Discord role for auto-sync
  isActive: boolean('is_active').default(true).notNull(),
  foundedAt: timestamp('founded_at').defaultNow().notNull(),
  dissolvedAt: timestamp('dissolved_at'),
});

export const offices = pgTable('offices', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 128 }).notNull(),       // e.g. "Prime Minister", "Chancellor", "Minister of War"
  tier: varchar('tier', { length: 32 }).notNull(),          // e.g. 'head_of_state', 'head_of_government', 'cabinet', 'legislature', 'regional'
  factionId: uuid('faction_id').references(() => factions.id), // null = cross-faction
  maxHolders: integer('max_holders').default(1).notNull(),

  // === PERMISSIONS ===
  // What this office can do in the bot/system
  permissions: jsonb('permissions').$type<string[]>(),
  // Available permissions:
  //   'legislative_leader'  -- can create legislative votes, schedule bills, manage legislature
  //   'appoint_ministers'   -- can appoint/remove holders of offices with appointable=true (PM power)
  //   'call_elections'      -- can create position_election votes
  //   'executive_orders'    -- can issue executive orders (future)
  //   'veto'                -- can veto passed legislation (future)

  // === APPOINTMENT CONFIG ===
  // How this office is filled
  filledBy: varchar('filled_by', { length: 32 }).default('elected').notNull(),
  // 'elected'    -- filled via position_election vote
  // 'appointed'  -- filled by another office holder (e.g. PM appoints ministers)
  // 'succession' -- filled automatically on vacancy (future)
  // 'staff'      -- assigned directly by staff

  appointableBy: uuid('appointable_by').references((): AnyPgColumn => offices.id),
  // If filledBy='appointed', which office can appoint to this one.
  // e.g. Minister of War has appointableBy = PM's office ID

  requiresConfirmation: boolean('requires_confirmation').default(false).notNull(),
  // If true, appointments/elections need NPC house confirmation before taking effect

  // === DISCORD ROLE ===
  discordRoleId: varchar('discord_role_id', { length: 20 }),
  // When a player is appointed/elected to this office, they get this Discord role.
  // When they leave, the role is removed.

  isActive: boolean('is_active').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
});

export const officeHolders = pgTable('office_holders', {
  id: uuid('id').primaryKey().defaultRandom(),
  officeId: uuid('office_id').references(() => offices.id).notNull(),
  playerId: uuid('player_id').references(() => players.id).notNull(),
  startDate: timestamp('start_date').defaultNow().notNull(),
  endDate: timestamp('end_date'),

  // How they got here
  appointedBy: uuid('appointed_by').references(() => players.id),
  appointmentMethod: varchar('appointment_method', { length: 64 }).notNull(),
  // 'elected' | 'appointed' | 'succession' | 'staff_assigned'

  // Links to the election or confirmation vote if applicable
  electionId: uuid('election_id'), // references elections.id — linked at query time to avoid circular import

  // Why they left (if endDate is set)
  removalReason: varchar('removal_reason', { length: 256 }),
  // 'resigned' | 'removed_by_appointer' | 'voted_out' | 'term_expired' | 'died' | 'impeached' | 'staff_removed'
  removedById: uuid('removed_by_id').references(() => players.id),

  simTick: integer('sim_tick'),
  simDate: varchar('sim_date', { length: 32 }),
});
