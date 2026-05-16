/**
 * Strategy registry — maps VotingMethod to the concrete TallyStrategy.
 */
import type { VotingMethod } from '@hansard/shared';
import type { TallyStrategy } from './types.js';

import { FPTPStrategy } from './fptp.js';
import { YeaNayStrategy } from './yeaNay.js';
import { RankedChoiceStrategy } from './rankedChoice.js';
import { ApprovalStrategy } from './approval.js';
import { TwoRoundRunoffStrategy } from './twoRoundRunoff.js';
import { ExhaustiveBallotStrategy } from './exhaustiveBallot.js';
import { STVStrategy } from './stv.js';
import { ProportionalStrategy } from './proportional.js';

const strategies: Record<VotingMethod, TallyStrategy> = {
  fptp: new FPTPStrategy(),
  ranked_choice: new RankedChoiceStrategy(),
  stv: new STVStrategy(),
  approval: new ApprovalStrategy(),
  proportional: new ProportionalStrategy(),
  yea_nay_abstain: new YeaNayStrategy(),
  two_round_runoff: new TwoRoundRunoffStrategy(),
  exhaustive_ballot: new ExhaustiveBallotStrategy(),
};

/**
 * Get the tallying strategy for a given voting method.
 * Throws if the method is not recognised.
 */
export function getStrategy(method: VotingMethod): TallyStrategy {
  const strategy = strategies[method];
  if (!strategy) {
    throw new Error(`Unknown voting method: ${method}`);
  }
  return strategy;
}

export { strategies };
export * from './types.js';

// Re-export strategies for direct access
export { FPTPStrategy } from './fptp.js';
export { YeaNayStrategy } from './yeaNay.js';
export { RankedChoiceStrategy } from './rankedChoice.js';
export { ApprovalStrategy } from './approval.js';
export { TwoRoundRunoffStrategy } from './twoRoundRunoff.js';
export { ExhaustiveBallotStrategy } from './exhaustiveBallot.js';
export { STVStrategy } from './stv.js';
export { ProportionalStrategy } from './proportional.js';
