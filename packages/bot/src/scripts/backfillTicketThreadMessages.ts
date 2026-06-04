import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  closeDb,
  players,
  ticketAuditLog,
  ticketMessages,
  tickets,
  type Database,
} from '@hansard/db';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '../../../../.env') });
loadDotenv();

export interface DiscordThreadMessage {
  id: string;
  content: string;
  timestamp: string;
  type?: number;
  attachments?: {
    filename?: string;
    name?: string;
    url?: string;
  }[];
  sticker_items?: {
    name?: string;
  }[];
  author: {
    id: string;
    bot?: boolean;
  };
}

export interface BackfillTicketRow {
  id: string;
  number: number;
  title: string;
  createdById: string;
  assignedToId: string | null;
  discordThreadId: string;
  firstResponseAt: Date | null;
  updatedAt: Date;
}

export interface BackfillPlayerRow {
  id: string;
  discordId: string;
}

export interface BackfillCandidate {
  ticket: BackfillTicketRow;
  ticketId: string;
  ticketNumber: number;
  authorPlayerId: string;
  content: string;
  discordMessageId: string;
  createdAt: Date;
  isInternal: boolean;
}

export interface BackfillSkippedCounts {
  bot: number;
  empty: number;
  existing: number;
  invalidTimestamp: number;
  unmappedAuthor: number;
  unsupportedType: number;
}

export interface CandidateSelectionResult {
  candidates: BackfillCandidate[];
  skipped: BackfillSkippedCounts;
}

