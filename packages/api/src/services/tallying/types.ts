/**
 * Shared types for the vote tallying subsystem.
 *
 * Re-exports the canonical types from @hansard/shared and adds
 * any API-internal helpers needed by the strategy implementations.
 */
export type {
  TallyResult,
  TallyStrategy,
  Ballot,
  BallotVote,
  ElectionConfig,
  ElectionRound,
} from '@hansard/shared';
