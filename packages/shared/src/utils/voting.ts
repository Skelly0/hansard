import {
  LEGACY_SUPERMAJORITY_PASS_THRESHOLD,
  SUPERMAJORITY_PASS_THRESHOLD,
} from '../constants/config.js';

const THRESHOLD_EPSILON = 1e-9;
const LEGACY_SUPERMAJORITY_EPSILON = 0.0005;

export function normalizePassThreshold(threshold: number): number {
  if (Math.abs(threshold - LEGACY_SUPERMAJORITY_PASS_THRESHOLD) <= LEGACY_SUPERMAJORITY_EPSILON) {
    return SUPERMAJORITY_PASS_THRESHOLD;
  }

  return threshold;
}

export function meetsVoteThreshold(
  affirmativeVotes: number,
  countedVotes: number,
  threshold: number,
): boolean {
  if (countedVotes <= 0) return false;

  const normalizedThreshold = normalizePassThreshold(threshold);
  return affirmativeVotes / countedVotes + THRESHOLD_EPSILON >= normalizedThreshold;
}

export function hasVotingCloseTimePassed(
  votingClosesAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!votingClosesAt) return false;

  const closeTime = votingClosesAt instanceof Date
    ? votingClosesAt.getTime()
    : new Date(votingClosesAt).getTime();

  return Number.isFinite(closeTime) && closeTime <= now.getTime();
}
