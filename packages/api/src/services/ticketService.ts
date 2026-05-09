import { eq, desc, and, ilike, sql, count, avg, inArray, or, type SQL } from 'drizzle-orm';
import {
  tickets,
  ticketCategories,
  ticketMessages,
  ticketAuditLog,
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
  discordThreadId?: string;
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

export interface TicketWithDetails extends Ticket {
  messages?: TicketMessage[];
  auditLog?: TicketAuditLogEntry[];
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

// ============================================================
// Service
// ============================================================

export class TicketService {
  constructor(private db: Database) {}

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

    const messageConditions = [eq(ticketMessages.ticketId, id)];
    if (viewer && !viewer.isStaff) {
      messageConditions.push(eq(ticketMessages.isInternal, false));
    }

    const messages = await this.db
      .select()
      .from(ticketMessages)
      .where(this.combineConditions(messageConditions))
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

    return {
      ...(ticket as unknown as Ticket),
      messages: messages as unknown as TicketMessage[],
      auditLog: auditLog as unknown as TicketAuditLogEntry[],
      category: category as unknown as TicketCategory | undefined,
    };
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
      tickets: rows as unknown as Ticket[],
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
    return rows as unknown as Ticket[];
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

    return updated as unknown as Ticket;
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

    if (!ticket.firstResponseAt && authorId !== ticket.createdById) {
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

    const [message] = await this.db
      .insert(ticketMessages)
      .values({
        ticketId,
        authorId,
        content,
        isInternal,
        discordMessageId: discordMessageId ?? null,
      })
      .returning();

    // Audit log
    await this.db.insert(ticketAuditLog).values({
      ticketId,
      actorId: authorId,
      action: isInternal ? 'internal_note' : 'commented',
      newValue: { messageId: message.id },
    });

    return message as unknown as TicketMessage;
  }

  // ----------------------------------------------------------
  // assignTicket
  // ----------------------------------------------------------

  async assignTicket(ticketId: string, assigneeId: string, actorId: string): Promise<Ticket | null> {
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

    const newA = aLinks.includes(otherTicketId) ? aLinks : [...aLinks, otherTicketId];
    const newB = bLinks.includes(ticketId) ? bLinks : [...bLinks, ticketId];

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

    const [updated] = await this.db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
    return updated as unknown as Ticket;
  }

  async unlinkTickets(ticketId: string, otherTicketId: string, actorId: string): Promise<Ticket | null> {
    const [a] = await this.db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
    if (!a) return null;
    const [b] = await this.db.select().from(tickets).where(eq(tickets.id, otherTicketId)).limit(1);
    if (!b) return null;

    const aLinks = ((a.linkedTicketIds ?? []) as string[]).filter((x) => x !== otherTicketId);
    const bLinks = ((b.linkedTicketIds ?? []) as string[]).filter((x) => x !== ticketId);

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
