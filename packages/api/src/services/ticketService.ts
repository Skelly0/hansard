import { eq, desc, and, ilike, sql, count, avg, inArray, or, type SQL } from 'drizzle-orm';
import {
  tickets,
  ticketCategories,
  ticketMessages,
  ticketAuditLog,
  players,
  type Database,
} from '@hansard/db';
import type {
  Ticket,
  TicketCategory,
  TicketMessage,
  TicketAuditLogEntry,
  TicketStatus,
  TicketPriority,
} from '@hansard/shared';
import { postToTicketThread } from './ticketThreadNotifier.js';

// ============================================================
// Types
// ============================================================

export interface CreateTicketData {
  categoryId: string;
  createdById: string;
  title: string;
  description: string;
  formData?: Record<string, unknown>;
  priority?: TicketPriority;
  tags?: string[];
  discordChannelId?: string;
  discordThreadId?: string;
}

export interface UpdateTicketData {
  status?: TicketStatus;
  priority?: TicketPriority;
  assignedToId?: string | null;
  tags?: string[];
  title?: string;
  description?: string;
  discordThreadId?: string | null;
}

export interface ListTicketsFilters {
  status?: TicketStatus;
  categoryId?: string;
  assignedToId?: string;
  createdById?: string;
  priority?: TicketPriority;
  tags?: string[];
  search?: string;
  limit?: number;
  offset?: number;
}

export interface TicketAccessContext {
  userId: string;
  isStaff: boolean;
}

interface TicketPlayerSummary {
  id: string;
  characterName: string | null;
  discordUsername: string;
}

interface TicketMessageWithAuthor extends TicketMessage {
  author?: TicketPlayerSummary;
}

interface TicketAuditLogEntryWithActor extends TicketAuditLogEntry {
  actor?: TicketPlayerSummary;
}

export interface TicketWithDetails extends Ticket {
  createdBy?: TicketPlayerSummary;
  assignedTo?: TicketPlayerSummary;
  messages?: TicketMessageWithAuthor[];
  auditLog?: TicketAuditLogEntryWithActor[];
  category?: TicketCategory;
}

export interface TicketMetrics {
  openCount: number;
  inProgressCount: number;
  resolvedToday: number;
  avgResponseTimeMs: number | null;
}

export interface CreateCategoryData {
  name: string;
  description?: string;
  emoji?: string;
  colour?: string;
  assignableRoles?: string[];
  customPipeline?: TicketCategory['customPipeline'];
  formTemplate?: TicketCategory['formTemplate'];
  sortOrder?: number;
}

/**
 * Thrown when a caller attempts to assign a ticket to a player who is not
 * staff. The service enforces this so that web/API and bot paths share the
 * same trust boundary — assigning to a non-staff player would otherwise
 * grant that player ticket visibility via `assignedToId === user.id`.
 */
export class TicketAssigneeNotStaffError extends Error {
  constructor(message = 'Ticket assignee must be a staff member') {
    super(message);
    this.name = 'TicketAssigneeNotStaffError';
  }
}

// ============================================================
// Service
// ============================================================

export class TicketService {
  constructor(private db: Database) {}

  private redactDiscordFieldsForViewer<
    T extends { discordChannelId?: string | null; discordThreadId?: string | null },
  >(ticket: T, viewer?: TicketAccessContext): T {
    if (!viewer || viewer.isStaff) return ticket;

    return {
      ...ticket,
      discordChannelId: null,
      discordThreadId: null,
    };
  }

  private visibilityCondition(viewer?: TicketAccessContext): SQL | undefined {
    if (!viewer || viewer.isStaff) return undefined;

    return or(
      eq(tickets.createdById, viewer.userId),
      eq(tickets.assignedToId, viewer.userId),
    );
  }

  private combineConditions(conditions: (SQL | undefined)[]): SQL | undefined {
    const present = conditions.filter((condition): condition is SQL => condition !== undefined);
    return present.length > 0 ? and(...present) : undefined;
  }

