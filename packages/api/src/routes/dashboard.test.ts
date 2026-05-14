import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bills,
  billStatusLog,
  elections,
  modActions,
  players,
  playerEventLog,
  simulationClock,
  ticketMessages,
  tickets,
} from '@hansard/db';
import dashboardRoutes from './dashboard';

const auth = vi.hoisted(() => ({
  isStaff: false,
}));

vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: async (request: any) => {
    request.session = { user: { id: 'viewer-player' } };
    request.player = { id: 'viewer-player', isStaff: auth.isStaff };
  },
}));

type TableResponses = Map<object, unknown[][]>;

class FakeQuery<T = unknown> implements PromiseLike<T[]> {
  private consumed = false;
  private rows: T[] = [];

  constructor(
    private readonly responses: TableResponses,
    private readonly table: object,
  ) {}

  where() {
    return this;
  }

  orderBy() {
    return this;
  }

  limit() {
    return this;
  }

  offset() {
    return this;
  }

  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    if (!this.consumed) {
      this.rows = (this.responses.get(this.table)?.shift() ?? []) as T[];
      this.consumed = true;
    }
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
}

function fakeDb(responses: TableResponses) {
  return {
    select: () => ({
      from: (table: object) => new FakeQuery(responses, table),
    }),
  };
}

async function appWithDb(responses: TableResponses) {
  const app = Fastify({ logger: false });
  app.decorate('db', fakeDb(responses) as any);
  await app.register(dashboardRoutes);
  return app;
}

const now = new Date('2026-05-09T12:00:00.000Z');

