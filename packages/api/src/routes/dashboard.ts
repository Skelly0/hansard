import type { FastifyInstance } from 'fastify';
import { eq, and, desc, count, inArray, or } from 'drizzle-orm';
import { requireAuth } from '../middleware/requireAuth.js';
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

/**
 * Dashboard routes — aggregated stats and activity feed.
 */
export default async function dashboardRoutes(fastify: FastifyInstance) {
  // GET /api/dashboard/overview — real aggregated metrics
  fastify.get(
    '/api/dashboard/overview',
    { preHandler: [requireAuth] },
    async () => {
      const db = fastify.db;

      // Active tickets: status != 'closed'
      const [ticketResult] = await db
        .select({ value: count() })
        .from(tickets)
        .where(
          and(
            // All non-closed tickets
            or(
              eq(tickets.status, 'open'),
              eq(tickets.status, 'in_progress'),
              eq(tickets.status, 'waiting'),
              eq(tickets.status, 'resolved'),
            ),
          ),
        );
      const activeTickets = ticketResult?.value ?? 0;

      // Upcoming votes: elections where status is 'voting_open' or 'draft'
      const [voteResult] = await db
        .select({ value: count() })
        .from(elections)
        .where(
          or(
            eq(elections.status, 'voting_open'),
            eq(elections.status, 'draft'),
          ),
        );
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

      // Active mod actions
      const [modResult] = await db
        .select({ value: count() })
        .from(modActions)
        .where(eq(modActions.isActive, true));
      const activeModActions = modResult?.value ?? 0;

      // Current sim tick
      const [clock] = await db.select().from(simulationClock).limit(1);
      const currentSimTick = clock?.currentTick ?? 0;
      const currentSimDate = clock?.currentDate ?? null;

      return {
        activeTickets,
        upcomingVotes,
        playerCount,
        activeBills,
        activeModActions,
        currentSimTick,
        currentSimDate,
      };
    },
  );

  // GET /api/dashboard/activity — recent activity feed across all systems
  fastify.get(
    '/api/dashboard/activity',
    { preHandler: [requireAuth] },
    async () => {
      const db = fastify.db;
      const items: {
        type: string;
        system: string;
        description: string;
        timestamp: string;
        actorName: string | null;
      }[] = [];

      // --- Recent ticket messages (last 20) ---
      const recentMessages = await db
        .select({
          content: ticketMessages.content,
          createdAt: ticketMessages.createdAt,
          authorId: ticketMessages.authorId,
          ticketId: ticketMessages.ticketId,
        })
        .from(ticketMessages)
        .orderBy(desc(ticketMessages.createdAt))
        .limit(20);

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
      const recentEvents = await db
        .select({
          eventType: playerEventLog.eventType,
          description: playerEventLog.description,
          createdAt: playerEventLog.createdAt,
          playerId: playerEventLog.playerId,
          triggeredById: playerEventLog.triggeredById,
        })
        .from(playerEventLog)
        .orderBy(desc(playerEventLog.createdAt))
        .limit(20);

      for (const event of recentEvents) {
        playerIds.add(event.playerId);
        if (event.triggeredById) playerIds.add(event.triggeredById);
      }

      // --- Recent mod actions ---
      const recentModActions = await db
        .select({
          type: modActions.type,
          reason: modActions.reason,
          createdAt: modActions.createdAt,
          moderatorId: modActions.moderatorId,
          targetPlayerId: modActions.targetPlayerId,
        })
        .from(modActions)
        .orderBy(desc(modActions.createdAt))
        .limit(20);

      for (const action of recentModActions) {
        playerIds.add(action.moderatorId);
        playerIds.add(action.targetPlayerId);
      }

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
        items.push({
          type: 'ticket_message',
          system: 'tickets',
          description: `New message on ticket: "${preview}"`,
          timestamp: msg.createdAt.toISOString(),
          actorName: getName(msg.authorId),
        });
      }

      for (const change of recentBillChanges) {
        items.push({
          type: 'bill_status',
          system: 'bills',
          description: `Bill status changed: ${change.fromStatus ?? 'new'} -> ${change.toStatus}`,
          timestamp: change.createdAt.toISOString(),
          actorName: getName(change.changedById),
        });
      }

      for (const event of recentEvents) {
        items.push({
          type: 'player_event',
          system: 'players',
          description: event.description,
          timestamp: event.createdAt.toISOString(),
          actorName: getName(event.playerId),
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
        });
      }

      // Sort all items by timestamp descending, limit to 20
      items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return items.slice(0, 20);
    },
  );
}
