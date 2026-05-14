import { describe, expect, it, vi } from 'vitest';
import { Collection, Events, SlashCommandBuilder } from 'discord.js';

process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/hansard';

vi.mock('../services/voteAutoClose.js', () => ({
  startVoteAutoCloseWorker: vi.fn(() => ({ unref: vi.fn() })),
}));

vi.mock('../services/phoneRingTimeout.js', () => ({
  startPhoneRingTimeoutWorker: vi.fn(() => ({ unref: vi.fn() })),
}));

const { registerReadyEvent, stopBackgroundWorkers } = await import('./ready.js');
const { commands } = await import('../client.js');
const { startPhoneRingTimeoutWorker } = await import('../services/phoneRingTimeout.js');

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
  it('registers only /phone globally while sweeping every guild command set', async () => {
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
    expect(guildSet).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ name: 'phone' }),
      expect.objectContaining({ name: 'time' }),
    ]));
  });
});

describe('ready background workers', () => {
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
});
