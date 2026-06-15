import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
  hasPermission: vi.fn(),
  isStaff: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

vi.mock('@hansard/db', () => ({
  elections: {
    id: 'elections.id',
  },
  players: {
    id: 'players.id',
    discordId: 'players.discordId',
  },
}));

vi.mock('../../db.js', () => ({
  db: mocks.db,
}));

vi.mock('../../utils/permissions.js', () => ({
  hasPermission: mocks.hasPermission,
  isStaff: mocks.isStaff,
}));

import { execute } from './schedule';
import voteCommand from './create';

function makeInteraction(type = 'referendum') {
  return {
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    member: { roles: { cache: new Map() } },
    user: { id: 'discord-user-1' },
    channel: null,
    options: {
      getString: vi.fn((name: string, required?: boolean) => {
        switch (name) {
          case 'title':
            return 'Bridge Security Act';
          case 'type':
            return type;
          case 'method':
            return 'yea_nay_abstain';
          case 'description':
            return null;
          case 'majority':
            return 'simple';
          default:
            if (required) {
              throw new Error(`Unexpected required string option: ${name}`);
            }
            return null;
        }
      }),
      getNumber: vi.fn((name: string, required?: boolean) => {
        switch (name) {
          case 'opens-in-hours':
            return 24;
          case 'duration-hours':
            return 24;
          default:
            if (required) {
              throw new Error(`Unexpected required number option: ${name}`);
            }
            return null;
        }
      }),
    },
  };
}

describe('/vote schedule legislative vote guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.isStaff.mockResolvedValue(true);
  });

  it('does not advertise legislative votes in the slash command choices', () => {
    const json = voteCommand.data.toJSON();
    const scheduleSub = json.options?.find((option) => option.name === 'schedule') as {
      options?: { name: string; choices?: { value: string }[] }[];
    } | undefined;
    const typeOption = scheduleSub?.options?.find((option) => option.name === 'type');
    const choiceValues = typeOption?.choices?.map((choice) => choice.value) ?? [];

    expect(choiceValues).not.toContain('legislative_vote');
  });

  it('does not advertise position elections in the slash command choices', () => {
    const json = voteCommand.data.toJSON();
    const scheduleSub = json.options?.find((option) => option.name === 'schedule') as {
      options?: { name: string; choices?: { value: string }[] }[];
    } | undefined;
    const typeOption = scheduleSub?.options?.find((option) => option.name === 'type');
    const choiceValues = typeOption?.choices?.map((choice) => choice.value) ?? [];

    expect(choiceValues).not.toContain('position_election');
  });

  it('rejects stale legislative vote payloads and points staff to /vote create', async () => {
    const interaction = makeInteraction('legislative_vote');

    await execute(interaction as any);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.db.insert).not.toHaveBeenCalled();
    const reply = interaction.editReply.mock.calls[0]?.[0];
    const error = reply?.embeds?.[0];
    expect(error?.data.description).toContain('cannot be scheduled with `/vote schedule`');
    expect(error?.data.description).toContain('/vote create type:legislative_vote');
  });

  it('rejects stale position election payloads and points staff to /vote elect', async () => {
    const interaction = makeInteraction('position_election');

    await execute(interaction as any);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.db.insert).not.toHaveBeenCalled();
    const reply = interaction.editReply.mock.calls[0]?.[0];
    const error = reply?.embeds?.[0];
    expect(error?.data.description).toContain('Position elections cannot be scheduled with `/vote schedule`');
    expect(error?.data.description).toContain('/vote elect');
  });
});