  private canViewTicket(
    ticket: { createdById: string; assignedToId: string | null },
    viewer?: TicketAccessContext,
  ): boolean {
    return (
      !viewer ||
      viewer.isStaff ||
      ticket.createdById === viewer.userId ||
      ticket.assignedToId === viewer.userId
    );
  }

  private async resolvePlayerDisplayName(id: string | null): Promise<string> {
    if (!id) return 'Unassigned';
    const [row] = await this.db
      .select({
        characterName: players.characterName,
        discordUsername: players.discordUsername,
      })
      .from(players)
      .where(eq(players.id, id))
      .limit(1);
    return row?.characterName || row?.discordUsername || 'Unknown';
  }

  private async lookupPlayerSummaries(ids: Iterable<string | null | undefined>): Promise<Map<string, TicketPlayerSummary>> {
    const playerIds = [...new Set([...ids].filter((id): id is string => !!id))];
    if (playerIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        id: players.id,
        characterName: players.characterName,
        discordUsername: players.discordUsername,
      })
      .from(players)
      .where(inArray(players.id, playerIds));

    return new Map(rows.map((row) => [row.id, row]));
  }

  // ----------------------------------------------------------
  // createTicket
  // ----------------------------------------------------------

  async createTicket(data: CreateTicketData): Promise<Ticket> {
    const [ticket] = await this.db
      .insert(tickets)
      .values({
        categoryId: data.categoryId,
        createdById: data.createdById,
        title: data.title,
        description: data.description,
        formData: data.formData ?? null,
        priority: data.priority ?? 'normal',
        tags: data.tags ?? [],
        discordChannelId: data.discordChannelId ?? null,
        discordThreadId: data.discordThreadId ?? null,
        status: 'open',
      })
      .returning();

    // Audit log: created
    await this.db.insert(ticketAuditLog).values({
      ticketId: ticket.id,
      actorId: data.createdById,
      action: 'created',
      newValue: { title: data.title, categoryId: data.categoryId },
    });

    return ticket as unknown as Ticket;
  }

  // ----------------------------------------------------------
  // getTicket
  // ----------------------------------------------------------

  async getTicket(id: string, viewer?: TicketAccessContext): Promise<TicketWithDetails | null> {
    const [ticket] = await this.db
      .select()
      .from(tickets)
      .where(eq(tickets.id, id))
      .limit(1);

    if (!ticket) return null;
    if (!this.canViewTicket(ticket, viewer)) return null;

    const messageConditions: SQL[] = [eq(ticketMessages.ticketId, id)];
    if (viewer && !viewer.isStaff) {
      messageConditions.push(eq(ticketMessages.isInternal, false));
    }

    const messages = await this.db
      .select()
      .from(ticketMessages)
      .where(and(...messageConditions))
      .orderBy(ticketMessages.createdAt);

    const auditLog = viewer && !viewer.isStaff
      ? []
      : await this.db
        .select()
        .from(ticketAuditLog)
        .where(eq(ticketAuditLog.ticketId, id))
        .orderBy(desc(ticketAuditLog.createdAt));

    const [category] = await this.db
      .select()
      .from(ticketCategories)
      .where(eq(ticketCategories.id, ticket.categoryId))
      .limit(1);

    const playerSummaries = await this.lookupPlayerSummaries([
      ticket.createdById,
      ticket.assignedToId,
      ...messages.map((message) => message.authorId),
      ...auditLog.map((entry) => entry.actorId),
    ]);

    const detailedTicket = {
      ...(ticket as unknown as Ticket),
      createdBy: playerSummaries.get(ticket.createdById),
      assignedTo: ticket.assignedToId ? playerSummaries.get(ticket.assignedToId) : undefined,
      messages: messages.map((message) => ({
        ...(message as unknown as TicketMessage),
        author: playerSummaries.get(message.authorId),
      })),
      auditLog: auditLog.map((entry) => ({
        ...(entry as unknown as TicketAuditLogEntry),
        actor: playerSummaries.get(entry.actorId),
      })),
      category: category as unknown as TicketCategory | undefined,
    };

    return this.redactDiscordFieldsForViewer(detailedTicket, viewer);
  }

  // ----------------------------------------------------------
  // getTicketByNumber
  // ----------------------------------------------------------

  async getTicketByNumber(
    ticketNumber: number,
    viewer?: TicketAccessContext,
  ): Promise<TicketWithDetails | null> {
    const [ticket] = await this.db
      .select()
      .from(tickets)
      .where(eq(tickets.number, ticketNumber))
      .limit(1);

    if (!ticket) return null;

    return this.getTicket(ticket.id, viewer);
  }

  // ----------------------------------------------------------
  // listTickets
  // ----------------------------------------------------------

  async listTickets(
    filters: ListTicketsFilters = {},
    viewer?: TicketAccessContext,
  ): Promise<{ tickets: Ticket[]; total: number }> {
    const conditions: SQL[] = [];
    const visibilityCondition = this.visibilityCondition(viewer);

    if (visibilityCondition) {
      conditions.push(visibilityCondition);
    }

    if (filters.status) {
      conditions.push(eq(tickets.status, filters.status));
    }
    if (filters.categoryId) {
      conditions.push(eq(tickets.categoryId, filters.categoryId));
    }
    if (filters.assignedToId) {
      conditions.push(eq(tickets.assignedToId, filters.assignedToId));
    }
    if (filters.createdById) {
      conditions.push(eq(tickets.createdById, filters.createdById));
    }
    if (filters.priority) {
      conditions.push(eq(tickets.priority, filters.priority));
    }
    if (filters.search) {
      conditions.push(ilike(tickets.title, `%${filters.search}%`));
    }

    const whereClause = this.combineConditions(conditions);

    const limit = filters.limit ?? 25;
    const offset = filters.offset ?? 0;

    const rows = await this.db
      .select()
      .from(tickets)
      .where(whereClause)
      .orderBy(desc(tickets.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ value: total }] = await this.db
      .select({ value: count() })
      .from(tickets)
      .where(whereClause);

    return {
      tickets: (rows as unknown as Ticket[]).map((ticket) =>
        this.redactDiscordFieldsForViewer(ticket, viewer),
      ),
      total,
    };
  }

  // ----------------------------------------------------------
  // getTicketsByIds — batch lookup, used for resolving linked-ticket IDs
  // ----------------------------------------------------------

  async getTicketsByIds(ids: string[], viewer?: TicketAccessContext): Promise<Ticket[]> {
    if (!ids.length) return [];

    const whereClause = this.combineConditions([
      inArray(tickets.id, ids),
      this.visibilityCondition(viewer),
    ]);

    const rows = await this.db
      .select()
      .from(tickets)
      .where(whereClause);
    return (rows as unknown as Ticket[]).map((ticket) =>
      this.redactDiscordFieldsForViewer(ticket, viewer),
    );
  }

  // ----------------------------------------------------------
  // updateTicket
  // ----------------------------------------------------------

  async updateTicket(id: string, updates: UpdateTicketData, actorId: string): Promise<Ticket | null> {
    // Fetch current ticket for audit diff
    const [current] = await this.db
      .select()
      .from(tickets)
      .where(eq(tickets.id, id))
      .limit(1);

    if (!current) return null;

    if (
      updates.assignedToId !== undefined
      && updates.assignedToId !== null
      && updates.assignedToId !== current.assignedToId
    ) {
      const [target] = await this.db
        .select()
        .from(players)
        .where(eq(players.id, updates.assignedToId))
        .limit(1);
      if (!target || !(target as { isStaff?: boolean }).isStaff) {
        throw new TicketAssigneeNotStaffError();
      }
    }

    const setValues: Record<string, unknown> = { updatedAt: new Date() };
    const auditEntries: { action: string; oldValue: unknown; newValue: unknown }[] = [];

    if (updates.status !== undefined && updates.status !== current.status) {
      auditEntries.push({
        action: 'status_changed',
        oldValue: current.status,
        newValue: updates.status,
      });
      setValues.status = updates.status;

      if (updates.status === 'resolved') {
        setValues.resolvedAt = new Date();
      }
      if (updates.status === 'closed') {
        setValues.closedAt = new Date();
      }
    }

    if (updates.priority !== undefined && updates.priority !== current.priority) {
      auditEntries.push({
        action: 'priority_changed',
        oldValue: current.priority,
        newValue: updates.priority,
      });
      setValues.priority = updates.priority;
    }

    if (updates.assignedToId !== undefined && updates.assignedToId !== current.assignedToId) {
      auditEntries.push({
        action: 'assigned',
        oldValue: current.assignedToId,
        newValue: updates.assignedToId,
      });
      setValues.assignedToId = updates.assignedToId;
    }

    if (updates.tags !== undefined) {
      auditEntries.push({
        action: 'tags_changed',
        oldValue: current.tags,
        newValue: updates.tags,
      });
      setValues.tags = updates.tags;
    }

    if (updates.title !== undefined && updates.title !== current.title) {
      setValues.title = updates.title;
    }

    if (updates.description !== undefined && updates.description !== current.description) {
      setValues.description = updates.description;
    }

    if (updates.discordThreadId !== undefined) {
      setValues.discordThreadId = updates.discordThreadId;
    }

    const [updated] = await this.db
      .update(tickets)
      .set(setValues)
      .where(eq(tickets.id, id))
      .returning();

    // Write audit entries
    for (const entry of auditEntries) {
      await this.db.insert(ticketAuditLog).values({
        ticketId: id,
        actorId,
        action: entry.action,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
      });
    }

    if (current.discordThreadId && auditEntries.length > 0) {
      const actorName = await this.resolvePlayerDisplayName(actorId);
      for (const entry of auditEntries) {
        const line = await this.formatUpdateForThread(entry, actorName);
        if (line) {
          await postToTicketThread({
            threadId: current.discordThreadId,
            content: line,
          });
        }
      }
    }

    return updated as unknown as Ticket;
  }

  private async formatUpdateForThread(
    entry: { action: string; oldValue: unknown; newValue: unknown },
    actorName: string,
  ): Promise<string | null> {
    switch (entry.action) {
      case 'status_changed':
        return `🔄 Status: \`${entry.oldValue}\` → \`${entry.newValue}\` (by **${actorName}**)`;
      case 'priority_changed':
        return `⚠️ Priority: \`${entry.oldValue}\` → \`${entry.newValue}\` (by **${actorName}**)`;
      case 'assigned': {
        const newName = await this.resolvePlayerDisplayName(
          typeof entry.newValue === 'string' ? entry.newValue : null,
        );
        const oldName = await this.resolvePlayerDisplayName(
          typeof entry.oldValue === 'string' ? entry.oldValue : null,
        );
        return `👤 Assigned to **${newName}** (was *${oldName}*, by **${actorName}**)`;
      }
      case 'tags_changed': {
        const oldTags = Array.isArray(entry.oldValue) ? (entry.oldValue as string[]) : [];
        const newTags = Array.isArray(entry.newValue) ? (entry.newValue as string[]) : [];
        const oldStr = oldTags.length ? oldTags.map((t) => `\`${t}\``).join(', ') : '*none*';
        const newStr = newTags.length ? newTags.map((t) => `\`${t}\``).join(', ') : '*none*';
        return `🏷️ Tags: ${oldStr} → ${newStr} (by **${actorName}**)`;
      }
      default:
        return null;
    }
  }

  // ----------------------------------------------------------
  // addMessage
  // ----------------------------------------------------------

  async addMessage(
    ticketId: string,
    content: string,
    authorId: string,
    isInternal = false,
    discordMessageId?: string,
    actorIsStaff = false,
    mirrorToThread = true,
  ): Promise<TicketMessage | null> {
    // Check if this is the first staff response — track firstResponseAt
    const [ticket] = await this.db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .limit(1);

    if (!ticket) return null;
    if (!this.canViewTicket(ticket, { userId: authorId, isStaff: actorIsStaff })) {
      return null;
    }
    if (isInternal && !actorIsStaff) {
      return null;
    }
    if (discordMessageId) {
      const [existingDiscordMessage] = await this.db
        .select({ id: ticketMessages.id })
        .from(ticketMessages)
        .where(and(
          eq(ticketMessages.ticketId, ticketId),
          eq(ticketMessages.discordMessageId, discordMessageId),
        ))
        .limit(1);
      if (existingDiscordMessage) return null;
    }

    if (!isInternal && !ticket.firstResponseAt && authorId !== ticket.createdById) {
      await this.db
        .update(tickets)
        .set({ firstResponseAt: new Date(), updatedAt: new Date() })
        .where(eq(tickets.id, ticketId));
    } else {
      await this.db
        .update(tickets)
        .set({ updatedAt: new Date() })
        .where(eq(tickets.id, ticketId));
    }

    let message;
    try {
      [message] = await this.db
        .insert(ticketMessages)
        .values({
          ticketId,
          authorId,
          content,
          isInternal,
          discordMessageId: discordMessageId ?? null,
        })
        .returning();
    } catch (err) {
      if (isTicketDiscordMessageUniqueViolation(err)) return null;
      throw err;
    }

    // Audit log
    await this.db.insert(ticketAuditLog).values({
      ticketId,
      actorId: authorId,
      action: isInternal ? 'internal_note' : 'commented',
      newValue: { messageId: message.id },
    });

    if (mirrorToThread && ticket.discordThreadId) {
      const authorName = await this.resolvePlayerDisplayName(authorId);
      const prefix = isInternal
        ? `🔒 **${authorName}** (internal note):`
        : `💬 **${authorName}** replied:`;
      await postToTicketThread({
        threadId: ticket.discordThreadId,
        content: `${prefix}\n${content}`,
      });
    }

    return message as unknown as TicketMessage;
  }

  // ----------------------------------------------------------
  // assignTicket
  // ----------------------------------------------------------

  async assignTicket(ticketId: string, assigneeId: string, actorId: string): Promise<Ticket | null> {
    // Verify the target is staff before mutating the ticket. Without this
    // guard, assigning a ticket to an ordinary player would silently grant
    // that player ticket visibility (getTicket / listTickets treat the
    // assignee as a permitted viewer). CLAUDE.md is explicit that
    // `/ticket assign` must validate this — the bot already does so locally,
    // and the rule lives here so any caller (web API, future bot rewrites)
    // benefits from the same check.
    const [target] = await this.db
      .select({ id: players.id, isStaff: players.isStaff })
      .from(players)
      .where(eq(players.id, assigneeId))
      .limit(1);

    if (!target || !target.isStaff) {
      throw new TicketAssigneeNotStaffError();
    }

    return this.updateTicket(
      ticketId,
      {
        assignedToId: assigneeId,
        status: 'in_progress',
      },
      actorId,
    );
  }

  // ----------------------------------------------------------
  // closeTicket
  // ----------------------------------------------------------

  async closeTicket(
    ticketId: string,
    resolution: string | null,
    actorId: string,
    actorIsStaff = false,
  ): Promise<Ticket | null> {
    const updated = await this.updateTicket(
      ticketId,
      { status: 'closed' },
      actorId,
    );

    if (!updated) return null;

    // Add resolution message if provided
    if (resolution) {
      await this.addMessage(
        ticketId,
        `**Resolution:** ${resolution}`,
        actorId,
        false,
        undefined,
        actorIsStaff,
      );
    }

    return updated;
  }

  // ----------------------------------------------------------
  // linkTickets / unlinkTickets — symmetric pairing via jsonb array
  // ----------------------------------------------------------

  async linkTickets(ticketId: string, otherTicketId: string, actorId: string): Promise<Ticket | null> {
    const [a] = await this.db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
    if (!a) return null;
    const [b] = await this.db.select().from(tickets).where(eq(tickets.id, otherTicketId)).limit(1);
    if (!b) return null;

    const aLinks = ((a.linkedTicketIds ?? []) as string[]);
    const bLinks = ((b.linkedTicketIds ?? []) as string[]);
    const aAlreadyLinked = aLinks.includes(otherTicketId);
    const bAlreadyLinked = bLinks.includes(ticketId);

    if (aAlreadyLinked && bAlreadyLinked) {
      return a as unknown as Ticket;
    }

    const newA = aAlreadyLinked ? aLinks : [...aLinks, otherTicketId];
    const newB = bAlreadyLinked ? bLinks : [...bLinks, ticketId];

    const now = new Date();
    await this.db.update(tickets).set({ linkedTicketIds: newA, updatedAt: now }).where(eq(tickets.id, ticketId));
    await this.db.update(tickets).set({ linkedTicketIds: newB, updatedAt: now }).where(eq(tickets.id, otherTicketId));

    await this.db.insert(ticketAuditLog).values({
      ticketId, actorId, action: 'linked',
      newValue: { linkedTicketId: otherTicketId },
    });
    await this.db.insert(ticketAuditLog).values({
      ticketId: otherTicketId, actorId, action: 'linked',
      newValue: { linkedTicketId: ticketId },
    });

    if (a.discordThreadId) {
      await postToTicketThread({
        threadId: a.discordThreadId,
        content: `🔗 Linked to ticket **#${b.number}** — ${b.title}`,
      });
    }
    if (b.discordThreadId) {
      await postToTicketThread({
        threadId: b.discordThreadId,
        content: `🔗 Linked to ticket **#${a.number}** — ${a.title}`,
      });
    }

    const [updated] = await this.db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
    return updated as unknown as Ticket;
  }

  async unlinkTickets(ticketId: string, otherTicketId: string, actorId: string): Promise<Ticket | null> {
    const [a] = await this.db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
    if (!a) return null;
    const [b] = await this.db.select().from(tickets).where(eq(tickets.id, otherTicketId)).limit(1);
    if (!b) return null;

    const existingALinks = ((a.linkedTicketIds ?? []) as string[]);
    const existingBLinks = ((b.linkedTicketIds ?? []) as string[]);
    const hadLink = existingALinks.includes(otherTicketId) || existingBLinks.includes(ticketId);

    if (!hadLink) {
      return a as unknown as Ticket;
    }

    const aLinks = existingALinks.filter((x) => x !== otherTicketId);
    const bLinks = existingBLinks.filter((x) => x !== ticketId);

    const now = new Date();
    await this.db.update(tickets).set({ linkedTicketIds: aLinks, updatedAt: now }).where(eq(tickets.id, ticketId));
    await this.db.update(tickets).set({ linkedTicketIds: bLinks, updatedAt: now }).where(eq(tickets.id, otherTicketId));

    await this.db.insert(ticketAuditLog).values({
      ticketId, actorId, action: 'unlinked',
      oldValue: { linkedTicketId: otherTicketId },
    });
    await this.db.insert(ticketAuditLog).values({
      ticketId: otherTicketId, actorId, action: 'unlinked',
      oldValue: { linkedTicketId: ticketId },
    });

    if (a.discordThreadId) {
      await postToTicketThread({
        threadId: a.discordThreadId,
        content: `🔓 Unlinked from ticket **#${b.number}** — ${b.title}`,
      });
    }
    if (b.discordThreadId) {
      await postToTicketThread({
        threadId: b.discordThreadId,
        content: `🔓 Unlinked from ticket **#${a.number}** — ${a.title}`,
      });
    }

    const [updated] = await this.db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
    return updated as unknown as Ticket;
  }

  // ----------------------------------------------------------
  // getCategories
  // ----------------------------------------------------------

  async getCategories(): Promise<TicketCategory[]> {
    const rows = await this.db
      .select()
      .from(ticketCategories)
      .where(eq(ticketCategories.isActive, true))
      .orderBy(ticketCategories.sortOrder);

    return rows as unknown as TicketCategory[];
  }

  // ----------------------------------------------------------
  // createOrUpdateCategory
  // ----------------------------------------------------------

  async createOrUpdateCategory(data: CreateCategoryData & { id?: string }): Promise<TicketCategory> {
    if (data.id) {
      const [updated] = await this.db
        .update(ticketCategories)
        .set({
          name: data.name,
          description: data.description ?? null,
          emoji: data.emoji ?? null,
          colour: data.colour ?? null,
          assignableRoles: data.assignableRoles ?? [],
          customPipeline: data.customPipeline ?? null,
          formTemplate: data.formTemplate ?? null,
          sortOrder: data.sortOrder ?? 0,
        })
        .where(eq(ticketCategories.id, data.id))
        .returning();

      return updated as unknown as TicketCategory;
    }

    const [created] = await this.db
      .insert(ticketCategories)
      .values({
        name: data.name,
        description: data.description ?? null,
        emoji: data.emoji ?? null,
        colour: data.colour ?? null,
        assignableRoles: data.assignableRoles ?? [],
        customPipeline: data.customPipeline ?? null,
        formTemplate: data.formTemplate ?? null,
        sortOrder: data.sortOrder ?? 0,
      })
      .returning();

    return created as unknown as TicketCategory;
  }

  // ----------------------------------------------------------
  // getMetrics
  // ----------------------------------------------------------

  async getMetrics(viewer?: TicketAccessContext): Promise<TicketMetrics> {
    const visibilityCondition = this.visibilityCondition(viewer);

    const [{ value: openCount }] = await this.db
      .select({ value: count() })
      .from(tickets)
      .where(this.combineConditions([
        eq(tickets.status, 'open'),
        visibilityCondition,
      ]));

    const [{ value: inProgressCount }] = await this.db
      .select({ value: count() })
      .from(tickets)
      .where(this.combineConditions([
        eq(tickets.status, 'in_progress'),
        visibilityCondition,
      ]));

    // Resolved in last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [{ value: resolvedToday }] = await this.db
      .select({ value: count() })
      .from(tickets)
      .where(this.combineConditions([
        eq(tickets.status, 'resolved'),
        sql`${tickets.resolvedAt} >= ${oneDayAgo}`,
        visibilityCondition,
      ]));

    // Average first-response time for tickets that have one
    const avgResult = await this.db
      .select({
        value: avg(
          sql`EXTRACT(EPOCH FROM (${tickets.firstResponseAt} - ${tickets.createdAt})) * 1000`,
        ),
      })
      .from(tickets)
      .where(this.combineConditions([
        sql`${tickets.firstResponseAt} IS NOT NULL`,
        visibilityCondition,
      ]));

    const avgResponseTimeMs = avgResult[0]?.value
      ? Math.round(parseFloat(String(avgResult[0].value)))
      : null;

    return {
      openCount,
      inProgressCount,
      resolvedToday,
      avgResponseTimeMs,
    };
  }
}

function isTicketDiscordMessageUniqueViolation(err: unknown): boolean {
  const maybePgError = err as { code?: unknown; constraint?: unknown };
  return (
    maybePgError.code === '23505' &&
    maybePgError.constraint === 'ticket_messages_discord_message_unique'
  );
}
