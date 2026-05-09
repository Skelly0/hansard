import { beforeEach, describe, expect, it, vi } from 'vitest';
import command from './roster.js';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  db: {
    select: mocks.select,
  },
}));

function containsText(value: unknown, pattern: RegExp, seen = new Set<object>()): boolean {
  if (typeof value === 'string') return pattern.test(value);
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);

  for (const key of Reflect.ownKeys(value)) {
    const child = (value as Record<PropertyKey, unknown>)[key];
    if (containsText(child, pattern, seen)) return true;
  }

  return false;
}

function makeRosterSelect(rows: { characterName: string | null }[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation((whereClause) => ({
        orderBy: vi.fn().mockResolvedValue(
          containsText(whereClause, /is not null/i)
            ? rows.filter((row) => row.characterName !== null)
            : rows,
        ),
      })),
    }),
  };
}

function makeOfficeSelect() {
  return {
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  };
}

describe('/roster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not list OAuth-only player rows as unnamed independent characters', async () => {
    const rows = [
      { id: 'created-character', characterName: 'Aldrick Vance', discordId: '111', partyId: null },
      { id: 'oauth-placeholder', characterName: null, discordId: '222', partyId: null },
    ];
    let selectCall = 0;
    mocks.select.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) return makeRosterSelect(rows);
      if (selectCall === 2) return makeOfficeSelect();
      throw new Error(`Unexpected select call ${selectCall}`);
    });

    const editReply = vi.fn();
    await command.execute({
      deferReply: vi.fn(),
      editReply,
      options: { getString: vi.fn().mockReturnValue(undefined) },
    } as any);

    const embed = editReply.mock.calls.at(-1)?.[0].embeds[0];
    expect(embed.data.title).toContain('Roster (1)');
    expect(embed.data.description).toContain('Aldrick Vance');
    expect(embed.data.description).not.toContain('(unnamed)');
  });
});
