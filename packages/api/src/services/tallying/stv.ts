import type { TallyStrategy, Ballot, BallotVote, ElectionConfig, TallyResult, ElectionRound } from './types.js';

/**
 * Single Transferable Vote — multi-seat ranked-choice voting.
 *
 * Uses the Droop quota: floor(totalVotes / (seats + 1)) + 1
 *
 * Algorithm:
 * 1. Count first preferences.
 * 2. If a candidate meets/exceeds the quota, they are elected.
 *    Their surplus votes (votes - quota) are transferred to the next
 *    preference on each ballot, weighted proportionally.
 * 3. If no candidate meets the quota, eliminate the candidate with the
 *    fewest votes and transfer their ballots at full value.
 * 4. Repeat until all seats are filled or no candidates remain.
 *
 * This implementation uses the Gregory fractional transfer method for
 * surplus redistribution.
 */
export class STVStrategy implements TallyStrategy {
  tally(ballots: Ballot[], config: ElectionConfig): TallyResult {
    const seats = config.seatsAvailable ?? 1;

    // Build working ballots with transfer weights
    interface WorkingBallot {
      ranking: string[];
      weight: number;
      currentIndex: number; // index into ranking for current top preference
    }

    const workingBallots: WorkingBallot[] = [];
    for (const ballot of ballots) {
      if (ballot.vote.type !== 'ranked') continue;
      workingBallots.push({
        ranking: [...ballot.vote.ranking],
        weight: 1.0,
        currentIndex: 0,
      });
    }

    const totalVotes = workingBallots.length;
    if (totalVotes === 0) {
      return {
        totalVotes: 0,
        turnout: 0,
        finalTallies: {},
        winners: [],
        seatAllocation: {},
      };
    }

    // Droop quota
    const quota = Math.floor(totalVotes / (seats + 1)) + 1;

    const elected = new Set<string>();
    const eliminated = new Set<string>();
    const rounds: ElectionRound[] = [];
    const seatAllocation: Record<string, number> = {};
    let roundNumber = 0;

    const getTopChoice = (b: WorkingBallot): string | null => {
      while (b.currentIndex < b.ranking.length) {
        const candidate = b.ranking[b.currentIndex];
        if (!elected.has(candidate) && !eliminated.has(candidate)) {
          return candidate;
        }
        b.currentIndex++;
      }
      return null; // exhausted
    };

    while (elected.size < seats) {
      roundNumber++;

      // Count weighted votes for each remaining candidate
      const tallies: Record<string, number> = {};
      for (const b of workingBallots) {
        const top = getTopChoice(b);
        if (top) {
          tallies[top] = (tallies[top] ?? 0) + b.weight;
        }
      }

      const remaining = Object.keys(tallies);
      if (remaining.length === 0) break;

      // Record this round (rounded for display)
      const roundTallies: Record<string, number> = {};
      for (const [k, v] of Object.entries(tallies)) {
        roundTallies[k] = Math.round(v * 1000) / 1000;
      }

      // Check if any candidate meets the quota
      const newlyElected: string[] = [];
      for (const [candidateId, count] of Object.entries(tallies)) {
        if (count >= quota) {
          newlyElected.push(candidateId);
        }
      }

      if (newlyElected.length > 0) {
        // Elect candidates who met quota (highest votes first)
        newlyElected.sort((a, b) => (tallies[b] ?? 0) - (tallies[a] ?? 0));

        for (const candidateId of newlyElected) {
          if (elected.size >= seats) break;
          elected.add(candidateId);
          seatAllocation[candidateId] = 1;

          // Transfer surplus using Gregory method
          const surplus = (tallies[candidateId] ?? 0) - quota;
          if (surplus > 0) {
            const transferValue = surplus / (tallies[candidateId] ?? 1);
            for (const b of workingBallots) {
              // Peek by reading directly — do NOT call getTopChoice (mutator).
              if (b.ranking[b.currentIndex] === candidateId) {
                b.weight *= transferValue;
                b.currentIndex++;
              }
            }
          } else {
            // No surplus — mark ballots as used
            for (const b of workingBallots) {
              if (b.ranking[b.currentIndex] === candidateId) {
                b.weight = 0;
                b.currentIndex++;
              }
            }
          }
        }

        rounds.push({ round: roundNumber, tallies: roundTallies });
      } else {
        // No one meets quota — eliminate lowest
        const sorted = remaining.sort((a, b) => (tallies[a] ?? 0) - (tallies[b] ?? 0));
        const eliminatedCandidate = sorted[0];
        eliminated.add(eliminatedCandidate);

        // Transfer eliminated candidate's ballots at their current weight.
        // Peek by reading directly — do NOT call getTopChoice (mutator).
        for (const b of workingBallots) {
          if (b.ranking[b.currentIndex] === eliminatedCandidate) {
            b.currentIndex++; // move to next preference
          }
        }

        rounds.push({
          round: roundNumber,
          tallies: roundTallies,
          eliminated: eliminatedCandidate,
        });
      }

      // If remaining candidates + elected = seats, elect everyone remaining
      const stillRemaining = Object.keys(tallies).filter(
        (c) => !elected.has(c) && !eliminated.has(c),
      );
      if (elected.size + stillRemaining.length <= seats) {
        for (const c of stillRemaining) {
          elected.add(c);
          seatAllocation[c] = 1;
        }
        break;
      }

      // Safety: prevent infinite loops
      if (roundNumber > totalVotes + Object.keys(tallies).length + 10) break;
    }

    // Build final tallies from last round
    const lastRound = rounds[rounds.length - 1];
    const finalTallies = lastRound?.tallies ?? {};

    const quorumMet = this.checkQuorum(totalVotes, config);

    return {
      totalVotes,
      turnout: totalVotes,
      quorumMet,
      rounds,
      finalTallies,
      winners: [...elected],
      seatAllocation,
    };
  }

  validate(ballot: BallotVote, _config: ElectionConfig): boolean {
    if (ballot.type !== 'ranked') return false;
    if (!Array.isArray(ballot.ranking) || ballot.ranking.length === 0) return false;
    const unique = new Set(ballot.ranking);
    return unique.size === ballot.ranking.length;
  }

  private checkQuorum(totalVotes: number, config: ElectionConfig): boolean | undefined {
    if (config.quorumRequired == null) return undefined;
    return totalVotes >= config.quorumRequired;
  }
}
