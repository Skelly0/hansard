import type { Client } from 'discord.js';
import type { Database } from '@hansard/db';
import { PhoneService, type PhoneCall } from '@hansard/api/services/phoneService';
import { hangUpAndNotify } from '../utils/phoneRelay.js';

const DEFAULT_INTERVAL_MS = 30_000;

export type PhoneRingWorkerOptions = {
  intervalMs?: number;
  runImmediately?: boolean;
  logger?: Pick<Console, 'error' | 'log'>;
  /**
   * Optional client used to notify both parties on timeout. If omitted (e.g. in tests),
   * the worker still marks calls missed but skips the DM/staff thread fan-out.
   */
  client?: Client;
};

export type ExpireResult = { expired: PhoneCall[] };

export async function expireRingingCalls(
  db: Database,
  options: { now?: Date; client?: Client; logger?: Pick<Console, 'error'> } = {},
): Promise<ExpireResult> {
  const svc = new PhoneService(db);
  const now = options.now ?? new Date();
  const logger = options.logger ?? console;

  let expired: PhoneCall[] = [];
  try {
    expired = await svc.expireRingingCalls(now);
  } catch (error) {
    logger.error('[phone-ring-timeout] failed to mark expired calls:', error);
    return { expired: [] };
  }

  if (options.client && expired.length > 0) {
    await Promise.all(
      expired.map((call) =>
        hangUpAndNotify(options.client!, call.id, 'ring_timeout').catch((err: unknown) => {
          logger.error(`[phone-ring-timeout] failed to notify ${call.id}:`, err);
        }),
      ),
    );
  }

  return { expired };
}

export function startPhoneRingTimeoutWorker(
  db: Database,
  options: PhoneRingWorkerOptions = {},
): NodeJS.Timeout {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const logger = options.logger ?? console;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { expired } = await expireRingingCalls(db, { client: options.client, logger });
      if (expired.length > 0) {
        logger.log(`[phone-ring-timeout] expired ${expired.length} unanswered call(s)`);
      }
    } catch (error) {
      logger.error('[phone-ring-timeout] worker tick failed:', error);
    } finally {
      running = false;
    }
  };

  if (options.runImmediately !== false) {
    void tick();
  }

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();
  return timer;
}
