import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execute as officeInfoExecute } from './info.js';

const mocks = vi.hoisted(() => ({
  isStaff: vi.fn(),
  rows: [] as unknown[][],
}));

vi.mock('../../utils/permissions.js', () => ({
  isStaff: mocks.isStaff,
}));

class Query<T = unknown> implements PromiseLike<T[]> {
  constructor(private readonly rows: T[]) {}

  from() {
    return this;
  }

  innerJoin() {
    return this;
  }

  where() {
    return this;
  }

  orderBy() {
    return this;
  }

  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
}

vi.mock('../../db.js', () => ({
  db: {
    select: vi.fn(() => new Query(mocks.rows.shift() ?? [])),
  },
}));

function fakeInteraction() {
  return {
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    guild: {
      members: {
        fetch: vi.fn().mockResolvedValue({ id: 'member-1' }),
      },
    },
    user: { id: 'user-1' },
    member: { id: 'member-1' },
    options: {
      getString: vi.fn(() => 'Chancellor'),
    },
  } as any;
}

const officeRow = {
  id: 'office-1',
  name: 'Chancellor',
  tier: 'legislature',
  maxHolders: 1,
  filledBy: 'elected',
  permissions: ['legislative_leader', 'call_elections'],
  requiresConfirmation: false,
};

function embedFieldText(interaction: ReturnType<typeof fakeInteraction>) {
  const reply = interaction.editReply.mock.calls[0]?.[0];
  const embed = reply.embeds[0];
  return (embed.data.fields ?? [])
    .map((field: any) => `${field.name}\n${field.value}`)
    .join('\n');
}

describe('/office info', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isStaff.mockResolvedValue(false);
    mocks.rows = [
      [officeRow],
      [],
      [],
    ];
  });

  it('hides permission strings from non-staff users', async () => {
    const interaction = fakeInteraction();

    await officeInfoExecute(interaction);

    const text = embedFieldText(interaction);
    expect(text).not.toContain('Permissions');
    expect(text).not.toContain('legislative_leader');
  });

  it('shows permission strings to staff users', async () => {
    mocks.isStaff.mockResolvedValue(true);
    const interaction = fakeInteraction();

    await officeInfoExecute(interaction);

    const text = embedFieldText(interaction);
    expect(text).toContain('Permissions');
    expect(text).toContain('legislative_leader');
  });
});
