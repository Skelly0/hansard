import { describe, expect, it } from 'vitest';

// db.ts throws at import-time without DATABASE_URL set. The actual command tests don't
// touch the DB; we just need a parsable connection string for the module to evaluate.
process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/hansard';

const { default: phone } = await import('./phone.js');

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
      'register', 'numbers', 'delete', 'dial', 'hangup', 'history',
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
});
