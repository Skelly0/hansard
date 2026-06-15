import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmbed } from '../../utils/embeds.js';

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  hasPermission: vi.fn(),
  wakeVoteAutoCloseWorker: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left, right) => ({ left, right })),
  ilike: vi.fn((left, right) => ({ left, right })),
  sql: vi.fn((parts: TemplateStringsArray, ...values: unknown[]) => ({ parts, values })),
}));

vi.mock('@hansard/db', () => ({
  bills: {
    id: 'bills.id',
    status: 'bills.status',
    playerVoteId: 'bills.playerVoteId',
    updatedAt: 'bills.updatedAt',
  },
  candidates: {
    id: 'candidates.id',
    electionId: 'candidates.electionId',
    isWithdrawn: 'candidates.isWithdrawn',
    registeredAt: 'candidates.registeredAt',
  },
  elections: {
    id: 'elections.id',
  },
  offices: {
    id: 'offices.id',
    name: 'offices.name',
    isActive: 'offices.isActive',
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
}));

vi.mock('../../services/voteAutoClose.js', () => ({
  wakeVoteAutoCloseWorker: mocks.wakeVoteAutoCloseWorker,
}));

import {
  default as voteCommand,
  buildLegislativeVotePublicEmbeds,
  buildReactionVoteInstructions,
  handleVoteCreateModal,
} from './create';

describe('/vote command schema', () => {
  it('offers autocomplete for the office on /vote elect', () => {
    const schema = voteCommand.data.toJSON();
    const elect = schema.options?.find((option: any) => option.name === 'elect') as any;
    const office = elect?.options?.find((option: any) => option.name === 'office');
    const nominationsHours = elect?.options?.find((option: any) => option.name === 'nominations-hours');
    const durationHours = elect?.options?.find((option: any) => option.name === 'duration-hours');
    const iface = elect?.options?.find((option: any) => option.name === 'interface');
    const skipNominations = elect?.options?.find((option: any) => option.name === 'skip-nominations');
    const candidate1 = elect?.options?.find((option: any) => option.name === 'candidate-1');

    expect(office?.autocomplete).toBe(true);
    expect(nominationsHours).toBeTruthy();
    expect(durationHours).toBeTruthy();
    expect(iface?.choices?.map((choice: any) => choice.value)).toEqual(['reactions', 'buttons']);
    expect(skipNominations).toBeTruthy();
    expect(candidate1).toBeTruthy();
  });

  it('does not advertise position elections through /vote create', () => {
    const schema = voteCommand.data.toJSON();
    const create = schema.options?.find((option: any) => option.name === 'create') as any;
    const type = create?.options?.find((option: any) => option.name === 'type');
    const values = type?.choices?.map((choice: any) => choice.value) ?? [];

    expect(values).not.toContain('position_election');
  });

  it('does not advertise position elections through /vote schedule', () => {
    const schema = voteCommand.data.toJSON();
    const schedule = schema.options?.find((option: any) => option.name === 'schedule') as any;
    const type = schedule?.options?.find((option: any) => option.name === 'type');
    const values = type?.choices?.map((choice: any) => choice.value) ?? [];

    expect(values).not.toContain('position_election');
  });
});

function selectLimit(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function makeModalInteraction(
  overrides: Record<string, unknown> = {},
  fieldOverrides: Record<string, string> = {},
) {
  const values: Record<string, string> = {
    title: 'Bridge Security Act',
    description: 'Establishes protections and patrol authority.',
    duration: '24',
    ...fieldOverrides,
  };

  return {
    customId: 'vote-create:referendum:yea_nay_abstain:simple:reactions',
    user: { id: 'discord-user-1' },
    fields: {
      getTextInputValue: vi.fn((key: string) => values[key] ?? ''),
    },
    deferReply: vi.fn(async () => {
      mocks.calls.push('deferReply');
    }),
    editReply: vi.fn(async () => {
      mocks.calls.push('editReply');
    }),
    reply: vi.fn(async () => {
      mocks.calls.push('reply');
    }),
    ...overrides,
  };
}

describe('handleVoteCreateModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls.length = 0;
    vi.useRealTimers();
    mocks.db.select.mockImplementation(() => {
      mocks.calls.push('db.select');
      return selectLimit([]);
    });
  });

  it('acknowledges the modal before player lookup work', async () => {
    const interaction = makeModalInteraction();

    await handleVoteCreateModal(interaction as any);

    expect(mocks.calls[0]).toBe('deferReply');
    expect(mocks.calls).toContain('db.select');
    expect(interaction.editReply).toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('defaults blank duration input to a 24 hour voting window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    let insertedElection: any;
    mocks.db.select.mockImplementationOnce(() => selectLimit([{ id: 'player-1' }]));
    mocks.db.insert.mockReturnValue({
      values: vi.fn((values) => {
        insertedElection = values;
        return {
          returning: vi.fn().mockResolvedValue([{ id: 'election-1' }]),
        };
      }),
    });

    const interaction = makeModalInteraction({
      customId: 'vote-create:referendum:yea_nay_abstain:simple:buttons',
    }, { duration: '' });

    await handleVoteCreateModal(interaction as any);

    expect(insertedElection.votingOpensAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(insertedElection.votingClosesAt.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('wakes the auto-close worker after creating an open vote', async () => {
    mocks.db.select.mockImplementationOnce(() => selectLimit([{ id: 'player-1' }]));
    mocks.db.insert.mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 'election-1' }]),
      })),
    });

    const interaction = makeModalInteraction({
      customId: 'vote-create:referendum:yea_nay_abstain:simple:buttons',
    });

    await handleVoteCreateModal(interaction as any);

    expect(mocks.wakeVoteAutoCloseWorker).toHaveBeenCalledWith('vote-created');
  });

  it('redirects stale position election create modals to /vote elect', async () => {
    const interaction = makeModalInteraction({
      customId: 'vote-create:position_election:fptp:simple:buttons',
    });

    await handleVoteCreateModal(interaction as any);

    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.db.insert).not.toHaveBeenCalled();
    const reply = interaction.editReply.mock.calls[0]?.[0];
    const error = reply?.embeds?.[0];
    expect(error?.data.description).toContain('/vote elect');
  });
});

