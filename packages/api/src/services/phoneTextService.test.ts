import { describe, expect, it } from 'vitest';
import { PhoneTextService, phoneTextReplyHintForResolution } from './phoneTextService.js';

type DbPlan = {
  selectQueues?: unknown[][];
  insertReturning?: unknown[][];
  insertErrors?: (Error | undefined)[];
  updateReturning?: unknown[][];
  updatedValues?: unknown[];
  insertedValues?: unknown[];
  deleteWhereArgs?: unknown[];
  executeCalls?: unknown[];
  transactionCalls?: { count: number };
};

function makeDb(plan: DbPlan = {}) {
  const selectQueues = [...(plan.selectQueues ?? [])];
  const insertReturning = [...(plan.insertReturning ?? [])];
  const insertErrors = [...(plan.insertErrors ?? [])];
  const updateReturning = [...(plan.updateReturning ?? [])];

  function thenableChain(): any {
    let resolved: Promise<unknown> | null = null;
    const ensure = () => {
      resolved ??= Promise.resolve(selectQueues.shift() ?? []);
      return resolved;
    };
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === 'then') {
          return (onFulfilled: (v: unknown) => unknown, onRejected?: (r: unknown) => unknown) =>
            ensure().then(onFulfilled, onRejected);
        }
        if (prop === 'catch') return (onRejected: (r: unknown) => unknown) => ensure().catch(onRejected);
        if (prop === 'finally') return (onFinally: () => void) => ensure().finally(onFinally);
        return () => thenableChain();
      },
    };
    return new Proxy({}, handler);
  }

  const api = {
    select: () => thenableChain(),
    insert: () => ({
      values: (value: unknown) => {
        plan.insertedValues?.push(value);
        const err = insertErrors.shift();
        const rows = insertReturning.shift() ?? [];
        const result = err ? Promise.reject(err) : Promise.resolve(rows);
        return {
          returning: () => result,
          onConflictDoUpdate: () => (err ? Promise.reject(err) : Promise.resolve(undefined)),
          then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
            (err ? Promise.reject(err) : Promise.resolve(undefined)).then(resolve, reject),
        };
      },
    }),
    update: () => ({
      set: (value: unknown) => {
        plan.updatedValues?.push(value);
        return {
          where: () => {
            const rows = updateReturning.shift() ?? [];
            return {
              returning: () => Promise.resolve(rows),
              then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
            };
          },
        };
      },
    }),
    delete: () => ({
      where: (whereArg: unknown) => {
        plan.deleteWhereArgs?.push(whereArg);
        return Promise.resolve(undefined);
      },
    }),
    execute: (query: unknown) => {
      plan.executeCalls?.push(query);
      return Promise.resolve(undefined);
    },
    transaction: async (fn: (tx: unknown) => unknown) => {
      if (plan.transactionCalls) plan.transactionCalls.count++;
      return fn(api);
    },
  };

  return api as any;
}

const numberA = '00000000-0000-0000-0000-000000000001';
const numberB = '00000000-0000-0000-0000-000000000002';

function participant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    numberId: numberA,
    numberRaw: '111',
    numberNormalized: '111',
    pseudonym: null,
    isActive: true,
    playerId: 'player-a',
    characterName: 'Alice',
    discordId: 'discord-a',
    discordUsername: 'Alice',
    isAlive: true,
    ...overrides,
  };
}

function conversation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'conversation-1',
    numberAId: numberA,
    numberBId: numberB,
    playerAId: 'player-a',
    playerBId: 'player-b',
    status: 'active',
    staffThreadId: null,
    lastMessageAt: new Date('2026-05-21T12:00:00.000Z'),
    createdAt: new Date('2026-05-21T12:00:00.000Z'),
    archivedAt: null,
    ...overrides,
  };
}

describe('PhoneTextService conversation creation', () => {
  it('locks the sorted number pair and re-selects if a concurrent insert wins', async () => {
    const raced = conversation();
    const executeCalls: unknown[] = [];
    const db = makeDb({
      executeCalls,
      selectQueues: [
        [participant({ numberId: numberA, playerId: 'player-a' })],
        [participant({
          numberId: numberB,
          numberRaw: '222',
          numberNormalized: '222',
          playerId: 'player-b',
          characterName: 'Bob',
          discordId: 'discord-b',
          discordUsername: 'Bob',
        })],
        [],
        [raced],
      ],
      insertErrors: [Object.assign(new Error('duplicate'), { code: '23505' })],
    });

    const svc = new PhoneTextService(db);

    await expect(svc.findOrCreateConversation(numberA, numberB)).resolves.toBe(raced);
    expect(executeCalls).toHaveLength(1);
  });
});

