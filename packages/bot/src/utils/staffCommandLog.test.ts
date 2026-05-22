import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installStaffActionReplyLogging,
  postGenericStaffCommandActionLog,
} from './staffCommandLog.js';

const mocks = vi.hoisted(() => ({
  hasStaffActionLogBeenPosted: vi.fn(),
  isStaff: vi.fn(),
  postStaffActionLog: vi.fn(),
}));

vi.mock('./permissions.js', () => ({
  isStaff: mocks.isStaff,
}));

vi.mock('./modLog.js', () => ({
  hasStaffActionLogBeenPosted: mocks.hasStaffActionLogBeenPosted,
  postStaffActionLog: mocks.postStaffActionLog,
}));

function makeInteraction(commandName = 'bill', subcommand = 'npc-vote') {
  return {
    commandName,
    member: { roles: [] },
    options: {
      getSubcommandGroup: vi.fn().mockReturnValue(null),
      getSubcommand: vi.fn().mockReturnValue(subcommand),
    },
  };
}

describe('postGenericStaffCommandActionLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasStaffActionLogBeenPosted.mockReturnValue(false);
    mocks.isStaff.mockResolvedValue(true);
  });

  it('posts a fallback mod log for successful mutating staff command families', async () => {
    const interaction = makeInteraction();

    await postGenericStaffCommandActionLog(interaction as any);

    expect(mocks.postStaffActionLog).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        title: 'Staff Command Used',
        system: 'bills',
        fields: [{ name: 'Command', value: '/bill npc-vote', inline: true }],
      }),
    );
  });

  it('skips commands that already posted a detailed staff action log', async () => {
    mocks.hasStaffActionLogBeenPosted.mockReturnValue(true);

    await postGenericStaffCommandActionLog(makeInteraction('favour', 'grant') as any);

    expect(mocks.postStaffActionLog).not.toHaveBeenCalled();
  });

  it('logs before a success editReply so reply failures do not hide committed actions', async () => {
    const editReply = vi.fn().mockRejectedValue(new Error('Discord reply failed'));
    const interaction = {
      ...makeInteraction(),
      editReply,
    };

    installStaffActionReplyLogging(interaction as any);

    await expect(interaction.editReply({
      embeds: [{
        toJSON: () => ({ title: 'NPC House Vote: PASSED' }),
      }],
    } as any)).rejects.toThrow('Discord reply failed');

    expect(mocks.postStaffActionLog).toHaveBeenCalledTimes(1);
    expect(editReply).toHaveBeenCalledTimes(1);
    expect(mocks.postStaffActionLog.mock.invocationCallOrder[0])
      .toBeLessThan(editReply.mock.invocationCallOrder[0]);
  });

  it('does not log error replies for fallback-listed staff commands', async () => {
    const interaction = {
      ...makeInteraction(),
      editReply: vi.fn().mockResolvedValue(undefined),
    };

    installStaffActionReplyLogging(interaction as any);
    await interaction.editReply({
      embeds: [{
        toJSON: () => ({ title: '❌ Error' }),
      }],
    } as any);

    expect(mocks.postStaffActionLog).not.toHaveBeenCalled();
  });
});
