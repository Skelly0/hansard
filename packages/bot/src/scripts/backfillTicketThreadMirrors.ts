import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import {
  closeDb,
  players,
  ticketMessages,
  tickets,
  type Database,
} from '@hansard/db';
import { splitForDiscord } from '@hansard/api/services/ticketThreadNotifier';
import {
  fetchDiscordThreadMessages,
  type DiscordThreadMessage,
} from './backfillTicketThreadMessages.js';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_RETRY_BUFFER_MS = 250;
const DISCORD_MAX_ATTEMPTS = 5;
const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '../../../../.env') });
loadDotenv();

export interface MirrorTicketRow {
  id: string;
  number: number;
  title: string;
  description: string;
  createdAt: Date;
  discordThreadId: string;
}

export interface MirrorAuthorRow {
  id: string;
  characterName: string | null;
  discordUsername: string;
}

export interface MirrorDbMessage {
  id: string;
  ticketId: string;
  content: string;
  isInternal: boolean;
  discordMessageId: string | null;
  createdAt: Date;
  author: MirrorAuthorRow;
}

export interface MissingThreadMirrorCandidate {
  ticket: MirrorTicketRow;
  messageId: string;
  content: string;
  createdAt: Date;
  expectedContent: string;
}

export interface MissingThreadMirrorSkipped {
  alreadyMirrored: number;
  empty: number;
  openingMessage: number;
  threadOrigin: number;
}

export interface MissingThreadMirrorSelection {
  candidates: MissingThreadMirrorCandidate[];
  skipped: MissingThreadMirrorSkipped;
}

interface ParsedArgs {
  apply: boolean;
  dryRun: boolean;
  limit?: number;
  ticketNumber?: number;
  verbose: boolean;
}

