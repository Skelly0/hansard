import { beforeEach, describe, expect, it, vi } from 'vitest';
import command from './character.js';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  db: {
    select: mocks.select,
  },
}));

function selectLimitResult(rows: unknown[], onLimit?: () => void) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockImplementation(async () => {
          onLimit?.();
          return rows;
        }),
      }),
    }),
  };
}

describe('/character create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acknowledges the submitted modal before checking character name uniqueness', async () => {
    const events: string[] = [];
    let selectCall = 0;

    mocks.select.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) return selectLimitResult([]);
      if (selectCall === 2) {
        return selectLimitResult([{ id: 'existing-player' }], () => {
          events.push('name uniqueness check');
        });
      }
      throw new Error(`Unexpected select call ${selectCall}`);
    });

    const modalSubmit = {
      fields: {
        getTextInputValue: vi.fn((field: string) => ({
          character_name: 'Ada Vance',
          character_bio: 'A parliamentary comet.',
          character_age: '30',
        })[field] ?? ''),
      },
      deferReply: vi.fn(async () => {
        events.push('defer reply');
      }),
      editReply: vi.fn(),
      reply: vi.fn(),
    };

    const interaction = {
      user: { id: 'discord-user-1', username: 'ada' },
      options: { getSubcommand: vi.fn().mockReturnValue('create') },
      reply: vi.fn(),
      showModal: vi.fn(),
      awaitModalSubmit: vi.fn().mockResolvedValue(modalSubmit),
    };

    await command.execute(interaction as any);

    expect(events).toEqual(['defer reply', 'name uniqueness check']);
    expect(modalSubmit.reply).not.toHaveBeenCalled();
    expect(modalSubmit.editReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
    });
  });
});
