import { describe, expect, it } from 'vitest';

// db.ts throws at import-time without DATABASE_URL set. The actual command tests don't
// touch the DB; we just need a parsable connection string for the module to evaluate.
process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/hansard';

const { default: phone, validateTapMirrorChannel } = await import('./phone.js');

describe('/phone command metadata', () => {
  const json = phone.data.toJSON();

  it('is named "phone"', () => {
    expect(json.name).toBe('phone');
  });

  it('contains the player-facing subcommands', () => {
    const subNames = json.options
      ?.filter((o) => o.type === 1) // SUB_COMMAND
      .map((o) => o.name) ?? [];
    expect(subNames).toEqual(expect.arrayContaining([
      'register', 'numbers', 'directory', 'delete', 'dial', 'hangup', 'history',
    ]));
  });

  it('contains an admin subcommand group with tap-create/revoke/list, lookup, force-end', () => {
    const groups = json.options?.filter((o) => o.type === 2) ?? []; // SUB_COMMAND_GROUP
    expect(groups.map((g) => g.name)).toContain('admin');
    const adminGroup = groups.find((g) => g.name === 'admin');
    const adminSubs = (adminGroup as { options?: Array<{ name: string }> }).options?.map((o) => o.name) ?? [];
    expect(adminSubs).toEqual(expect.arrayContaining([
      'tap-create', 'tap-revoke', 'tap-list', 'lookup', 'force-end',
    ]));
  });

  it('is available in DMs (BotDM context) so /phone hangup works from a call DM', () => {
    expect(json.contexts).toContain(1); // InteractionContextType.BotDM
  });

  it('exposes an autocomplete function for the `from` / `delete number` paths', () => {
    expect(typeof phone.autocomplete).toBe('function');
  });

  it('leaves default_member_permissions null so /phone is visible to all players (admin gated at runtime)', () => {
    // null here is load-bearing: setting it would hide /phone register etc. from non-staff.
    expect(json.default_member_permissions).toBeNull();
  });

  it('restricts tap-create mirror-channel option to GuildText + PrivateThread (defense in depth)', () => {
    const adminGroup = json.options?.find((o) => o.type === 2 && o.name === 'admin');
    const tapCreate = (adminGroup as { options?: Array<{ name: string; options?: Array<{ name: string; channel_types?: number[] }> }> })
      .options?.find((o) => o.name === 'tap-create');
    const mirrorChannelOpt = tapCreate?.options?.find((o) => o.name === 'mirror-channel');
    // GuildText = 0, PrivateThread = 12 (per Discord enum).
    expect(mirrorChannelOpt?.channel_types).toEqual(expect.arrayContaining([0, 12]));
    expect(mirrorChannelOpt?.channel_types).not.toContain(2); // GuildVoice
    expect(mirrorChannelOpt?.channel_types).not.toContain(5); // GuildAnnouncement
    expect(mirrorChannelOpt?.channel_types).not.toContain(11); // PublicThread
  });

  it('history subcommand exposes a `page` integer option', () => {
    const history = json.options?.find((o) => o.type === 1 && o.name === 'history');
    const pageOpt = (history as { options?: Array<{ name: string; type: number; min_value?: number }> })
      .options?.find((o) => o.name === 'page');
    expect(pageOpt).toBeDefined();
    expect(pageOpt!.type).toBe(4); // INTEGER
    expect(pageOpt!.min_value).toBe(1);
  });
});

// =====================================================================================
// validateTapMirrorChannel security control — full enum and inheritance coverage.
// =====================================================================================

// Discord ChannelType numeric values (from discord-api-types). Keep these in sync with the
// `addChannelTypes` declaration in the slash command.
const ChannelTypeEnum = {
  GuildText: 0,
  DM: 1,
  GuildVoice: 2,
  GuildAnnouncement: 5,
  AnnouncementThread: 10,
  PublicThread: 11,
  PrivateThread: 12,
  GuildStageVoice: 13,
  GuildForum: 15,
} as const;