interface RunBackfillTicketThreadMirrorsOptions {
  args?: string[];
  database?: Database;
  discordToken?: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export interface DiscordThreadSendResult {
  postedChunks: number;
  archiveRestoreFailed: boolean;
}

class DiscordSendError extends Error {
  constructor(
    readonly threadId: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(`Discord send failed for thread ${threadId}: ${status} ${responseBody.slice(0, 160)}`);
  }
}

export function formatTicketThreadMirrorContent(options: {
  author: MirrorAuthorRow;
  content: string;
  isInternal: boolean;
}): string {
  const authorName = options.author.characterName || options.author.discordUsername || 'Unknown';
  const prefix = options.isInternal
    ? `🔒 **${authorName}** (internal note):`
    : `💬 **${authorName}** replied:`;
  return `${prefix}\n${options.content}`;
}

export function selectMissingThreadMirrors(options: {
  ticket: MirrorTicketRow;
  dbMessages: MirrorDbMessage[];
  discordMessages: DiscordThreadMessage[];
}): MissingThreadMirrorSelection {
  const skipped: MissingThreadMirrorSkipped = {
    alreadyMirrored: 0,
    empty: 0,
    openingMessage: 0,
    threadOrigin: 0,
  };
  const discordContentCounts = new Map<string, number>();
  for (const message of options.discordMessages) {
    incrementCount(discordContentCounts, normalizeMirroredContent(message.content));
  }
  const candidates: MissingThreadMirrorCandidate[] = [];

  for (const message of options.dbMessages) {
    if (message.discordMessageId) {
      skipped.threadOrigin += 1;
      continue;
    }
    if (isOpeningMessage(options.ticket, message)) {
      skipped.openingMessage += 1;
      continue;
    }
    if (!message.content.trim()) {
      skipped.empty += 1;
      continue;
    }

    const expectedContent = formatTicketThreadMirrorContent({
      author: message.author,
      content: message.content,
      isInternal: message.isInternal,
    });
    const chunks = splitForDiscord(expectedContent);
    const alreadyMirrored = consumeMirroredChunks(discordContentCounts, chunks);
    if (alreadyMirrored) {
      skipped.alreadyMirrored += 1;
      continue;
    }

    candidates.push({
      ticket: options.ticket,
      messageId: message.id,
      content: message.content,
      createdAt: message.createdAt,
      expectedContent,
    });
  }

  candidates.sort((a, b) => (
    a.createdAt.getTime() - b.createdAt.getTime()
    || a.messageId.localeCompare(b.messageId)
  ));

  return { candidates, skipped };
}

function isOpeningMessage(ticket: MirrorTicketRow, message: MirrorDbMessage): boolean {
  const sameContent = message.content === ticket.description;
  const closeToTicketCreation = Math.abs(message.createdAt.getTime() - ticket.createdAt.getTime()) < 10_000;
  return sameContent && closeToTicketCreation;
}

function normalizeMirroredContent(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trimEnd();
}

function consumeMirroredChunks(contentCounts: Map<string, number>, chunks: string[]): boolean {
  const needed = new Map<string, number>();
  for (const chunk of chunks) {
    incrementCount(needed, normalizeMirroredContent(chunk));
  }

  for (const [content, count] of needed) {
    if ((contentCounts.get(content) ?? 0) < count) return false;
  }

  for (const [content, count] of needed) {
    const remaining = (contentCounts.get(content) ?? 0) - count;
    if (remaining > 0) contentCounts.set(content, remaining);
    else contentCounts.delete(content);
  }

  return true;
}

function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
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
      parsed.limit = parsePositiveInt(args[++i], '--limit');
    } else if (arg === '--ticket' || arg === '--ticket-number') {
      parsed.ticketNumber = parsePositiveInt(args[++i], arg);
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

async function loadTickets(database: Database, ticketNumber?: number): Promise<MirrorTicketRow[]> {
  const whereClause = ticketNumber
    ? and(eq(tickets.number, ticketNumber), isNotNull(tickets.discordThreadId))
    : isNotNull(tickets.discordThreadId);

  const rows = await database
    .select({
      id: tickets.id,
      number: tickets.number,
      title: tickets.title,
      description: tickets.description,
      createdAt: tickets.createdAt,
      discordThreadId: tickets.discordThreadId,
    })
    .from(tickets)
    .where(whereClause)
    .orderBy(asc(tickets.number));

  return rows.filter((row): row is MirrorTicketRow => Boolean(row.discordThreadId));
}

async function loadTicketMessages(database: Database, ticketId: string): Promise<MirrorDbMessage[]> {
  const rows = await database
    .select({
      id: ticketMessages.id,
      ticketId: ticketMessages.ticketId,
      content: ticketMessages.content,
      isInternal: ticketMessages.isInternal,
      discordMessageId: ticketMessages.discordMessageId,
      createdAt: ticketMessages.createdAt,
      authorId: players.id,
      characterName: players.characterName,
      discordUsername: players.discordUsername,
    })
    .from(ticketMessages)
    .innerJoin(players, eq(ticketMessages.authorId, players.id))
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(asc(ticketMessages.createdAt));

  return rows.map((row) => ({
    id: row.id,
    ticketId: row.ticketId,
    content: row.content,
    isInternal: row.isInternal,
    discordMessageId: row.discordMessageId,
    createdAt: row.createdAt,
    author: {
      id: row.authorId,
      characterName: row.characterName,
      discordUsername: row.discordUsername,
    },
  }));
}

export async function sendDiscordThreadMessage(options: {
  threadId: string;
  token: string;
  content: string;
  fetchImpl?: typeof fetch;
}): Promise<DiscordThreadSendResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let restoreArchived = false;
  const result: DiscordThreadSendResult = {
    postedChunks: 0,
    archiveRestoreFailed: false,
  };

  try {
    for (const chunk of splitForDiscord(options.content)) {
      try {
        await postDiscordThreadMessage({
          threadId: options.threadId,
          token: options.token,
          content: chunk,
          fetchImpl,
        });
        result.postedChunks += 1;
      } catch (err) {
        if (err instanceof DiscordSendError && err.status === 403 && !restoreArchived) {
          const unarchived = await unarchiveThreadIfArchived({
            threadId: options.threadId,
            token: options.token,
            fetchImpl,
          });
          if (unarchived) {
            restoreArchived = true;
            await postDiscordThreadMessage({
              threadId: options.threadId,
              token: options.token,
              content: chunk,
              fetchImpl,
            });
            result.postedChunks += 1;
            continue;
          }
        }
        throw err;
      }
    }
  } finally {
    if (restoreArchived) {
      try {
        await setDiscordThreadArchived({
          threadId: options.threadId,
          token: options.token,
          archived: true,
          fetchImpl,
        });
      } catch {
        result.archiveRestoreFailed = true;
      }
    }
  }

  return result;
}

