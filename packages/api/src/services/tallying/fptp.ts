import type { TallyStrategy, Ballot, BallotVote, ElectionConfig, TallyResult } from './types.js';

/**
 * First Past the Post — highest vote count wins.
 *
 * Each voter picks one candidate. The candidate with the most votes wins
 * outright. In the event of a tie, all tied candidates are listed as winners
 * (the caller decides how to break it — runoff, staff decision, etc.).
 */
export class FPTPStrategy implements TallyStrategy {
  tally(ballots: Ballot[], config: ElectionConfig): TallyResult {
    const tallies: Record<string, number> = {};

    for (const ballot of ballots) {
      if (ballot.vote.type !== 'fptp') continue;
      const { candidateId } = ballot.vote;
      tallies[candidateId] = (tallies[candidateId] ?? 0) + 1;
    }

    const totalVotes = ballots.length;
    const quorumMet = this.checkQuorum(totalVotes, config);
    const maxVotes = Math.max(0, ...Object.values(tallies));
    const winners = Object.entries(tallies)
      .filter(([, count]) => count === maxVotes)
      .map(([candidateId]) => candidateId);

    const result: TallyResult = {
      totalVotes,
      turnout: totalVotes, // caller can compute % from eligible count
      quorumMet,
      finalTallies: tallies,
      winners,
    };

    // Check if a runoff is needed (no one exceeded the threshold)
    if (config.runoffEnabled && this.needsRunoff(result, config)) {
      result.runoffTriggered = true;
    }

    return result;
  }

  validate(ballot: BallotVote, _config: ElectionConfig): boolean {
    return ballot.type === 'fptp' && typeof ballot.candidateId === 'string' && ballot.candidateId.length > 0;
  }

  needsRunoff(result: TallyResult, config: ElectionConfig): boolean {
    if (result.totalVotes === 0) return false;
    const threshold = config.runoffThreshold ?? 0.5;
    const maxVotes = Math.max(0, ...Object.values(result.finalTallies));
    // Runoff needed if no candidate exceeds the threshold
    return maxVotes / result.totalVotes <= threshold;
  }

  private checkQuorum(totalVotes: number, config: ElectionConfig): boolean | undefined {
    if (config.quorumRequired == null) return undefined;
    // For percentage quorum, caller must supply eligible count via quorumRequired as the threshold number
    return totalVotes >= config.quorumRequired;
  }
}
