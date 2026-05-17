import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection, Events, SlashCommandBuilder } from 'discord.js';

process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/hansard';

const mocks = vi.hoisted(() => ({
  tallyVotes: vi.fn(),
  VoteService: vi.fn(),
  autoEnactPassedBillFromElection: vi.fn(),
}));

vi.mock('../services/voteAutoClose.js', () => ({
  startVoteAutoCloseWorker: vi.fn(() => ({ unref: vi.fn() })),
}));

vi.mock('../services/phoneRingTimeout.js', () => ({
  startPhoneRingTimeoutWorker: vi.fn(() => ({ unref: vi.fn() })),
}));

vi.mock('@hansard/api/services/voteService', () => ({
  VoteService: mocks.VoteService,
}));

vi.mock('../commands/bills/autoEnact.js', () => ({
  autoEnactPassedBillFromElection: mocks.autoEnactPassedBillFromElection,
}));

const { registerReadyEvent, stopBackgroundWorkers } = await import('./ready.js');
const { commands } = await import('../client.js');
const { startPhoneRingTimeoutWorker } = await import('../services/phoneRingTimeout.js');
const { startVoteAutoCloseWorker } = await import('../services/voteAutoClose.js');

function makeCommand(name: string) {
  return {
    data: new SlashCommandBuilder().setName(name).setDescription(`${name} command`),
    execute: vi.fn(),
  };
}

type ReadyClientOverrides = {
  shard?: { ids: number[] };
};

function buildReadyClient(overrides: ReadyClientOverrides = {}) {
  const globalSet = vi.fn().mockResolvedValue(undefined);
  const guildSet = vi.fn().mockResolvedValue(undefined);
  const readyClient: Record<string, unknown> = {
    application: { commands: { set: globalSet } },
    guilds: {
      cache: new Collection([
        ['guild-1', { name: 'Guild One', commands: { set: guildSet } }],
      ]),
    },
    channels: { fetch: vi.fn() },
  };
  if (overrides.shard) readyClient.shard = overrides.shard;
  return { readyClient, globalSet, guildSet };
}

async function runReady(readyClient: Record<string, unknown>) {
  let readyHandler: ((client: unknown) => Promise<void>) | null = null;
  const client = {
    once: vi.fn((event, handler) => {
      expect(event).toBe(Events.ClientReady);
      readyHandler = handler;
    }),
  };
  registerReadyEvent(client as never);
  await readyHandler!(readyClient);
}

describe('ready command registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tallyVotes.mockResolvedValue({});
    mocks.autoEnactPassedBillFromElection.mockResolvedValue({ status: 'enacted' });
    mocks.VoteService.mockImplementation(class {
      tallyVotes = mocks.tallyVotes;
    } as any);
  });

  it('registers /phone globally and excludes it from the guild command sweep', async () => {
    stopBackgroundWorkers();
    vi.mocked(startPhoneRingTimeoutWorker).mockClear();
    commands.clear();
    commands.set('phone', makeCommand('phone'));
    commands.set('time', makeCommand('time'));

    const { readyClient, globalSet, guildSet } = buildReadyClient();
    await runReady(readyClient);

    expect(globalSet).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'phone' }),
    ]);
    expect(globalSet.mock.calls[0][0]).toHaveLength(1);

    // /phone must NOT be in the guild set — it is registered globally above, and including
    // it here too would make it appear twice in every guild's command picker.
    expect(guildSet).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'time' }),
    ]);
    const guildNames = (guildSet.mock.calls[0][0] as Array<{ name: string }>).map((c) => c.name);
    expect(guildNames).toContain('time');
    expect(guildNames).not.toContain('phone');
  });
});

describe('ready background workers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tallyVotes.mockResolvedValue({});
    mocks.autoEnactPassedBillFromElection.mockResolvedValue({ status: 'enacted' });
    mocks.VoteService.mockImplementation(class {
      tallyVotes = mocks.tallyVotes;
    } as any);
  });

  it('starts the phone ring-timeout worker on an unsharded client', async () => {
    stopBackgroundWorkers();
    vi.mocked(startPhoneRingTimeoutWorker).mockClear();
    commands.clear();
    commands.set('phone', makeCommand('phone'));

    const { readyClient } = buildReadyClient();
    await runReady(readyClient);

    expect(startPhoneRingTimeoutWorker).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ client: readyClient }),
    );
  });

  it('starts the phone ring-timeout worker on shard 0', async () => {
    stopBackgroundWorkers();
    vi.mocked(startPhoneRingTimeoutWorker).mockClear();
    commands.clear();
    commands.set('phone', makeCommand('phone'));

    const { readyClient } = buildReadyClient({ shard: { ids: [0] } });
    await runReady(readyClient);

    expect(startPhoneRingTimeoutWorker).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ client: readyClient }),
    );
  });

  it('skips the phone ring-timeout worker on a non-leader shard', async () => {
    stopBackgroundWorkers();
    vi.mocked(startPhoneRingTimeoutWorker).mockClear();
    commands.clear();
    commands.set('phone', makeCommand('phone'));

    const { readyClient } = buildReadyClient({ shard: { ids: [1, 2] } });
    await runReady(readyClient);

    expect(startPhoneRingTimeoutWorker).not.toHaveBeenCalled();
  });

  it('wires the vote auto-close callback to tally then auto-enact with the ready client', async () => {
    stopBackgroundWorkers();
    commands.clear();
    commands.set('phone', makeCommand('phone'));

    const { readyClient } = buildReadyClient();
    await runReady(readyClient);

    const options = vi.mocked(startVoteAutoCloseWorker).mock.calls[0]?.[1] as any;
    const election = { id: 'election-1', type: 'legislative_vote', relatedBillId: 'bill-1' };
    await options.tallyElection(election);

    expect(mocks.tallyVotes).toHaveBeenCalledWith('election-1');
    expect(mocks.autoEnactPassedBillFromElection).toHaveBeenCalledWith({
      database: expect.anything(),
      client: readyClient,
      election,
    });
  });
});