async function postDiscordThreadMessage(options: {
  threadId: string;
  token: string;
  content: string;
  fetchImpl: typeof fetch;
}): Promise<void> {
  const response = await fetchDiscordWithRetry(options.fetchImpl, `${DISCORD_API_BASE}/channels/${options.threadId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${options.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: options.content,
      allowed_mentions: { parse: [] },
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new DiscordSendError(options.threadId, response.status, body);
  }
}

async function unarchiveThreadIfArchived(options: {
  threadId: string;
  token: string;
  fetchImpl: typeof fetch;
}): Promise<boolean> {
  const response = await fetchDiscordWithRetry(options.fetchImpl, `${DISCORD_API_BASE}/channels/${options.threadId}`, {
    headers: { Authorization: `Bot ${options.token}` },
  });
  if (!response.ok) return false;
  const channel = await response.json().catch(() => null) as { thread_metadata?: { archived?: boolean } } | null;
  if (channel?.thread_metadata?.archived !== true) return false;

  await setDiscordThreadArchived({
    threadId: options.threadId,
    token: options.token,
    archived: false,
    fetchImpl: options.fetchImpl,
  });
  return true;
}

async function setDiscordThreadArchived(options: {
  threadId: string;
  token: string;
  archived: boolean;
  fetchImpl: typeof fetch;
}): Promise<void> {
  const response = await fetchDiscordWithRetry(options.fetchImpl, `${DISCORD_API_BASE}/channels/${options.threadId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bot ${options.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ archived: options.archived }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Discord thread archive update failed for ${options.threadId}: ${response.status} ${body.slice(0, 160)}`);
  }
}

async function fetchDiscordWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let lastRateLimitBody = '';

  for (let attempt = 1; attempt <= DISCORD_MAX_ATTEMPTS; attempt += 1) {
    const response = await fetchImpl(url, init);
    if (response.status !== 429) return response;

    lastRateLimitBody = await response.text().catch(() => '');
    if (attempt === DISCORD_MAX_ATTEMPTS) {
      return new Response(lastRateLimitBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    await sleep(getRetryAfterMs(lastRateLimitBody, response.headers.get('retry-after')));
  }

  return new Response(lastRateLimitBody, { status: 429 });
}

function getRetryAfterMs(body: string, retryAfterHeader: string | null): number {
  const fromHeader = retryAfterHeader ? Number.parseFloat(retryAfterHeader) : Number.NaN;
  if (Number.isFinite(fromHeader) && fromHeader >= 0) {
    return Math.ceil(fromHeader * 1000) + DISCORD_RETRY_BUFFER_MS;
  }

  const parsed = parseRateLimitBody(body);
  const retryAfter = typeof parsed.retry_after === 'number' ? parsed.retry_after : Number.NaN;
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.ceil(retryAfter * 1000) + DISCORD_RETRY_BUFFER_MS;
  }

  return 1_000;
}

function parseRateLimitBody(body: string): { retry_after?: unknown } {
  if (!body) return {};
  try {
    return JSON.parse(body) as { retry_after?: unknown };
  } catch {
    return {};
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

export async function runBackfillTicketThreadMirrors(
  options: RunBackfillTicketThreadMirrorsOptions = {},
): Promise<{
  candidates: MissingThreadMirrorCandidate[];
  inserted: number;
  failed: number;
  archiveRestoreFailed: number;
}> {
  const args = parseArgs(options.args ?? process.argv.slice(2));
  const logger = options.logger ?? console;
  const token = options.discordToken
    ?? process.env.TICKET_THREAD_MIRROR_BOT_TOKEN
    ?? process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN or TICKET_THREAD_MIRROR_BOT_TOKEN is required to write ticket thread mirrors.');
  }

  const database = options.database ?? (await loadDefaultDatabase());
  const ticketRows = await loadTickets(database, args.ticketNumber);
  const allCandidates: MissingThreadMirrorCandidate[] = [];
  const totals: MissingThreadMirrorSkipped = {
    alreadyMirrored: 0,
    empty: 0,
    openingMessage: 0,
    threadOrigin: 0,
  };

  for (const ticket of ticketRows) {
    const [dbMessages, discordMessages] = await Promise.all([
      loadTicketMessages(database, ticket.id),
      fetchDiscordThreadMessages({
        threadId: ticket.discordThreadId,
        token,
        fetchImpl: options.fetchImpl,
      }),
    ]);
    const selection = selectMissingThreadMirrors({ ticket, dbMessages, discordMessages });
    allCandidates.push(...selection.candidates);
    totals.alreadyMirrored += selection.skipped.alreadyMirrored;
    totals.empty += selection.skipped.empty;
    totals.openingMessage += selection.skipped.openingMessage;
    totals.threadOrigin += selection.skipped.threadOrigin;
    if (args.verbose) {
      logger.log(`Ticket #${ticket.number}: ${selection.candidates.length} missing mirror(s), ${discordMessages.length} Discord message(s).`);
    }
  }

  const candidates = args.limit ? allCandidates.slice(0, args.limit) : allCandidates;

  logger.log(`Scanned ${ticketRows.length} ticket thread(s).`);
  logger.log(`Found ${allCandidates.length} saved ticket message(s) missing from staff threads.`);
  logger.log(`Skipped: ${totals.alreadyMirrored} already mirrored, ${totals.openingMessage} opener, ${totals.threadOrigin} thread-origin, ${totals.empty} empty.`);
  if (args.limit && allCandidates.length > candidates.length) {
    logger.log(`Limit active: will process first ${candidates.length} candidate(s).`);
  }
  if (args.verbose) {
    for (const candidate of candidates) {
      logger.log(`- Ticket #${candidate.ticket.number} ${candidate.messageId} at ${candidate.createdAt.toISOString()}: ${candidate.content.slice(0, 100).replace(/\n/g, '\\n')}`);
    }
  }

  if (args.dryRun) {
    logger.log('Dry run only. Re-run with --apply to post these mirrors.');
    return { candidates, inserted: 0, failed: 0, archiveRestoreFailed: 0 };
  }

  let inserted = 0;
  let failed = 0;
  let archiveRestoreFailed = 0;
  for (const candidate of candidates) {
    try {
      const result = await sendDiscordThreadMessage({
        threadId: candidate.ticket.discordThreadId,
        token,
        content: candidate.expectedContent,
        fetchImpl: options.fetchImpl,
      });
      inserted += 1;
      if (result.archiveRestoreFailed) {
        archiveRestoreFailed += 1;
        logger.warn(`Mirrored ticket #${candidate.ticket.number} message ${candidate.messageId}, but failed to re-archive thread ${candidate.ticket.discordThreadId}.`);
      }
    } catch (err) {
      failed += 1;
      logger.error(`Failed to mirror ticket #${candidate.ticket.number} message ${candidate.messageId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  logger.log(`Posted ${inserted} mirror message(s); ${failed} failed; ${archiveRestoreFailed} archive restore warning(s).`);
  return { candidates, inserted, failed, archiveRestoreFailed };
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
      const result = await runBackfillTicketThreadMirrors({ database });
      if (result.failed > 0) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (database) await closeDb(database);
    });
}
