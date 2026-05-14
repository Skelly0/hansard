import type { Client } from 'discord.js';
import type { Database } from '@hansard/db';
import { PhoneService, type PhoneCall } from '@hansard/api/services/phoneService';
import { PHONE_RING_WORKER_INTERVAL_MS } from '@hansard/shared';
import { hangUpAndNotify } from '../utils/phoneRelay.js';

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
    logger.error('[phone:worker] failed to mark expired calls:', error);
    return { expired: [] };
  }

  if (options.client && expired.length > 0) {
    await Promise.all(
      expired.map((call) =>
        hangUpAndNotify(options.client!, call.id, 'ring_timeout').catch((err: unknown) => {
          logger.error(`[phone:worker] failed to notify ${call.id}:`, err);
        }),
      ),
    );
  }

  return { expired };
}

/**
 * One-shot startup sweep that ends calls left in `active` after a previous bot crash.
 * Without this, the partial-unique-index slot stays occupied forever and the participants
 * keep typing messages that nobody is consuming.
 */
export async function sweepStrandedActiveCalls(
  db: Database,
  options: { now?: Date; maxAgeMs?: number; client?: Client; logger?: Pick<Console, 'error' | 'log'> } = {},
): Promise<{ ended: PhoneCall[] }> {
  const svc = new PhoneService(db);
  const logger = options.logger ?? console;

  let ended: PhoneCall[] = [];
  try {
    ended = await svc.sweepStrandedActiveCalls({ now: options.now, maxAgeMs: options.maxAgeMs });
  } catch (error) {
    logger.error('[phone:worker] failed to sweep stranded active calls:', error);
    return { ended: [] };
  }

  if (ended.length > 0) {
    logger.log(`[phone:worker] startup swept ${ended.length} stranded active call(s)`);
  }

  if (options.client && ended.length > 0) {
    await Promise.all(
      ended.map((call) =>
        hangUpAndNotify(options.client!, call.id, 'session_reset').catch((err: unknown) => {
          logger.error(`[phone:worker] failed to notify on stranded ${call.id}:`, err);
        }),
      ),
    );
  }
  return { ended };
}

export function startPhoneRingTimeoutWorker(
  db: Database,
  options: PhoneRingWorkerOptions = {},
): NodeJS.Timeout {
  const intervalMs = options.intervalMs ?? PHONE_RING_WORKER_INTERVAL_MS;
  const logger = options.logger ?? console;
  let running = false;

  // One-shot startup sweep for stranded active calls. Runs alongside the interval tick.
  void sweepStrandedActiveCalls(db, { client: options.client, logger });

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { expired } = await expireRingingCalls(db, { client: options.client, logger });
      if (expired.length > 0) {
        logger.log(`[phone:worker] expired ${expired.length} unanswered call(s)`);
      }
    } catch (error) {
      logger.error('[phone:worker] tick failed:', error);
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
