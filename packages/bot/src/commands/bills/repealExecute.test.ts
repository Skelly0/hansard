import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BillStatus } from '@hansard/shared';
import { execute } from './repeal.js';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  hasPermission: vi.fn(),
  repealBill: vi.fn(),
  editLegislationEmbed: vi.fn(),
  postLegislationEmbed: vi.fn(),
}));

vi.mock('../../db.js', () => ({ db: mocks.db }));

vi.mock('../../utils/permissions.js', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('./repealFlow.js', () => ({
  repealBill: mocks.repealBill,
}));

vi.mock('../../utils/legislationChannel.js', () => ({
  editLegislationEmbed: mocks.editLegislationEmbed,
  postLegislationEmbed: mocks.postLegislationEmbed,
}));

const baseBill = {
  id: 'bill-1',
  title: 'A Repealable Bill',
  shortTitle: null,
  slug: 'a-repealable-bill',
  billNumber: 12,
  billType: 'google_doc',
  googleDocUrl: 'https://docs.google.com/document/d/abc/edit',
  googleDocId: 'abc',
  cachedContent: null,
  cachedAt: null,
  summary: 'A short summary.',
  authorId: 'author-1',
  submittedById: 'author-1',
  coSponsorIds: [],
  status: BillStatus.ENACTED,
  submittedAt: new Date('2026-01-01T00:00:00Z'),
  playerVoteId: null,
  playerVoteResult: null,
  playerVoteAt: null,
  npcVoteRequired: false,
  npcVote: null,
  enactedAt: new Date('2026-02-01T00:00:00Z'),
  effectiveAt: new Date('2026-02-01T00:00:00Z'),
  repealedAt: null,
  repealedByBillId: null,
  legislationChannelId: 'chan-1',
  legislationMessageId: 'msg-1',
  collectionId: null,
  parentDocumentId: null,
  amendsBillId: null,
  amendsDocumentId: null,
  tags: [],
  policyAreas: [],
  crossReferences: [],
  estimatedEffects: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-02-01T00:00:00Z'),
};

function selectLimit(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function makeInteraction() {
  return {
    guild: {
      members: {
        cache: {
          get: vi.fn().mockReturnValue({ id: 'member-1' }),
        },
      },
    },
    options: {
      getString: vi.fn().mockReturnValue('B-012'),
    },
    user: {
      id: 'staff-discord-id',
    },
    client: {},
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/bill repeal channel outcome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.repealBill.mockResolvedValue(undefined);
    mocks.postLegislationEmbed.mockResolvedValue({
      status: 'sent',
      channelId: 'chan-1',
      messageId: 'fresh-msg',
    });
    mocks.db.select
      .mockImplementationOnce(() => selectLimit([baseBill]))
      .mockImplementationOnce(() => selectLimit([{ id: 'actor-player-id' }]))
      .mockImplementationOnce(() => selectLimit([{
        characterName: 'Jane Doe',
        discordId: 'author-discord-id',
      }]));
  });

  it('reports an edit failure separately from missing stored enactment IDs', async () => {
    mocks.editLegislationEmbed.mockResolvedValue({
      status: 'message_missing',
      channelId: baseBill.legislationChannelId,
      messageId: baseBill.legislationMessageId,
    });
    const interaction = makeInteraction();

    await execute(interaction as any);

    expect(mocks.postLegislationEmbed).toHaveBeenCalledTimes(1);
    const payload = interaction.editReply.mock.calls.at(-1)?.[0];
    const description = payload.embeds[0].data.description ?? '';
    expect(description).toContain('Could not edit the stored enactment post');
    expect(description).toContain('posted a fresh repeal notice');
    expect(description).not.toContain('No stored enactment post');
  });
});