function makeGuildChannel(opts: {
  type: number;
  everyoneCanView: boolean;
  parent?: { everyoneCanView: boolean } | null;
}): any {
  const guild = { id: 'G1', roles: { everyone: { id: 'G1' } } };
  const buildPermissionsFor = (everyoneCanView: boolean) => () => ({
    has: (perm: string) => perm === 'ViewChannel' && everyoneCanView,
  });
  const channel = {
    id: 'C1',
    type: opts.type,
    guild,
    permissionsFor: buildPermissionsFor(opts.everyoneCanView),
    parent: opts.parent
      ? {
        id: 'C2',
        type: ChannelTypeEnum.GuildText,
        guild,
        permissionsFor: buildPermissionsFor(opts.parent.everyoneCanView),
      }
      : null,
  };
  return channel;
}

describe('validateTapMirrorChannel', () => {
  it('passes a private GuildText channel (@everyone denied View)', () => {
    const channel = makeGuildChannel({ type: ChannelTypeEnum.GuildText, everyoneCanView: false });
    expect(validateTapMirrorChannel(channel)).toBeNull();
  });

  it('refuses a public GuildText channel (@everyone can View)', () => {
    const channel = makeGuildChannel({ type: ChannelTypeEnum.GuildText, everyoneCanView: true });
    expect(validateTapMirrorChannel(channel)).toMatch(/must be private/i);
  });

  it('refuses an announcement channel even when @everyone is denied', () => {
    const channel = makeGuildChannel({ type: ChannelTypeEnum.GuildAnnouncement, everyoneCanView: false });
    expect(validateTapMirrorChannel(channel)).toMatch(/text channel or private thread/i);
  });

  it('refuses voice / stage / forum / category channel types', () => {
    for (const type of [ChannelTypeEnum.GuildVoice, ChannelTypeEnum.GuildStageVoice, ChannelTypeEnum.GuildForum]) {
      const channel = makeGuildChannel({ type, everyoneCanView: false });
      expect(validateTapMirrorChannel(channel)).toMatch(/text channel or private thread/i);
    }
  });

  it('refuses a public thread even when its parent is private', () => {
    const channel = makeGuildChannel({
      type: ChannelTypeEnum.PublicThread,
      everyoneCanView: false,
      parent: { everyoneCanView: false },
    });
    expect(validateTapMirrorChannel(channel)).toMatch(/text channel or private thread/i);
  });

  it('refuses an announcement thread', () => {
    const channel = makeGuildChannel({
      type: ChannelTypeEnum.AnnouncementThread,
      everyoneCanView: false,
      parent: { everyoneCanView: false },
    });
    expect(validateTapMirrorChannel(channel)).toMatch(/text channel or private thread/i);
  });

  it('passes a private thread whose parent is private', () => {
    const channel = makeGuildChannel({
      type: ChannelTypeEnum.PrivateThread,
      everyoneCanView: false,
      parent: { everyoneCanView: false },
    });
    expect(validateTapMirrorChannel(channel)).toBeNull();
  });

  it('REFUSES a private thread whose parent is public (the inheritance leak)', () => {
    // This is the security-critical case: threads have no @everyone overwrites of their own,
    // so the old check (raw permissionOverwrites.cache) returned null (safe) for any thread.
    // The new check walks to the parent and refuses.
    const channel = makeGuildChannel({
      type: ChannelTypeEnum.PrivateThread,
      everyoneCanView: false,
      parent: { everyoneCanView: true },
    });
    expect(validateTapMirrorChannel(channel)).toMatch(/must be private/i);
  });

  it('refuses a private thread with no resolvable parent', () => {
    const channel = makeGuildChannel({
      type: ChannelTypeEnum.PrivateThread,
      everyoneCanView: false,
      parent: null,
    });
    expect(validateTapMirrorChannel(channel)).toMatch(/no resolvable parent/i);
  });

  it('passes a GuildText channel with category-inherited @everyone deny (effective check, not raw overwrites)', () => {
    // Per the review: a staff channel whose @everyone is denied at the *category* level
    // (no channel-level overwrite) was falsely refused by the old `permissionOverwrites`-
    // based check. `permissionsFor(@everyone)` resolves the effective permission and lets it
    // through.
    const channel = makeGuildChannel({ type: ChannelTypeEnum.GuildText, everyoneCanView: false });
    expect(validateTapMirrorChannel(channel)).toBeNull();
  });
});
