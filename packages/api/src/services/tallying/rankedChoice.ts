import type { TallyStrategy, Ballot, BallotVote, ElectionConfig, TallyResult, ElectionRound } from './types.js';

/**
 * Ranked Choice / Instant Runoff Voting.
 *
 * Voters rank candidates in preference order. If no candidate has a majority
 * of first-preference votes, the candidate with the fewest is eliminated and
 * their ballots redistributed to the next preference. Repeat until a candidate
 * has >50% or only one remains.
 *
 * This is single-seat instant runoff. For multi-seat, see STV.
 */
export class RankedChoiceStrategy implements TallyStrategy {
  tally(ballots: Ballot[], config: ElectionConfig): TallyResult {
    // Build working copies of each ballot's ranking
    const activeBallots: string[][] = [];
    for (const ballot of ballots) {
      if (ballot.vote.type !== 'ranked') continue;
      // Clone the ranking so we can mutate during elimination
      activeBallots.push([...ballot.vote.ranking]);
    }

    const totalVotes = activeBallots.length;
    const eliminated = new Set<string>();
    const rounds: ElectionRound[] = [];
    let roundNumber = 0;

    while (true) {
      roundNumber++;

      // Count first-preference votes for remaining candidates
      const tallies: Record<string, number> = {};
      let validBallots = 0;

      for (const ranking of activeBallots) {
        // Find the first non-eliminated candidate on this ballot
        const topChoice = ranking.find((c) => !eliminated.has(c));
        if (topChoice) {
          tallies[topChoice] = (tallies[topChoice] ?? 0) + 1;
          validBallots++;
        }
        // If all choices exhausted, this ballot is dead — doesn't count
      }

      // Check for a winner (>50% of remaining valid ballots)
      const majority = Math.floor(validBallots / 2) + 1;
      const candidates = Object.entries(tallies).sort((a, b) => b[1] - a[1]);

      if (candidates.length === 0) {
        // No valid ballots remain — edge case
        rounds.push({ round: roundNumber, tallies });
        break;
      }

      const [leaderId, leaderVotes] = candidates[0];

      if (leaderVotes >= majority || candidates.length <= 1) {
        // We have a winner
        rounds.push({ round: roundNumber, tallies });
        break;
      }

      // Find the candidate(s) with the lowest votes
      const minVotes = candidates[candidates.length - 1][1];
      // In case of tie at the bottom, eliminate all tied candidates
      // (standard approach — some jurisdictions do random, but that's
      // not deterministic and we want reproducible results)
      const toEliminate = candidates
        .filter(([, count]) => count === minVotes)
        .map(([id]) => id);

      // But if eliminating all tied would leave nobody, just eliminate one
      const remainingAfter = candidates.length - toEliminate.length;
      const eliminatedCandidate = remainingAfter < 1
        ? toEliminate[toEliminate.length - 1] // eliminate the last-listed one
        : toEliminate[0]; // if safe, eliminate one at a time for clarity

      eliminated.add(eliminatedCandidate);
      rounds.push({
        round: roundNumber,
        tallies,
        eliminated: eliminatedCandidate,
      });

      // Safety: if only one (or zero) candidate is still receiving votes, break.
      // Using Object.keys(tallies) avoids picking up already-eliminated
      // candidates from later preferences in activeBallots.flat().
      const stillReceivingVotes = Object.keys(tallies).filter((c) => !eliminated.has(c));
      if (stillReceivingVotes.length <= 1) break;
    }

    // Determine final tallies and winner from last round
    const lastRound = rounds[rounds.length - 1];
    const finalTallies = lastRound?.tallies ?? {};
    const maxVotes = Math.max(0, ...Object.values(finalTallies));
    const winners = Object.entries(finalTallies)
      .filter(([, count]) => count === maxVotes)
      .map(([id]) => id);

    const quorumMet = this.checkQuorum(totalVotes, config);

    return {
      totalVotes,
      turnout: totalVotes,
      quorumMet,
      rounds,
      finalTallies,
      winners,
    };
  }

  validate(ballot: BallotVote, _config: ElectionConfig): boolean {
    if (ballot.type !== 'ranked') return false;
    if (!Array.isArray(ballot.ranking) || ballot.ranking.length === 0) return false;
    // Check for duplicates
    const unique = new Set(ballot.ranking);
    return unique.size === ballot.ranking.length;
  }

  private checkQuorum(totalVotes: number, config: ElectionConfig): boolean | undefined {
    if (config.quorumRequired == null) return undefined;
    return totalVotes >= config.quorumRequired;
  }
}
