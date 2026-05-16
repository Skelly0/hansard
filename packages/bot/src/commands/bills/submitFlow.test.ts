import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * End-to-end tests for the `/bill submit` flow that exercise:
 *
 * - BOT-8: button + modal customIds must be registered with the
 *   awaitingInteractions registry so the global handler does not race the
 *   in-flight awaiter and trigger DiscordAPIError[10062].
 * - BOT-6: modal `deferReply` must be ephemeral so validation/error/success
 *   replies stay private to the invoker.
 * - BOT-7: bill insert + status-log insert must run inside a single
 *   `db.transaction`, so a status-log failure rolls back the bill row.
 */

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
  registerAwaitingInteraction: vi.fn(),
  unregisterAwaitingInteraction: vi.fn(),
}));

vi.mock('../../db.js', () => ({ db: mocks.db }));

vi.mock('../../utils/awaitingInteractions.js', () => ({
  registerAwaitingInteraction: mocks.registerAwaitingInteraction,
  unregisterAwaitingInteraction: mocks.unregisterAwaitingInteraction,
  isAwaitingInteraction: vi.fn().mockReturnValue(false),
}));

const submittingUserId = 'discord-user-123';
const playerRecord = { id: 'player-uuid-1' };

function selectPlayerByDiscordId(rows: unknown[]) {
  // First select chain: findSubmittingPlayer
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function selectSlugCheck(rows: unknown[]) {
  // Second select chain: uniqueBillSlug (no existing slug)
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function makeBillInsertReturning(rows: unknown[]) {
  return {
    values: vi.fn(() => ({
      returning: vi.fn().mockResolvedValue(rows),
    })),
  };
}

function makeBillStatusLogInsert() {
  return {
    values: vi.fn().mockResolvedValue(undefined),
  };
}

interface ModalSubmitStub {
  fields: { getTextInputValue: ReturnType<typeof vi.fn> };
  user: { id: string };
  customId: string;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
}

interface TypeButtonStub {
  customId: string;
  user: { id: string };
  showModal: ReturnType<typeof vi.fn>;
  awaitModalSubmit: ReturnType<typeof vi.fn>;
}

function makeModalSubmit(customId: string, overrides: {
  googleDocUrl?: string;
  billText?: string;
  summary?: string;
  tags?: string;
  policyAreas?: string;
} = {}): ModalSubmitStub {
  const fields = {
    googleDocUrl: overrides.googleDocUrl ?? 'https://docs.google.com/document/d/abc123/edit',
    billText: overrides.billText ?? '',
    summary: overrides.summary ?? 'A brief summary',
    tags: overrides.tags ?? 'reform, transit',
    policyAreas: overrides.policyAreas ?? 'transport',
  };
  return {
    customId,
    user: { id: submittingUserId },
    fields: {
      getTextInputValue: vi.fn((field: string) => {
        if (field === 'google_doc_url') return fields.googleDocUrl;
        if (field === 'bill_text') return fields.billText;
        if (field === 'summary') return fields.summary;
        if (field === 'tags') return fields.tags;
        if (field === 'policy_areas') return fields.policyAreas;
        return '';
      }),
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

function makeInteraction(modalSubmit: ModalSubmitStub) {
  const submissionType = modalSubmit.customId.endsWith(':short') ? 'short' : 'google_doc';
  const typeButton: TypeButtonStub = {
    customId: `bill_submit_type:${submittingUserId}:${submissionType}`,
    user: { id: submittingUserId },
    showModal: vi.fn().mockResolvedValue(undefined),
    awaitModalSubmit: vi.fn().mockResolvedValue(modalSubmit),
  };

  const chooserReply = {
    awaitMessageComponent: vi.fn().mockResolvedValue(typeButton),
  };

  return {
    options: {
      getSubcommand: vi.fn().mockReturnValue('submit'),
      getSubcommandGroup: vi.fn().mockReturnValue(null),
      getString: vi.fn((name: string) => {
        if (name === 'title') return 'Transit Reform Act';
        return null;
      }),
    },
    user: { id: submittingUserId },
    reply: vi.fn().mockResolvedValue(chooserReply),
    editReply: vi.fn().mockResolvedValue(undefined),
    typeButton,
    modalSubmit,
  };
}

async function loadCommand() {
  const mod = await import('./submit.js');
  return mod.default;
}

describe('/bill submit interaction flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.select.mockReset();
    mocks.db.insert.mockReset();
    mocks.db.transaction.mockReset();
  });

  it('registers the button + modal customIds with awaitingInteractions before awaiting them', async () => {
    const modalCustomId = `bill_submit_modal:${submittingUserId}:google_doc`;
    const modalSubmit = makeModalSubmit(modalCustomId);
    const interaction = makeInteraction(modalSubmit);

    // Player + slug lookup, then bill insert returning a row, then status-log insert.
    mocks.db.select
      .mockReturnValueOnce(selectPlayerByDiscordId([playerRecord]))
      .mockReturnValueOnce(selectSlugCheck([]));
    mocks.db.insert
      .mockReturnValueOnce(makeBillInsertReturning([{ id: 'bill-uuid', billNumber: 7 }]))
      .mockReturnValueOnce(makeBillStatusLogInsert());
    // submit.ts doesn't currently use db.transaction. After the fix it will,
    // so support either shape.
    mocks.db.transaction.mockImplementation(async (cb: any) => {
      const tx = {
        insert: vi.fn()
          .mockReturnValueOnce(makeBillInsertReturning([{ id: 'bill-uuid', billNumber: 7 }]))
          .mockReturnValueOnce(makeBillStatusLogInsert()),
      };
      return cb(tx);
    });

    const command = await loadCommand();
    await command.execute(interaction as any);

    const buttonCustomIdPrefix = `bill_submit_type:${submittingUserId}:`;
    const registeredIds = mocks.registerAwaitingInteraction.mock.calls.map((c) => c[0] as string);
    const unregisteredIds = mocks.unregisterAwaitingInteraction.mock.calls.map((c) => c[0] as string);

    // Button-level await must be registered + unregistered.
    expect(registeredIds.some((id) => id.startsWith(buttonCustomIdPrefix))).toBe(true);
    expect(unregisteredIds.some((id) => id.startsWith(buttonCustomIdPrefix))).toBe(true);

    // Modal-level await must be registered + unregistered with the exact modal id.
    expect(registeredIds).toContain(modalCustomId);
    expect(unregisteredIds).toContain(modalCustomId);
  });

  it('defers the modal reply as ephemeral so validation/success replies stay private', async () => {
    const modalCustomId = `bill_submit_modal:${submittingUserId}:google_doc`;
    const modalSubmit = makeModalSubmit(modalCustomId);
    const interaction = makeInteraction(modalSubmit);

    mocks.db.select
      .mockReturnValueOnce(selectPlayerByDiscordId([playerRecord]))
      .mockReturnValueOnce(selectSlugCheck([]));
    mocks.db.insert
      .mockReturnValueOnce(makeBillInsertReturning([{ id: 'bill-uuid', billNumber: 8 }]))
      .mockReturnValueOnce(makeBillStatusLogInsert());
    mocks.db.transaction.mockImplementation(async (cb: any) => {
      const tx = {
        insert: vi.fn()
          .mockReturnValueOnce(makeBillInsertReturning([{ id: 'bill-uuid', billNumber: 8 }]))
          .mockReturnValueOnce(makeBillStatusLogInsert()),
      };
      return cb(tx);
    });

    const command = await loadCommand();
    await command.execute(interaction as any);

    expect(modalSubmit.deferReply).toHaveBeenCalledTimes(1);
    expect(modalSubmit.deferReply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true }),
    );
  });

  it('runs the bill insert + status-log inside a single transaction (rolls back when status log fails)', async () => {
    const modalCustomId = `bill_submit_modal:${submittingUserId}:google_doc`;
    const modalSubmit = makeModalSubmit(modalCustomId);
    const interaction = makeInteraction(modalSubmit);

    let billInsertedInTx = false;
    let statusLogInsertedInTx = false;

    mocks.db.select
      .mockReturnValueOnce(selectPlayerByDiscordId([playerRecord]))
      .mockReturnValueOnce(selectSlugCheck([]));

    // The fixed implementation must call db.transaction(...). Anything that
    // touches top-level db.insert is the broken non-transactional path and
    // should fail the test.
    mocks.db.insert.mockImplementation(() => {
      throw new Error('Bill insert escaped the transaction wrapper');
    });

    mocks.db.transaction.mockImplementation(async (cb: any) => {
      const tx = {
        insert: vi.fn()
          .mockReturnValueOnce({
            values: vi.fn(() => ({
              returning: vi.fn().mockImplementation(async () => {
                billInsertedInTx = true;
                return [{ id: 'bill-uuid', billNumber: 9 }];
              }),
            })),
          })
          .mockReturnValueOnce({
            values: vi.fn().mockImplementation(async () => {
              statusLogInsertedInTx = true;
              // Simulate status-log write blowing up; the transaction
              // wrapper must propagate this and abort the bill insert.
              throw new Error('status log insert failed');
            }),
          }),
      };
      return cb(tx);
    });

    const command = await loadCommand();
    await command.execute(interaction as any);

    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
    expect(billInsertedInTx).toBe(true);
    expect(statusLogInsertedInTx).toBe(true);

    // The user must see the database-error message (caught by the outer try).
    expect(modalSubmit.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
      }),
    );
    // Ensure no success embed slipped through.
    const replies = modalSubmit.editReply.mock.calls.map((c) => c[0]);
    const flat = JSON.stringify(replies);
    expect(flat).not.toContain('Bill Submitted');
    expect(flat).not.toContain('Short Bill Submitted');
  });
});
