import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execute as healthExecute } from './health.js';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  isStaff: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  db: { select: mocks.select },
}));

vi.mock('../../utils/permissions.js', () => ({
  isStaff: mocks.isStaff,
}));

const player = {
  id: 'player-1',
  discordId: 'user-1',
  characterName: 'Ada Vance',
  healthStatus: 'major',
  currentAge: 61,
  startingAge: 40,
  isAlive: true,
  ailments: [
    {
      condition: 'Stroke',
      severity: 'major',
      acquiredAtTick: 3,
      acquiredAtAge: 60,
      notes: 'Staff plan: escalate next season',
    },
  ],
};

function mockQueries() {
  mocks.select
    .mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([player]) }) }),
    })
    .mockReturnValueOnce({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }) }),
    });
}

async function runAs({ staff }: { staff: boolean }) {
  mocks.isStaff.mockResolvedValue(staff);
  mockQueries();
  const editReply = vi.fn();
  await healthExecute({
    deferReply: vi.fn(),
    editReply,
    user: { id: staff ? 'staff-1' : 'user-1' },
    member: { id: 'member' },
    options: { getUser: () => ({ id: 'user-1', displayName: 'Ada' }) },
  } as any);
  return JSON.stringify(editReply.mock.calls[0][0].embeds[0].toJSON());
}

describe('/player health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the player their ailments without staff notes', async () => {
    const embed = await runAs({ staff: false });
    expect(embed).toContain('Stroke');
    expect(embed).not.toContain('Staff plan');
  });

  it('shows staff the ailment notes', async () => {
    const embed = await runAs({ staff: true });
    expect(embed).toContain('Staff plan: escalate next season');
  });
});
