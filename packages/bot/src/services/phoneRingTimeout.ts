import type { Client } from 'discord.js';
import type { Database } from '@hansard/db';
import {
  PhoneService,
  type PhoneCall,
  type PhoneMessageTapDelivery,
} from '@hansard/api/services/phoneService';
import {
  PhoneTextService,
  type PhoneTextMessageDelivery,
  type PhoneTextMessageTapDelivery,
} from '@hansard/api/services/phoneTextService';
import { PHONE_RING_WORKER_INTERVAL_MS } from '@hansard/shared';
import { disableRingDmButtons, hangUpAndNotify, sendVoicemailBeep } from '../utils/phoneRelay.js';
import { flushQueuedPhoneTextsForPlayer } from '../utils/phoneTextRelay.js';

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
      expired.map(async (call) => {
        try {
          if (call.status === 'voicemail') {
            await flushQueuedPhoneTextsForPlayer(options.client!, call.recipientPlayerId);
            return;
          }
          await hangUpAndNotify(options.client!, call.id, 'ring_timeout');
        } catch (err: unknown) {
          logger.error(`[phone:worker] failed to notify ${call.id}:`, err);
        }
      }),
    );
  }

  return { expired };
}

export async function processPendingVoicemailBeeps(
  db: Database,
  options: { now?: Date; client?: Client; logger?: Pick<Console, 'error'> } = {},
): Promise<{ processed: PhoneCall[] }> {
  const svc = new PhoneService(db);
  const now = options.now ?? new Date();
  const logger = options.logger ?? console;

  let pending: PhoneCall[] = [];
  try {
    pending = await svc.findPendingVoicemailBeeps();
  } catch (error) {
    logger.error('[phone:worker] failed to load pending voicemail peeps:', error);
    return { processed: [] };
  }

  if (!options.client || pending.length === 0) return { processed: [] };

  await Promise.all(
    pending.map(async (call) => {
      let claimed: PhoneCall | null = null;
      try {
        claimed = await svc.claimVoicemailPeep(call.id, now);
      } catch (err: unknown) {
        logger.error(`[phone:worker] failed to claim voicemail peep ${call.id}:`, err);
        return;
      }
      if (!claimed) return;

      try {
        await sendVoicemailBeep(options.client!, call.id);
      } catch (err: unknown) {
        logger.error(`[phone:worker] failed to send voicemail peep ${call.id}:`, err);
        try {
          await svc.systemEndCall(call.id, 'dm_closed');
          await flushQueuedPhoneTextsForPlayer(options.client!, call.callerPlayerId);
        } catch (innerErr: unknown) {
          logger.error(`[phone:worker] failed to end unreachable voicemail ${call.id}:`, innerErr);
        }
        try {
          await disableRingDmButtons(options.client!, call.id, 'The caller could not be reached via DM.');
        } catch (innerErr: unknown) {
          logger.error(`[phone:worker] failed to disable unreachable voicemail ring buttons ${call.id}:`, innerErr);
        }
        return;
      }

      try {
        await svc.markVoicemailPeeped(call.id, now);
      } catch (err: unknown) {
        logger.error(`[phone:worker] failed to stamp voicemail peep ${call.id}:`, err);
      }

      try {
        await disableRingDmButtons(options.client!, call.id, 'The caller was sent to voicemail.');
      } catch (err: unknown) {
        logger.error(`[phone:worker] failed to disable voicemail ring buttons ${call.id}:`, err);
      }
    }),
  );

  return { processed: pending };
}

export async function sweepClaimedVoicemailBeeps(
  db: Database,
  options: { now?: Date; maxAgeMs?: number; client?: Client; logger?: Pick<Console, 'error' | 'log'> } = {},
): Promise<{ recovered: PhoneCall[] }> {
  const svc = new PhoneService(db);
  const logger = options.logger ?? console;

  let recovered: PhoneCall[] = [];
  try {
    recovered = await svc.sweepClaimedVoicemailBeeps({ now: options.now, maxAgeMs: options.maxAgeMs });
  } catch (error) {
    logger.error('[phone:worker] failed to recover claimed voicemail peeps:', error);
    return { recovered: [] };
  }

  if (options.client && recovered.length > 0) {
    await Promise.all(
      recovered.map((call) =>
        disableRingDmButtons(options.client!, call.id, 'The caller was sent to voicemail.').catch((err: unknown) => {
          logger.error(`[phone:worker] failed to disable recovered voicemail ring buttons ${call.id}:`, err);
        }),
      ),
    );
  }

  return { recovered };
}

