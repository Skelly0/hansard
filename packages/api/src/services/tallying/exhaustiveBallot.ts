import type { TallyStrategy, Ballot, BallotVote, ElectionConfig, TallyResult, ElectionRound } from './types.js';

/**
 * Exhaustive Ballot — multiple rounds of re-voting.
 *
 * Each round, voters pick one candidate. If no candidate has a majority (>50%),
 * the candidate with the fewest votes is eliminated and a NEW vote is held.
 * Unlike ranked choice, voters re-cast their ballot each round (they can
 * change their mind).
 *
 * This strategy handles a SINGLE round. The `needsRunoff()` method signals
 * whether another round is needed. The vote service creates a new child
 * election for each subsequent round.
 */
export class ExhaustiveBallotStrategy implements TallyStrategy {
  tally(ballots: Ballot[], config: ElectionConfig): TallyResult {
    const tallies: Record<string, number> = {};

    for (const ballot of ballots) {
      if (ballot.vote.type !== 'exhaustive') continue;
      const { candidateId } = ballot.vote;
      tallies[candidateId] = (tallies[candidateId] ?? 0) + 1;
    }

    const totalVotes = ballots.length;
    const quorumMet = this.checkQuorum(totalVotes, config);
    const majority = Math.floor(totalVotes / 2) + 1;

    // Sort by votes descending
    const sorted = Object.entries(tallies).sort((a, b) => b[1] - a[1]);

    let winners: string[] | undefined;
    let runoffTriggered = false;
    let eliminated: string | undefined;

    if (sorted.length === 0 || totalVotes === 0) {
      // No votes cast
    } else if (sorted[0][1] >= majority || sorted.length <= 1) {
      // Someone has majority or only one candidate remains
      winners = [sorted[0][0]];
    } else {
      // No majority — eliminate the lowest candidate
      runoffTriggered = true;
      eliminated = sorted[sorted.length - 1][0];

      // If there's a tie at the bottom, eliminate the last one alphabetically
      // (deterministic tiebreaker)
      const minVotes = sorted[sorted.length - 1][1];
      const bottomTied = sorted.filter(([, count]) => count === minVotes);
      if (bottomTied.length > 1) {
        bottomTied.sort((a, b) => a[0].localeCompare(b[0]));
        eliminated = bottomTied[bottomTied.length - 1][0];
      }
    }

    const round: ElectionRound = {
      round: 1, // caller sets actual round number
      tallies,
      eliminated,
    };

    return {
      totalVotes,
      turnout: totalVotes,
      quorumMet,
      rounds: [round],
      finalTallies: tallies,
      winners,
      runoffTriggered,
    };
  }

  validate(ballot: BallotVote, _config: ElectionConfig): boolean {
    return ballot.type === 'exhaustive' && typeof ballot.candidateId === 'string' && ballot.candidateId.length > 0;
  }

  needsRunoff(result: TallyResult, _config: ElectionConfig): boolean {
    if (result.totalVotes === 0) return false;
    const majority = Math.floor(result.totalVotes / 2) + 1;
    const maxVotes = Math.max(0, ...Object.values(result.finalTallies));
    return maxVotes < majority;
  }

  /**
   * Utility: get the eliminated candidate from this round's result.
   */
  static getEliminatedCandidate(result: TallyResult): string | undefined {
    return result.rounds?.[0]?.eliminated;
  }

  private checkQuorum(totalVotes: number, config: ElectionConfig): boolean | undefined {
    if (config.quorumRequired == null) return undefined;
    return totalVotes >= config.quorumRequired;
  }
}
