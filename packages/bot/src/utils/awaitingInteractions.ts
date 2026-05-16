/**
 * Registry of customIds currently being awaited by command-level collectors
 * (`awaitMessageComponent` / `awaitModalSubmit`).
 *
 * The global interaction handler (`events/interactionCreate.ts`) short-circuits
 * on collector-managed customIds to avoid racing the awaiter — see commit
 * 1704822 for the original race fix. But that short-circuit conflates two
 * cases:
 *
 *   1. The awaiter is in flight (must NOT respond — would race the awaiter's
 *      own `deferReply` / `update` and trigger `Unknown interaction` 10062).
 *   2. The awaiter has already timed out / never existed (MUST respond — if
 *      we don't, Discord paints "Something went wrong" on the user's screen
 *      because the modal/button/select got no acknowledgement).
 *
 * This registry distinguishes the two: commands add their customId before
 * `await…` and remove it in `finally`. The global handler treats a
 * collector-managed customId NOT in the set as stale and acks it with a
 * friendly "session expired" message.
 *
 * Timing note: discord.js fires EventEmitter listeners synchronously, so the
 * global handler runs *before* the awaiter's Promise continuation (which
 * defers to a microtask). At that moment the customId is still in the
 * registry, so the global handler bails — and only then does the awaiter
 * unregister via `finally`.
 */
const activeAwaiters = new Set<string>();

export function registerAwaitingInteraction(customId: string): void {
  activeAwaiters.add(customId);
}

export function unregisterAwaitingInteraction(customId: string): void {
  activeAwaiters.delete(customId);
}

export function isAwaitingInteraction(customId: string): boolean {
  return activeAwaiters.has(customId);
}