export async function sweepAbandonedVoicemails(
  db: Database,
  options: { now?: Date; maxAgeMs?: number; client?: Client; logger?: Pick<Console, 'error' | 'log'> } = {},
): Promise<{ ended: PhoneCall[] }> {
  const svc = new PhoneService(db);
  const logger = options.logger ?? console;

  let ended: PhoneCall[] = [];
  try {
    ended = await svc.sweepAbandonedVoicemails({ now: options.now, maxAgeMs: options.maxAgeMs });
  } catch (error) {
    logger.error('[phone:worker] failed to sweep abandoned voicemails:', error);
    return { ended: [] };
  }

  if (options.client && ended.length > 0) {
    await Promise.all(
      ended.map((call) =>
        hangUpAndNotify(options.client!, call.id, 'voicemail_abandoned').catch((err: unknown) => {
          logger.error(`[phone:worker] failed to notify abandoned voicemail ${call.id}:`, err);
        }),
      ),
    );
  }

  return { ended };
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

/**
 * Mark crash-stranded tap-delivery placeholders with an explicit error. `recordMessage`
 * pre-creates a `phone_message_tap_deliveries` row per active tap; if the relay crashes or
 * throws before completing it, the row stays pending forever. Running this on the worker tick
 * reconciles such rows within one interval rather than letting them linger until a restart.
 */
export async function sweepStaleTapDeliveries(
  db: Database,
  options: { now?: Date; maxAgeMs?: number; logger?: Pick<Console, 'error' | 'log'> } = {},
): Promise<{ swept: PhoneMessageTapDelivery[] }> {
  const svc = new PhoneService(db);
  const logger = options.logger ?? console;

  let swept: PhoneMessageTapDelivery[] = [];
  try {
    swept = await svc.sweepStaleTapDeliveries({ now: options.now, maxAgeMs: options.maxAgeMs });
  } catch (error) {
    logger.error('[phone:worker] failed to sweep stale tap deliveries:', error);
    return { swept: [] };
  }

  if (swept.length > 0) {
    logger.log(`[phone:worker] marked ${swept.length} crash-stranded tap delivery placeholder(s) as failed`);
  }
  return { swept };
}

export async function sweepStalePhoneTextDeliveryClaims(
  db: Database,
  options: { now?: Date; maxAgeMs?: number; logger?: Pick<Console, 'error' | 'log'> } = {},
): Promise<{ swept: PhoneTextMessageDelivery[] }> {
  const svc = new PhoneTextService(db);
  const logger = options.logger ?? console;

  let swept: PhoneTextMessageDelivery[] = [];
  try {
    swept = await svc.sweepStaleDeliveryClaims({ now: options.now, maxAgeMs: options.maxAgeMs });
  } catch (error) {
    logger.error('[phone:worker] failed to sweep stale text delivery claims:', error);
    return { swept: [] };
  }

  if (swept.length > 0) {
    logger.log(`[phone:worker] released ${swept.length} stale text delivery claim(s)`);
  }
  return { swept };
}

export async function sweepStalePhoneTextTapDeliveries(
  db: Database,
  options: { now?: Date; maxAgeMs?: number; logger?: Pick<Console, 'error' | 'log'> } = {},
): Promise<{ swept: PhoneTextMessageTapDelivery[] }> {
  const svc = new PhoneTextService(db);
  const logger = options.logger ?? console;

  let swept: PhoneTextMessageTapDelivery[] = [];
  try {
    swept = await svc.sweepStaleTapDeliveries({ now: options.now, maxAgeMs: options.maxAgeMs });
  } catch (error) {
    logger.error('[phone:worker] failed to sweep stale text tap deliveries:', error);
    return { swept: [] };
  }

  if (swept.length > 0) {
    logger.log(`[phone:worker] marked ${swept.length} crash-stranded text tap delivery placeholder(s) as failed`);
  }
  return { swept };
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
      const now = new Date();
      const { expired } = await expireRingingCalls(db, { now, client: options.client, logger });
      if (expired.length > 0) {
        logger.log(`[phone:worker] expired ${expired.length} unanswered call(s)`);
      }
      const { processed } = await processPendingVoicemailBeeps(db, { now, client: options.client, logger });
      if (processed.length > 0) {
        logger.log(`[phone:worker] processed ${processed.length} pending voicemail peep(s)`);
      }
      const { recovered } = await sweepClaimedVoicemailBeeps(db, { now, client: options.client, logger });
      if (recovered.length > 0) {
        logger.log(`[phone:worker] recovered ${recovered.length} claimed voicemail peep(s)`);
      }
      const { ended } = await sweepAbandonedVoicemails(db, { now, client: options.client, logger });
      if (ended.length > 0) {
        logger.log(`[phone:worker] ended ${ended.length} abandoned voicemail session(s)`);
      }
      // Reconcile any tap-delivery placeholders left pending by a crashed/throwing relay.
      await sweepStaleTapDeliveries(db, { logger });
      await sweepStalePhoneTextDeliveryClaims(db, { now, logger });
      await sweepStalePhoneTextTapDeliveries(db, { now, logger });
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
