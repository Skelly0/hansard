import type { TallyStrategy, Ballot, BallotVote, ElectionConfig, TallyResult } from './types.js';

/**
 * Approval Voting — voters approve of as many candidates as they like.
 *
 * Each voter submits a list of approved candidates. The candidate(s) with the
 * most approvals win. If `seatsAvailable` > 1, the top N candidates win.
 * `maxChoices` limits how many candidates a voter can approve.
 */
export class ApprovalStrategy implements TallyStrategy {
  tally(ballots: Ballot[], config: ElectionConfig): TallyResult {
    const tallies: Record<string, number> = {};

    for (const ballot of ballots) {
      if (ballot.vote.type !== 'approval') continue;
      for (const candidateId of ballot.vote.approved) {
        tallies[candidateId] = (tallies[candidateId] ?? 0) + 1;
      }
    }

    const totalVotes = ballots.length;
    const seats = config.seatsAvailable ?? 1;
    const quorumMet = this.checkQuorum(totalVotes, config);

    // Sort candidates by approval count descending
    const sorted = Object.entries(tallies).sort((a, b) => b[1] - a[1]);

    // Top N candidates win
    const winners: string[] = [];
    if (sorted.length > 0) {
      // Handle ties at the cutoff
      const cutoffVotes = sorted[Math.min(seats - 1, sorted.length - 1)][1];
      for (const [candidateId, count] of sorted) {
        if (count >= cutoffVotes && winners.length < seats) {
          winners.push(candidateId);
        } else if (count >= cutoffVotes) {
          // Tie at the cutoff — include them too (caller breaks tie)
          winners.push(candidateId);
        }
      }
    }

    return {
      totalVotes,
      turnout: totalVotes,
      quorumMet,
      finalTallies: tallies,
      winners,
    };
  }

  validate(ballot: BallotVote, config: ElectionConfig): boolean {
    if (ballot.type !== 'approval') return false;
    if (!Array.isArray(ballot.approved) || ballot.approved.length === 0) return false;
    // Check for duplicates
    const unique = new Set(ballot.approved);
    if (unique.size !== ballot.approved.length) return false;
    // Check maxChoices
    if (config.maxChoices != null && ballot.approved.length > config.maxChoices) return false;
    return true;
  }

  private checkQuorum(totalVotes: number, config: ElectionConfig): boolean | undefined {
    if (config.quorumRequired == null) return undefined;
    return totalVotes >= config.quorumRequired;
  }
}
