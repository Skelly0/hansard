import type { FastifyInstance } from 'fastify';
import { eq, and, desc, count, inArray, or, lt } from 'drizzle-orm';
import { requireAuth } from '../middleware/requireAuth.js';
import { PlayerEventType } from '@hansard/shared';
import {
  tickets,
  ticketMessages,
  elections,
  players,
  bills,
  modActions,
  simulationClock,
  playerEventLog,
  billStatusLog,
} from '@hansard/db';

const STAFF_UPCOMING_VOTE_STATUSES = ['voting_open', 'draft'];
const PUBLIC_UPCOMING_VOTE_STATUSES = [
  'nominations_open',
  'nominations_closed',
  'voting_open',
];

// Public dashboard activity feed must not leak per-player ailment data:
// /api/players/:id/health is gated behind canViewPrivatePlayerData, and
// PUBLIC_PLAYER_EVENT_TYPES in playerService.ts deliberately omits
// AILMENT_ACQUIRED / AILMENT_RECOVERED / HEALTH_CHANGED for the same reason.
// DEATH stays public — the existing obituary surface is already broadcast.
const PUBLIC_DASHBOARD_EVENT_TYPES = [
  PlayerEventType.PARTY_CHANGE,
  PlayerEventType.FACTION_CHANGE,
  PlayerEventType.OFFICE_APPOINTED,
  PlayerEventType.OFFICE_LEFT,
  PlayerEventType.DEATH,
  PlayerEventType.REGISTRATION,
  PlayerEventType.NAME_CHANGE,
];

function activeTicketStatusFilter() {
  return or(
    eq(tickets.status, 'open'),
    eq(tickets.status, 'in_progress'),
    eq(tickets.status, 'waiting'),
    eq(tickets.status, 'resolved'),
  );
}

function upcomingVoteStatusFilter(isStaffViewer: boolean) {
  return inArray(
    elections.status,
    isStaffViewer ? STAFF_UPCOMING_VOTE_STATUSES : PUBLIC_UPCOMING_VOTE_STATUSES,
  );
}

/**
 * Dashboard routes — aggregated stats and activity feed.
 */
