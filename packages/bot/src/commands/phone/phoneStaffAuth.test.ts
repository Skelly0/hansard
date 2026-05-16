import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/hansard';

const dbState = vi.hoisted(() => ({
  rows: [] as Array<{ isStaff: boolean }>,
}));

vi.mock('../../db.js', () => ({
  db: {
    select: () => {
      const rows = dbState.rows;
      const resolved = Promise.resolve(rows);
      const handler: ProxyHandler<object> = {
        get(_target, prop) {
          if (prop === 'then') {
            return (ok: (v: unknown) => unknown, err?: (r: unknown) => unknown) => resolved.then(ok, err);
          }
          return () => new Proxy({}, handler);
        },
      };
      return new Proxy({}, handler);
    },
  },
}));

vi.mock('../../utils/permissions.js', () => ({
  isStaff: vi.fn().mockResolvedValue(false),
}));

vi.mock('@hansard/api/services/phoneService', () => ({
  PhoneService: vi.fn(),
  PhoneServiceError: class PhoneServiceError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

const { __testables } = await import('./phone.js');

function roleCache(roles: Array<{ id: string; name: string }>) {
  return {
    find: (predicate: (role: { id: string; name: string }) => boolean) => roles.find(predicate),
    values: function* () {
      yield* roles;
    },
    some: (predicate: (role: { id: string; name: string }) => boolean) => roles.some(predicate),
  };
}

function makeInteraction(memberRoleIds: string[]) {
  const editReply = vi.fn();
  const guild = {
    id: 'G1',
    roles: {
      cache: roleCache([{ id: 'staff-role', name: 'Staff' }]),
      fetch: vi.fn().mockResolvedValue(roleCache([{ id: 'staff-role', name: 'Staff' }])),
    },
    members: {
      fetch: vi.fn().mockResolvedValue({
        roles: {
          cache: roleCache(memberRoleIds.map((id) => ({ id, name: id === 'staff-role' ? 'Staff' : 'Other' }))),
        },
      }),
    },
  };
  return {
    member: null,
    user: { id: 'discord-1' },
    client: {
      guilds: {
        cache: {
          get: (id: string) => (id === 'G1' ? guild : undefined),
          values: function* () {
            yield guild;
          },
        },
      },
    },
    editReply,
  };
}

describe('/phone admin staff authorization', () => {
  beforeEach(() => {
    delete process.env.PHONE_GUILD_ID;
    delete process.env.STAFF_ROLE_ID;
    delete process.env.STAFF_ROLE_IDS;
    dbState.rows = [];
    vi.clearAllMocks();
  });

  it('does not trust a stale DB staff flag in DM context without a live staff role', async () => {
    dbState.rows = [{ isStaff: true }];
    const interaction = makeInteraction([]);

    await expect(__testables.ensureStaff(interaction as never)).resolves.toBe(false);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it('allows DM admin commands only when the DB staff flag and live guild role both match', async () => {
    dbState.rows = [{ isStaff: true }];
    const interaction = makeInteraction(['staff-role']);

    await expect(__testables.ensureStaff(interaction as never)).resolves.toBe(true);
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});