export interface FetchDiscordThreadMessagesOptions {
  threadId: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export interface RunBackfillTicketThreadMessagesOptions {
  args?: string[];
  database?: Database;
  discordToken?: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export interface BackfillRunResult {
  dryRun: boolean;
  scannedTickets: number;
  fetchedMessages: number;
  selected: CandidateSelectionResult;
  limitedCandidates: number;
  inserted: number;
  skippedAtWrite: number;
  fetchFailures: number;
}

interface ParsedArgs {
  apply: boolean;
  dryRun: boolean;
  limit?: number;
  ticketNumber?: number;
  verbose: boolean;
}

const EMPTY_SKIPPED_COUNTS: BackfillSkippedCounts = {
  bot: 0,
  empty: 0,
  existing: 0,
  invalidTimestamp: 0,
  unmappedAuthor: 0,
  unsupportedType: 0,
};

export async function fetchDiscordThreadMessages(
  options: FetchDiscordThreadMessagesOptions,
): Promise<DiscordThreadMessage[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const messages: DiscordThreadMessage[] = [];
  let before: string | undefined;

  while (true) {
    const url = new URL(`${DISCORD_API_BASE}/channels/${options.threadId}/messages`);
    url.searchParams.set('limit', '100');
    if (before) url.searchParams.set('before', before);

    const response = await fetchImpl(url, {
      headers: { Authorization: `Bot ${options.token}` },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Discord fetch failed for thread ${options.threadId}: ${response.status} ${body.slice(0, 160)}`);
    }

    const page = await response.json() as DiscordThreadMessage[];
    messages.push(...page);
    if (page.length < 100) break;

    before = page.at(-1)?.id;
    if (!before) break;
  }

  return messages.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export function selectBackfillCandidates(options: {
  tickets: BackfillTicketRow[];
  messagesByThreadId: ReadonlyMap<string, DiscordThreadMessage[]>;
  existingDiscordMessageIds: ReadonlySet<string>;
  playersByDiscordId: ReadonlyMap<string, BackfillPlayerRow>;
}): CandidateSelectionResult {
  const skipped = { ...EMPTY_SKIPPED_COUNTS };
  const candidates: BackfillCandidate[] = [];

  for (const ticket of options.tickets) {
    const messages = options.messagesByThreadId.get(ticket.discordThreadId) ?? [];
    for (const message of messages) {
      if (!isUserAuthoredTextMessageType(message.type)) {
        skipped.unsupportedType += 1;
        continue;
      }
      if (message.author.bot) {
        skipped.bot += 1;
        continue;
      }
      const content = formatDiscordThreadMessageContent(message);
      if (!content) {
        skipped.empty += 1;
        continue;
      }
      if (options.existingDiscordMessageIds.has(message.id)) {
        skipped.existing += 1;
        continue;
      }
      const createdAt = new Date(message.timestamp);
      if (Number.isNaN(createdAt.getTime())) {
        skipped.invalidTimestamp += 1;
        continue;
      }
      const player = options.playersByDiscordId.get(message.author.id);
      if (!player) {
        skipped.unmappedAuthor += 1;
        continue;
      }

      candidates.push({
        ticket,
        ticketId: ticket.id,
        ticketNumber: ticket.number,
        authorPlayerId: player.id,
        content,
        discordMessageId: message.id,
        createdAt,
        isInternal: true,
      });
    }
  }

  candidates.sort((a, b) => (
    a.createdAt.getTime() - b.createdAt.getTime()
    || a.ticketNumber - b.ticketNumber
    || a.discordMessageId.localeCompare(b.discordMessageId)
  ));

  return { candidates, skipped };
}

function formatDiscordThreadMessageContent(message: DiscordThreadMessage): string {
  const body = message.content.trim();
  const attachmentLines = (message.attachments ?? [])
    .map((attachment) => {
      const url = attachment.url?.trim();
      if (!url) return null;
      const name = attachment.filename?.trim() || attachment.name?.trim() || 'attachment';
      return `- ${name}: ${url}`;
    })
    .filter((line): line is string => Boolean(line));
  const stickerLines = (message.sticker_items ?? [])
    .map((sticker) => sticker.name?.trim())
    .filter((name): name is string => Boolean(name))
    .map((name) => `- ${name}`);

  if (attachmentLines.length === 0 && stickerLines.length === 0) return body;

  return [
    body,
    attachmentLines.length > 0 ? `**Attachments:**\n${attachmentLines.join('\n')}` : '',
    stickerLines.length > 0 ? `**Stickers:**\n${stickerLines.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

function isUserAuthoredTextMessageType(type: number | undefined): boolean {
  // 0 = Default, 19 = Reply. Both arrive through live messageCreate as text.
  return type === undefined || type === 0 || type === 19;
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    apply: false,
    dryRun: true,
    verbose: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      continue;
    } else if (arg === '--apply') {
      parsed.apply = true;
      parsed.dryRun = false;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--verbose') {
      parsed.verbose = true;
    } else if (arg === '--limit') {
      const value = parsePositiveInt(args[++i], '--limit');
      parsed.limit = value;
    } else if (arg === '--ticket' || arg === '--ticket-number') {
      const value = parsePositiveInt(args[++i], arg);
      parsed.ticketNumber = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.apply && parsed.dryRun) {
    throw new Error('Use either --apply or --dry-run, not both.');
  }

  return parsed;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer.`);
  }
  return parsed;
}

async function loadTickets(database: Database, ticketNumber?: number): Promise<BackfillTicketRow[]> {
  const whereClause = ticketNumber
    ? and(eq(tickets.number, ticketNumber), isNotNull(tickets.discordThreadId))
    : isNotNull(tickets.discordThreadId);

  const rows = await database
    .select({
      id: tickets.id,
      number: tickets.number,
      title: tickets.title,
      createdById: tickets.createdById,
      assignedToId: tickets.assignedToId,
      discordThreadId: tickets.discordThreadId,
      firstResponseAt: tickets.firstResponseAt,
      updatedAt: tickets.updatedAt,
    })
    .from(tickets)
    .where(whereClause)
    .orderBy(asc(tickets.number));

  return rows.filter((row): row is BackfillTicketRow => Boolean(row.discordThreadId));
}

async function loadExistingDiscordMessageIds(
  database: Database,
  ticketIds: string[],
): Promise<Set<string>> {
  if (ticketIds.length === 0) return new Set();

  const rows = await database
    .select({ discordMessageId: ticketMessages.discordMessageId })
    .from(ticketMessages)
    .where(inArray(ticketMessages.ticketId, ticketIds));

  return new Set(rows
    .map((row) => row.discordMessageId)
    .filter((id): id is string => Boolean(id)));
}

async function loadPlayersByDiscordId(
  database: Database,
  discordIds: string[],
): Promise<Map<string, BackfillPlayerRow>> {
  const uniqueIds = [...new Set(discordIds)];
  if (uniqueIds.length === 0) return new Map();

  const rows = await database
    .select({
      id: players.id,
      discordId: players.discordId,
    })
    .from(players)
    .where(inArray(players.discordId, uniqueIds));

  return new Map(rows
    .filter((row): row is BackfillPlayerRow => Boolean(row.discordId))
    .map((row) => [row.discordId, row]));
}

function collectHumanDiscordAuthorIds(
  messagesByThreadId: ReadonlyMap<string, DiscordThreadMessage[]>,
): string[] {
  const ids = new Set<string>();
  for (const messages of messagesByThreadId.values()) {
    for (const message of messages) {
      if (!message.author.bot && formatDiscordThreadMessageContent(message)) {
        ids.add(message.author.id);
      }
    }
  }
  return [...ids];
}

export async function applyBackfillCandidates(
  database: Database,
  candidates: BackfillCandidate[],
): Promise<{ inserted: number; skippedAtWrite: number }> {
  let inserted = 0;
  let skippedAtWrite = 0;
  const firstResponseSet = new Set<string>();
  const ticketUpdatedAt = new Map<string, Date>();

  for (const candidate of candidates) {
    const didInsert = await database.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: ticketMessages.id })
        .from(ticketMessages)
        .where(and(
          eq(ticketMessages.ticketId, candidate.ticketId),
          eq(ticketMessages.discordMessageId, candidate.discordMessageId),
        ))
        .limit(1);
      if (existing) return false;

      const [message] = await tx.insert(ticketMessages).values({
        ticketId: candidate.ticketId,
        authorId: candidate.authorPlayerId,
        content: candidate.content,
        isInternal: candidate.isInternal,
        discordMessageId: candidate.discordMessageId,
        createdAt: candidate.createdAt,
      }).returning();

      await tx.insert(ticketAuditLog).values({
        ticketId: candidate.ticketId,
        actorId: candidate.authorPlayerId,
        action: candidate.isInternal ? 'internal_note' : 'commented',
        newValue: {
          messageId: message.id,
          backfilledFromDiscordMessageId: candidate.discordMessageId,
        },
        createdAt: candidate.createdAt,
      });

      const currentUpdatedAt = ticketUpdatedAt.get(candidate.ticketId)
        ?? candidate.ticket.updatedAt
        ?? candidate.createdAt;
      const nextUpdatedAt = currentUpdatedAt > candidate.createdAt
        ? currentUpdatedAt
        : candidate.createdAt;
      ticketUpdatedAt.set(candidate.ticketId, nextUpdatedAt);

      const updateValues: {
        updatedAt: Date;
        firstResponseAt?: Date;
      } = { updatedAt: nextUpdatedAt };

      if (
        !candidate.ticket.firstResponseAt
        && candidate.authorPlayerId !== candidate.ticket.createdById
        && !candidate.isInternal
        && !firstResponseSet.has(candidate.ticketId)
      ) {
        updateValues.firstResponseAt = candidate.createdAt;
        firstResponseSet.add(candidate.ticketId);
      }

      await tx
        .update(tickets)
        .set(updateValues)
        .where(eq(tickets.id, candidate.ticketId));

      return true;
    });

    if (didInsert) inserted += 1;
    else skippedAtWrite += 1;
  }

  return { inserted, skippedAtWrite };
}

export async function runBackfillTicketThreadMessages(
  options: RunBackfillTicketThreadMessagesOptions = {},
): Promise<BackfillRunResult> {
  const args = parseArgs(options.args ?? process.argv.slice(2));
  const logger = options.logger ?? console;
  const token = options.discordToken
    ?? process.env.DISCORD_BOT_TOKEN
    ?? process.env.TICKET_THREAD_MIRROR_BOT_TOKEN;
  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN or TICKET_THREAD_MIRROR_BOT_TOKEN is required to read ticket thread history.');
  }

  const database = options.database ?? (await loadDefaultDatabase());
  const ticketRows = await loadTickets(database, args.ticketNumber);
  const messagesByThreadId = new Map<string, DiscordThreadMessage[]>();
  let fetchedMessages = 0;
  let fetchFailures = 0;

  for (const ticket of ticketRows) {
    try {
      const messages = await fetchDiscordThreadMessages({
        threadId: ticket.discordThreadId,
        token,
        fetchImpl: options.fetchImpl,
      });
      messagesByThreadId.set(ticket.discordThreadId, messages);
      fetchedMessages += messages.length;
      if (args.verbose) {
        logger.log(`Fetched ${messages.length} Discord message(s) for ticket #${ticket.number}.`);
      }
    } catch (err) {
      fetchFailures += 1;
      logger.error(`Failed to fetch ticket #${ticket.number} thread ${ticket.discordThreadId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const existingDiscordMessageIds = await loadExistingDiscordMessageIds(
    database,
    ticketRows.map((ticket) => ticket.id),
  );
  const playersByDiscordId = await loadPlayersByDiscordId(
    database,
    collectHumanDiscordAuthorIds(messagesByThreadId),
  );
  const selected = selectBackfillCandidates({
    tickets: ticketRows,
    messagesByThreadId,
    existingDiscordMessageIds,
    playersByDiscordId,
  });

  const candidates = args.limit
    ? selected.candidates.slice(0, args.limit)
    : selected.candidates;

  logger.log(`Scanned ${ticketRows.length} ticket thread(s) and fetched ${fetchedMessages} Discord message(s).`);
  logger.log(`Found ${selected.candidates.length} missed ticket repl${selected.candidates.length === 1 ? 'y' : 'ies'} to backfill.`);
  logger.log(
    `Skipped: ${selected.skipped.existing} existing, ${selected.skipped.bot} bot, ${selected.skipped.empty} empty, `
    + `${selected.skipped.unmappedAuthor} unmapped author, ${selected.skipped.unsupportedType} unsupported type, `
    + `${selected.skipped.invalidTimestamp} invalid timestamp.`,
  );

  if (args.limit && selected.candidates.length > candidates.length) {
    logger.log(`Limit active: will process first ${candidates.length} candidate(s).`);
  }

  if (args.dryRun) {
    logger.log('Dry run only. Re-run with --apply to insert these messages.');
    return {
      dryRun: true,
      scannedTickets: ticketRows.length,
      fetchedMessages,
      selected,
      limitedCandidates: candidates.length,
      inserted: 0,
      skippedAtWrite: 0,
      fetchFailures,
    };
  }

  const applied = await applyBackfillCandidates(database, candidates);
  logger.log(`Inserted ${applied.inserted} ticket message(s); skipped ${applied.skippedAtWrite} already-present message(s) at write time.`);

  return {
    dryRun: false,
    scannedTickets: ticketRows.length,
    fetchedMessages,
    selected,
    limitedCandidates: candidates.length,
    inserted: applied.inserted,
    skippedAtWrite: applied.skippedAtWrite,
    fetchFailures,
  };
}

async function loadDefaultDatabase(): Promise<Database> {
  const module = await import('../db.js');
  return module.db;
}

function isDirectRun(): boolean {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isDirectRun()) {
  let database: Database | undefined;
  loadDefaultDatabase()
    .then(async (loaded) => {
      database = loaded;
      const result = await runBackfillTicketThreadMessages({ database });
      if (result.fetchFailures > 0) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (database) await closeDb(database);
    });
}