export default async function dashboardRoutes(fastify: FastifyInstance) {
  // GET /api/dashboard/overview — real aggregated metrics
  fastify.get(
    '/api/dashboard/overview',
    { preHandler: [requireAuth] },
    async (request) => {
      const db = fastify.db;
      const isStaffViewer = request.player?.isStaff ?? false;

      let activeTickets: number | undefined;
      if (isStaffViewer) {
        // Staff-only operational queue size. Players should not learn whether
        // private tickets exist through the public dashboard JSON.
        const [ticketResult] = await db
          .select({ value: count() })
          .from(tickets)
          .where(activeTicketStatusFilter());
        activeTickets = ticketResult?.value ?? 0;
      }

      // Upcoming votes: staff sees drafts; players only see public vote states.
      const [voteResult] = await db
        .select({ value: count() })
        .from(elections)
        .where(upcomingVoteStatusFilter(isStaffViewer));
      const upcomingVotes = voteResult?.value ?? 0;

      // Player count: active AND alive players
      const [playerResult] = await db
        .select({ value: count() })
        .from(players)
        .where(
          and(
            eq(players.isActive, true),
            eq(players.isAlive, true),
          ),
        );
      const playerCount = playerResult?.value ?? 0;

      // Active bills: status in ('submitted', 'voting')
      const [billResult] = await db
        .select({ value: count() })
        .from(bills)
        .where(
          or(
            eq(bills.status, 'submitted'),
            eq(bills.status, 'voting'),
          ),
        );
      const activeBills = billResult?.value ?? 0;

      let activeModActions: number | undefined;
      if (isStaffViewer) {
        // Staff-only moderation queue size. Public dashboard must not expose it.
        const [modResult] = await db
          .select({ value: count() })
          .from(modActions)
          .where(eq(modActions.isActive, true));
        activeModActions = modResult?.value ?? 0;
      }

      // Current sim tick
      const [clock] = await db.select().from(simulationClock).limit(1);
      const currentSimTick = clock?.currentTick ?? 0;
      const currentSimDate = clock?.currentDate ?? null;

      // === Previous-week counts (for trend deltas) ===
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      let prevWeek: {
        activeTickets?: number;
        upcomingVotes: number;
        playerCount: number;
        activeBills: number;
        activeModActions?: number;
      } | null = null;

      try {
        if (isStaffViewer) {
          // Run the 5 queries in parallel — they're fully independent.
          const [
            [prevTicketResult],
            [prevVoteResult],
            [prevPlayerResult],
            [prevBillResult],
            [prevModResult],
          ] = await Promise.all([
            db.select({ value: count() }).from(tickets).where(and(
              activeTicketStatusFilter(),
              lt(tickets.createdAt, sevenDaysAgo),
            )),
            db.select({ value: count() }).from(elections).where(and(
              upcomingVoteStatusFilter(isStaffViewer),
              lt(elections.createdAt, sevenDaysAgo),
            )),
            db.select({ value: count() }).from(players).where(and(
              eq(players.isActive, true),
              eq(players.isAlive, true),
              lt(players.registeredAt, sevenDaysAgo),
            )),
            db.select({ value: count() }).from(bills).where(and(
              or(
                eq(bills.status, 'submitted'),
                eq(bills.status, 'voting'),
              ),
              lt(bills.submittedAt, sevenDaysAgo),
            )),
            db.select({ value: count() }).from(modActions).where(and(
              eq(modActions.isActive, true),
              lt(modActions.createdAt, sevenDaysAgo),
            )),
          ]);

          prevWeek = {
            activeTickets: prevTicketResult?.value ?? 0,
            upcomingVotes: prevVoteResult?.value ?? 0,
            playerCount: prevPlayerResult?.value ?? 0,
            activeBills: prevBillResult?.value ?? 0,
            activeModActions: prevModResult?.value ?? 0,
          };
        } else {
          const [
            [prevVoteResult],
            [prevPlayerResult],
            [prevBillResult],
          ] = await Promise.all([
            db.select({ value: count() }).from(elections).where(and(
              upcomingVoteStatusFilter(false),
              lt(elections.createdAt, sevenDaysAgo),
            )),
            db.select({ value: count() }).from(players).where(and(
              eq(players.isActive, true),
              eq(players.isAlive, true),
              lt(players.registeredAt, sevenDaysAgo),
            )),
            db.select({ value: count() }).from(bills).where(and(
              or(
                eq(bills.status, 'submitted'),
                eq(bills.status, 'voting'),
              ),
              lt(bills.submittedAt, sevenDaysAgo),
            )),
          ]);

          prevWeek = {
            upcomingVotes: prevVoteResult?.value ?? 0,
            playerCount: prevPlayerResult?.value ?? 0,
            activeBills: prevBillResult?.value ?? 0,
          };
        }
      } catch (err) {
        fastify.log.warn({ err }, 'Failed to compute prevWeek dashboard counts');
        // prevWeek stays null
      }

      const overview: {
        activeTickets?: number;
        upcomingVotes: number;
        playerCount: number;
        activeBills: number;
        activeModActions?: number;
        currentSimTick: number;
        currentSimDate: string | null;
        prevWeek: typeof prevWeek;
      } = {
        upcomingVotes,
        playerCount,
        activeBills,
        currentSimTick,
        currentSimDate,
        prevWeek,
      };

      if (isStaffViewer) {
        overview.activeTickets = activeTickets ?? 0;
        overview.activeModActions = activeModActions ?? 0;
      }

      return overview;
    },
  );

  // GET /api/dashboard/activity — recent activity feed across all systems
  fastify.get(
    '/api/dashboard/activity',
    { preHandler: [requireAuth] },
    async (request) => {
      const db = fastify.db;
      const isStaffViewer = request.player?.isStaff ?? false;
      const items: {
        type: string;
        system: string;
        description: string;
        timestamp: string;
        actorName: string | null;
        /** Player UUID of the actor, so the web can colour avatars consistently. */
        actorId?: string | null;
        /** In-app path for the record this item is about. */
        href?: string | null;
      }[] = [];

      // --- Recent ticket messages (last 20) ---
      const recentMessages = isStaffViewer
        ? await db
          .select({
            content: ticketMessages.content,
            createdAt: ticketMessages.createdAt,
            authorId: ticketMessages.authorId,
            ticketId: ticketMessages.ticketId,
          })
          .from(ticketMessages)
          .orderBy(desc(ticketMessages.createdAt))
          .limit(20)
        : [];

      // Collect unique player IDs for name resolution
      const playerIds = new Set<string>();
      for (const msg of recentMessages) {
        playerIds.add(msg.authorId);
      }

      // --- Recent bill status changes ---
      const recentBillChanges = await db
        .select({
          toStatus: billStatusLog.toStatus,
          fromStatus: billStatusLog.fromStatus,
          createdAt: billStatusLog.createdAt,
          changedById: billStatusLog.changedById,
          billId: billStatusLog.billId,
        })
        .from(billStatusLog)
        .orderBy(desc(billStatusLog.createdAt))
        .limit(20);

      for (const change of recentBillChanges) {
        playerIds.add(change.changedById);
      }

      // --- Recent player events ---
      // Non-staff viewers must never see AILMENT_* or HEALTH_CHANGED rows because
      // those descriptions embed condition + severity (matching what
      // /api/players/:id/health gates behind canViewPrivatePlayerData). The DB
      // filter handles this for normal queries, but we also re-filter the
      // returned rows so that any test fake or future loosening of the WHERE
      // clause still cannot leak those rows to non-staff dashboard consumers.
      const rawRecentEvents = isStaffViewer
        ? await db
          .select({
            eventType: playerEventLog.eventType,
            description: playerEventLog.description,
            createdAt: playerEventLog.createdAt,
            playerId: playerEventLog.playerId,
            triggeredById: playerEventLog.triggeredById,
          })
          .from(playerEventLog)
          .orderBy(desc(playerEventLog.createdAt))
          .limit(20)
        : await db
          .select({
            eventType: playerEventLog.eventType,
            description: playerEventLog.description,
            createdAt: playerEventLog.createdAt,
            playerId: playerEventLog.playerId,
            triggeredById: playerEventLog.triggeredById,
          })
          .from(playerEventLog)
          .where(inArray(playerEventLog.eventType, PUBLIC_DASHBOARD_EVENT_TYPES))
          .orderBy(desc(playerEventLog.createdAt))
          .limit(20);

      const recentEvents = isStaffViewer
        ? rawRecentEvents
        : rawRecentEvents.filter((event) =>
          (PUBLIC_DASHBOARD_EVENT_TYPES as string[]).includes(event.eventType),
        );

      for (const event of recentEvents) {
        playerIds.add(event.playerId);
        if (event.triggeredById) playerIds.add(event.triggeredById);
      }

      // --- Recent mod actions ---
      const recentModActions = isStaffViewer
        ? await db
          .select({
            type: modActions.type,
            reason: modActions.reason,
            createdAt: modActions.createdAt,
            moderatorId: modActions.moderatorId,
            targetPlayerId: modActions.targetPlayerId,
          })
          .from(modActions)
          .orderBy(desc(modActions.createdAt))
          .limit(20)
        : [];

      for (const action of recentModActions) {
        playerIds.add(action.moderatorId);
        playerIds.add(action.targetPlayerId);
      }

      // --- Resolve bill titles/slugs and ticket numbers for readable, linkable items ---
      const billIds = [...new Set(recentBillChanges.map((change) => change.billId))];
      const billRows = billIds.length
        ? await db
          .select({ id: bills.id, title: bills.title, slug: bills.slug })
          .from(bills)
          .where(inArray(bills.id, billIds))
        : [];
      const billMap = new Map(billRows.map((row) => [row.id, row]));

      const ticketIds = [...new Set(recentMessages.map((msg) => msg.ticketId))];
      const ticketRows = ticketIds.length
        ? await db
          .select({ id: tickets.id, number: tickets.number })
          .from(tickets)
          .where(inArray(tickets.id, ticketIds))
        : [];
      const ticketNumberMap = new Map(ticketRows.map((row) => [row.id, row.number]));

      // --- Resolve player names ---
      const playerIdArray = [...playerIds];
      const nameMap = new Map<string, string>();

      if (playerIdArray.length > 0) {
        const playerRows = await db
          .select({ id: players.id, characterName: players.characterName, discordUsername: players.discordUsername })
          .from(players)
          .where(inArray(players.id, playerIdArray));

        for (const row of playerRows) {
          nameMap.set(row.id, row.characterName ?? row.discordUsername);
        }
      }

      const getName = (id: string) => nameMap.get(id) ?? 'Unknown';

      // --- Build activity items ---

      for (const msg of recentMessages) {
        const preview = msg.content.length > 80 ? msg.content.slice(0, 77) + '...' : msg.content;
        const ticketNumber = ticketNumberMap.get(msg.ticketId);
        const label = ticketNumber !== undefined
          ? `ticket #${String(ticketNumber).padStart(3, '0')}`
          : 'ticket';
        items.push({
          type: 'ticket_message',
          system: 'tickets',
          description: `New message on ${label}: "${preview}"`,
          timestamp: msg.createdAt.toISOString(),
          actorName: getName(msg.authorId),
          actorId: msg.authorId,
          href: `/tickets/${msg.ticketId}`,
        });
      }

      for (const change of recentBillChanges) {
        const bill = billMap.get(change.billId);
        items.push({
          type: 'bill_status',
          system: 'bills',
          description: describeBillStatusChange(bill?.title ?? null, change.fromStatus, change.toStatus),
          timestamp: change.createdAt.toISOString(),
          actorName: getName(change.changedById),
          actorId: change.changedById,
          href: bill ? `/bills/${bill.slug}` : null,
        });
      }

      for (const event of recentEvents) {
        items.push({
          type: 'player_event',
          system: 'players',
          description: event.description,
          timestamp: event.createdAt.toISOString(),
          actorName: getName(event.playerId),
          actorId: event.playerId,
          href: `/players/${event.playerId}`,
        });
      }

      for (const action of recentModActions) {
        const targetName = getName(action.targetPlayerId);
        const modName = getName(action.moderatorId);
        items.push({
          type: 'mod_action',
          system: 'moderation',
          description: `${modName} issued ${action.type.replace(/_/g, ' ')} on ${targetName}`,
          timestamp: action.createdAt.toISOString(),
          actorName: modName,
          actorId: action.moderatorId,
          href: '/moderation',
        });
      }

      // Sort all items by timestamp descending, limit to 20
      items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return items.slice(0, 20);
    },
  );
}

const BILL_STATUS_PHRASES: Record<string, string> = {
  submitted: 'was submitted',
  voting: 'went to a vote',
  player_passed: 'passed the Assembly',
  player_rejected: 'was rejected by the Assembly',
  npc_pending: 'went to the NPC house',
  npc_passed: 'passed the NPC house',
  npc_rejected: 'was rejected by the NPC house',
  enacted: 'was enacted',
  active: 'came into force',
  amended: 'was amended',
  repealed: 'was repealed',
  withdrawn: 'was withdrawn',
};

/**
 * Human sentence for a bill status transition, e.g.
 * `"Free Ports Act" was enacted`. Falls back to "from → to" for statuses
 * without a phrase so new lifecycle states still read sensibly.
 */
export function describeBillStatusChange(
  title: string | null,
  fromStatus: string | null,
  toStatus: string,
): string {
  const subject = title ? `“${title}”` : 'A bill';
  const phrase = BILL_STATUS_PHRASES[toStatus];
  if (phrase) return `${subject} ${phrase}`;
  const from = (fromStatus ?? 'new').replace(/_/g, ' ');
  return `${subject} moved from ${from} to ${toStatus.replace(/_/g, ' ')}`;
}