describe('PhoneTextService reply resolution', () => {
  it('falls back to the sole active conversation when no explicit reply target is selected', async () => {
    const conv = conversation();
    const db = makeDb({
      selectQueues: [
        [],
        [conv],
        [participant({ numberId: numberA, playerId: 'player-a' })],
        [participant({
          numberId: numberB,
          numberRaw: '222',
          numberNormalized: '222',
          playerId: 'player-b',
          characterName: 'Bob',
          discordId: 'discord-b',
          discordUsername: 'Bob',
        })],
      ],
    });

    const svc = new PhoneTextService(db);
    const resolution = await svc.resolveReplyConversation('player-a');

    expect(resolution.status).toBe('sole');
    expect(resolution.status === 'sole' ? resolution.context.conversation : null).toBe(conv);
  });

  it('prompts instead of guessing when multiple active conversations exist', async () => {
    const db = makeDb({
      selectQueues: [
        [],
        [conversation({ id: 'conversation-1' }), conversation({ id: 'conversation-2' })],
        [participant({ numberId: numberA, playerId: 'player-a' })],
        [participant({
          numberId: numberB,
          numberRaw: '222',
          numberNormalized: '222',
          playerId: 'player-b',
          characterName: 'Bob',
          discordId: 'discord-b',
          discordUsername: 'Bob',
        })],
        [participant({ numberId: numberA, playerId: 'player-a' })],
        [participant({
          numberId: numberB,
          numberRaw: '222',
          numberNormalized: '222',
          playerId: 'player-b',
          characterName: 'Bob',
          discordId: 'discord-b',
          discordUsername: 'Bob',
        })],
      ],
    });

    const svc = new PhoneTextService(db);
    const resolution = await svc.resolveReplyConversation('player-a');

    expect(resolution.status).toBe('multiple');
    expect(resolution.status === 'multiple' ? resolution.conversations : []).toHaveLength(2);
  });
});

describe('phoneTextReplyHintForResolution', () => {
  it('tells players with multiple conversations how to list, switch, or close one', () => {
    const hint = phoneTextReplyHintForResolution({ status: 'multiple', conversations: [] });

    expect(hint).toContain('/phone conversations');
    expect(hint).toContain('/phone switch');
    expect(hint).toContain('/phone close-conversation');
  });
});

describe('PhoneTextService queued delivery claims', () => {
  it('claims a queued delivery before send', async () => {
    const now = new Date('2026-05-21T12:00:00.000Z');
    const claimed = { id: 'delivery-1', status: 'delivering', claimedAt: now };
    const updatedValues: unknown[] = [];
    const db = makeDb({ updateReturning: [[claimed]], updatedValues });
    const svc = new PhoneTextService(db);

    await expect(svc.claimDeliveryForSend('delivery-1', now)).resolves.toBe(claimed);
    expect(updatedValues).toContainEqual({ status: 'delivering', claimedAt: now, failureReason: null });
  });

  it('releases stale delivery claims back to queued', async () => {
    const now = new Date('2026-05-21T12:00:00.000Z');
    const swept = [{ id: 'delivery-1', status: 'queued' }];
    const updatedValues: unknown[] = [];
    const db = makeDb({ updateReturning: [swept], updatedValues });
    const svc = new PhoneTextService(db);

    await expect(svc.sweepStaleDeliveryClaims({ now, maxAgeMs: 1000 })).resolves.toBe(swept);
    expect(updatedValues).toContainEqual({ status: 'queued', claimedAt: null, failureReason: null });
  });
});

describe('PhoneTextService archiving', () => {
  it('clears reply targets and fails queued deliveries in the archived conversation', async () => {
    const archived = conversation({ status: 'archived', archivedAt: new Date('2026-05-21T12:00:00.000Z') });
    const updatedValues: unknown[] = [];
    const deleteWhereArgs: unknown[] = [];
    const db = makeDb({
      updateReturning: [[archived], []],
      updatedValues,
      deleteWhereArgs,
    });
    const svc = new PhoneTextService(db);

    await expect(svc.archiveConversation('player-a', 'conversation-1')).resolves.toBe(archived);
    expect(deleteWhereArgs).toHaveLength(1);
    expect(updatedValues).toContainEqual({
      status: 'failed',
      failureReason: 'conversation archived',
      claimedAt: null,
    });
  });
});

describe('PhoneTextService replies', () => {
  it('rejects replies if either stored phone number has been deactivated', async () => {
    const db = makeDb({
      selectQueues: [
        [conversation()],
        [participant({ numberId: numberA, playerId: 'player-a' })],
        [participant({
          numberId: numberB,
          numberRaw: '222',
          numberNormalized: '222',
          isActive: false,
          playerId: 'player-b',
          characterName: 'Bob',
          discordId: 'discord-b',
          discordUsername: 'Bob',
        })],
      ],
    });
    const svc = new PhoneTextService(db);

    await expect(svc.recordReply({
      senderPlayerId: 'player-a',
      conversationId: 'conversation-1',
      content: 'still there?',
    })).rejects.toMatchObject({ code: 'not_found' });
  });
});
