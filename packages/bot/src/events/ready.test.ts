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

function makeCommand(name: string) {
  return {
    data: new SlashCommandBuilder().setName(name).setDescription(`${name} command`),
    execute: vi.fn(),
  };
}

describe('ready command registration', () => {
  it('registers only /phone globally while sweeping every guild command set', async () => {
    stopBackgroundWorkers();
    commands.clear();
    commands.set('phone', makeCommand('phone'));
    commands.set('time', makeCommand('time'));

    let readyHandler: ((client: unknown) => Promise<void>) | null = null;
    const client = {
      once: vi.fn((event, handler) => {
        expect(event).toBe(Events.ClientReady);
        readyHandler = handler;
      }),
    };
    const globalSet = vi.fn().mockResolvedValue(undefined);
    const guildSet = vi.fn().mockResolvedValue(undefined);
    const readyClient = {
      application: { commands: { set: globalSet } },
      guilds: {
        cache: new Collection([
          ['guild-1', { name: 'Guild One', commands: { set: guildSet } }],
        ]),
      },
      channels: { fetch: vi.fn() },
    };

    registerReadyEvent(client as never);
    await readyHandler!(readyClient);

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