describe('buildLegislativeVotePublicEmbeds', () => {
  const baseFields = [
    { name: 'Bill', value: 'B-007 - Bridge Security Act', inline: false },
  ];

  it('attaches a linked Google Doc to the vote creation embed', () => {
    const embeds = buildLegislativeVotePublicEmbeds({
      title: 'Vote on: Bridge Security Act',
      description: 'Establishes protections and patrol authority.',
      useReactions: true,
      reactionInstructions: 'React with yea/nay/abstain.',
      baseFields,
      billSource: {
        fields: [{ name: 'Bill Text', value: '[Google Doc](https://docs.google.com/document/d/example/edit)' }],
        embeds: [],
      },
    });

    expect(embeds).toHaveLength(1);
    expect(embeds[0].data.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Bill Text',
        value: '[Google Doc](https://docs.google.com/document/d/example/edit)',
      }),
    ]));
  });

  it('attaches full short bill text after the vote creation embed', () => {
    const billText = 'Section 1. Establishes bridge patrols.';
    const embeds = buildLegislativeVotePublicEmbeds({
      title: 'Vote on: Bridge Security Act',
      description: 'Establishes protections and patrol authority.',
      useReactions: false,
      reactionInstructions: 'ignored for button votes',
      baseFields,
      billSource: {
        fields: [{ name: 'Bill Text', value: 'Short bill text below.' }],
        embeds: [createEmbed({ title: 'B-007 - Bridge Security Act', description: billText, system: 'bills' })],
      },
    });

    expect(embeds).toHaveLength(2);
    expect(embeds[0].data.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Bill Text',
        value: 'Short bill text below.',
      }),
    ]));
    expect(embeds[1].data.description).toBe(billText);
  });
});

describe('buildReactionVoteInstructions', () => {
  it('tells yea/nay reaction voters that reactions remain visible', () => {
    const instructions = buildReactionVoteInstructions('yea_nay_abstain');

    expect(instructions).toContain('Reactions stay visible as the public voting record.');
    expect(instructions).not.toContain('Your reaction is removed once recorded');
  });
});
