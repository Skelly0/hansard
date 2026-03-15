import type { TallyStrategy, Ballot, BallotVote, ElectionConfig, TallyResult } from './types.js';

/**
 * Two-Round Runoff system.
 *
 * Round 1: voters pick one candidate (FPTP-style). If any candidate exceeds
 * `runoffThreshold` (default 50%), they win outright. Otherwise, the top 2
 * candidates proceed to a new election (second round).
 *
 * This strategy handles a SINGLE round at a time. The `needsRunoff()` method
 * signals whether a second-round election must be created. The second round
 * also uses this strategy but with only the top-2 candidates registered.
 */
export class TwoRoundRunoffStrategy implements TallyStrategy {
  tally(ballots: Ballot[], config: ElectionConfig): TallyResult {
    const tallies: Record<string, number> = {};

    for (const ballot of ballots) {
      if (ballot.vote.type !== 'two_round') continue;
      const { candidateId } = ballot.vote;
      tallies[candidateId] = (tallies[candidateId] ?? 0) + 1;
    }

    const totalVotes = ballots.length;
    const quorumMet = this.checkQuorum(totalVotes, config);
    const threshold = config.runoffThreshold ?? 0.5;

    // Sort by votes descending
    const sorted = Object.entries(tallies).sort((a, b) => b[1] - a[1]);

    let winners: string[] | undefined;
    let runoffTriggered = false;

    if (sorted.length > 0 && totalVotes > 0) {
      const [leaderId, leaderVotes] = sorted[0];
      if (leaderVotes / totalVotes > threshold) {
        // Outright winner — exceeded threshold
        winners = [leaderId];
      } else {
        // No outright winner — top 2 go to runoff
        runoffTriggered = true;
        // The top 2 (or more in case of tie) become the runoff candidates
        winners = sorted.slice(0, 2).map(([id]) => id);
      }
    }

    return {
      totalVotes,
      turnout: totalVotes,
      quorumMet,
      finalTallies: tallies,
      winners: runoffTriggered ? undefined : winners,
      runoffTriggered,
    };
  }

  validate(ballot: BallotVote, _config: ElectionConfig): boolean {
    return ballot.type === 'two_round' && typeof ballot.candidateId === 'string' && ballot.candidateId.length > 0;
  }

  needsRunoff(result: TallyResult, config: ElectionConfig): boolean {
    if (result.totalVotes === 0) return false;
    const threshold = config.runoffThreshold ?? 0.5;
    const maxVotes = Math.max(0, ...Object.values(result.finalTallies));
    return maxVotes / result.totalVotes <= threshold;
  }

  /**
   * Utility: extract the top 2 candidate IDs from a first-round result,
   * used by the vote service to create the runoff election.
   */
  static getRunoffCandidates(result: TallyResult): string[] {
    const sorted = Object.entries(result.finalTallies).sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, 2).map(([id]) => id);
  }

  private checkQuorum(totalVotes: number, config: ElectionConfig): boolean | undefined {
    if (config.quorumRequired == null) return undefined;
    return totalVotes >= config.quorumRequired;
  }
}