describe('dashboard routes', () => {
  beforeEach(() => {
    auth.isStaff = false;
  });

  it('omits staff-only overview metrics for non-staff players', async () => {
    const responses: TableResponses = new Map<object, unknown[][]>([
      [tickets, [[{ value: 7 }], [{ value: 6 }]]],
      [elections, [[{ value: 2 }], [{ value: 1 }]]],
      [players, [[{ value: 40 }], [{ value: 38 }]]],
      [bills, [[{ value: 3 }], [{ value: 2 }]]],
      [modActions, [[{ value: 9 }], [{ value: 8 }]]],
      [simulationClock, [[{ currentTick: 14, currentDate: 'Year 2, Month 4' }]]],
    ]);
    const app = await appWithDb(responses);

    const res = await app.inject('/api/dashboard/overview');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      upcomingVotes: 2,
      playerCount: 40,
      activeBills: 3,
      currentSimTick: 14,
      currentSimDate: 'Year 2, Month 4',
      prevWeek: {
        upcomingVotes: 1,
        playerCount: 38,
        activeBills: 2,
      },
    });
  });

  it('keeps staff-only overview metrics for staff viewers', async () => {
    auth.isStaff = true;
    const responses: TableResponses = new Map<object, unknown[][]>([
      [tickets, [[{ value: 7 }], [{ value: 6 }]]],
      [elections, [[{ value: 2 }], [{ value: 1 }]]],
      [players, [[{ value: 40 }], [{ value: 38 }]]],
      [bills, [[{ value: 3 }], [{ value: 2 }]]],
      [modActions, [[{ value: 9 }], [{ value: 8 }]]],
      [simulationClock, [[{ currentTick: 14, currentDate: 'Year 2, Month 4' }]]],
    ]);
    const app = await appWithDb(responses);

    const res = await app.inject('/api/dashboard/overview');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      activeTickets: 7,
      upcomingVotes: 2,
      playerCount: 40,
      activeBills: 3,
      activeModActions: 9,
      currentSimTick: 14,
      currentSimDate: 'Year 2, Month 4',
      prevWeek: {
        activeTickets: 6,
        upcomingVotes: 1,
        playerCount: 38,
        activeBills: 2,
        activeModActions: 8,
      },
    });
  });

  it('omits ticket and moderation activity for non-staff players', async () => {
    const responses: TableResponses = new Map<object, unknown[][]>([
      [ticketMessages, [[{
        content: 'Secret admin-only ticket note',
        createdAt: now,
        authorId: 'staff-player',
        ticketId: 'ticket-1',
      }]]],
      [billStatusLog, [[{
        fromStatus: 'draft',
        toStatus: 'submitted',
        createdAt: now,
        changedById: 'clerk-player',
        billId: 'bill-1',
      }]]],
      [playerEventLog, [[{
        eventType: 'office_appointed',
        description: 'Ada was appointed Chancellor',
        createdAt: now,
        playerId: 'ada-player',
        triggeredById: 'staff-player',
      }]]],
      [modActions, [[{
        type: 'formal_warning',
        reason: 'Secret moderation context',
        createdAt: now,
        moderatorId: 'staff-player',
        targetPlayerId: 'ada-player',
      }]]],
      [players, [[
        { id: 'staff-player', characterName: 'Staffer', discordUsername: 'staff' },
        { id: 'clerk-player', characterName: 'Clerk', discordUsername: 'clerk' },
        { id: 'ada-player', characterName: 'Ada', discordUsername: 'ada' },
      ]]],
    ]);
    const app = await appWithDb(responses);

    const res = await app.inject('/api/dashboard/activity');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        type: 'bill_status',
        system: 'bills',
        description: 'Bill status changed: draft -> submitted',
        timestamp: now.toISOString(),
        actorName: 'Clerk',
      },
      {
        type: 'player_event',
        system: 'players',
        description: 'Ada was appointed Chancellor',
        timestamp: now.toISOString(),
        actorName: 'Ada',
      },
    ]);
  });

  it('hides ailment and health player events from non-staff activity feed', async () => {
    // Even if a row leaks through the DB filter (or filtering regresses),
    // the route must not surface ailment/health event descriptions to non-staff
    // viewers — those strings contain specific condition + severity data that
    // /api/players/:id/health gates behind canViewPrivatePlayerData.
    const responses: TableResponses = new Map<object, unknown[][]>([
      [ticketMessages, [[]]],
      [billStatusLog, [[]]],
      [playerEventLog, [[
        {
          eventType: 'ailment_acquired',
          description: 'Acquired major ailment: cancer',
          createdAt: now,
          playerId: 'ada-player',
          triggeredById: null,
        },
        {
          eventType: 'health_changed',
          description: 'Health changed: severity worsened to critical',
          createdAt: now,
          playerId: 'ada-player',
          triggeredById: null,
        },
        {
          eventType: 'ailment_recovered',
          description: 'Recovered from major ailment: pneumonia',
          createdAt: now,
          playerId: 'ada-player',
          triggeredById: null,
        },
        {
          eventType: 'death',
          description: 'Ada died',
          createdAt: now,
          playerId: 'ada-player',
          triggeredById: null,
        },
      ]]],
      [modActions, [[]]],
      [players, [[
        { id: 'ada-player', characterName: 'Ada', discordUsername: 'ada' },
      ]]],
    ]);
    const app = await appWithDb(responses);

    const res = await app.inject('/api/dashboard/activity');

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ type: string; description: string }>;
    const descriptions = body.map((item) => item.description);
    expect(descriptions).not.toContain('Acquired major ailment: cancer');
    expect(descriptions).not.toContain('Health changed: severity worsened to critical');
    expect(descriptions).not.toContain('Recovered from major ailment: pneumonia');
    expect(descriptions).toContain('Ada died');
  });

  it('shows ailment and health player events to staff in the activity feed', async () => {
    auth.isStaff = true;
    const responses: TableResponses = new Map<object, unknown[][]>([
      [ticketMessages, [[]]],
      [billStatusLog, [[]]],
      [playerEventLog, [[
        {
          eventType: 'ailment_acquired',
          description: 'Acquired major ailment: cancer',
          createdAt: now,
          playerId: 'ada-player',
          triggeredById: null,
        },
      ]]],
      [modActions, [[]]],
      [players, [[
        { id: 'ada-player', characterName: 'Ada', discordUsername: 'ada' },
      ]]],
    ]);
    const app = await appWithDb(responses);

    const res = await app.inject('/api/dashboard/activity');

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ type: string; description: string }>;
    expect(body.map((item) => item.description)).toContain('Acquired major ailment: cancer');
  });
});
