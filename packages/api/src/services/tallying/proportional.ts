import type { TallyStrategy, Ballot, BallotVote, ElectionConfig, TallyResult } from './types.js';

/**
 * Proportional Representation — party-list seat allocation.
 *
 * Supports three methods:
 * - **D'Hondt** (Jefferson method): divides each party's votes by 1, 2, 3, ...
 *   Tends to favour larger parties slightly.
 * - **Sainte-Lague** (Webster method): divides by 1, 3, 5, 7, ...
 *   More proportional for small parties.
 * - **Hare** (Largest Remainder): quota = totalVotes / seats.
 *   Each party gets floor(votes/quota) seats, remaining seats go to
 *   parties with the largest remainders.
 *
 * Voters cast a single vote for a party/candidate (uses FPTP ballot type).
 * `seatsAvailable` determines total seats to allocate.
 */
export class ProportionalStrategy implements TallyStrategy {
  tally(ballots: Ballot[], config: ElectionConfig): TallyResult {
    const tallies: Record<string, number> = {};

    for (const ballot of ballots) {
      if (ballot.vote.type !== 'fptp') continue;
      const { candidateId } = ballot.vote;
      tallies[candidateId] = (tallies[candidateId] ?? 0) + 1;
    }

    const totalVotes = ballots.length;
    const seats = config.seatsAvailable ?? 1;
    const method = config.proportionalMethod ?? 'dhondt';
    const quorumMet = this.checkQuorum(totalVotes, config);

    let seatAllocation: Record<string, number>;

    switch (method) {
      case 'dhondt':
        seatAllocation = this.dHondt(tallies, seats);
        break;
      case 'sainte_lague':
        seatAllocation = this.sainteLague(tallies, seats);
        break;
      case 'hare':
        seatAllocation = this.hare(tallies, seats, totalVotes);
        break;
      default:
        seatAllocation = this.dHondt(tallies, seats);
    }

    // Winners are parties that got at least one seat
    const winners = Object.entries(seatAllocation)
      .filter(([, count]) => count > 0)
      .map(([id]) => id);

    return {
      totalVotes,
      turnout: totalVotes,
      quorumMet,
      finalTallies: tallies,
      winners,
      seatAllocation,
    };
  }

  validate(ballot: BallotVote, _config: ElectionConfig): boolean {
    return ballot.type === 'fptp' && typeof ballot.candidateId === 'string' && ballot.candidateId.length > 0;
  }

  // ----------------------------------------------------------------
  // D'Hondt / Jefferson method
  // ----------------------------------------------------------------
  private dHondt(tallies: Record<string, number>, seats: number): Record<string, number> {
    const allocation: Record<string, number> = {};
    for (const id of Object.keys(tallies)) {
      allocation[id] = 0;
    }

    for (let i = 0; i < seats; i++) {
      let bestId = '';
      let bestQuotient = -1;

      for (const [id, votes] of Object.entries(tallies)) {
        // D'Hondt divisor: seats already won + 1
        const quotient = votes / (allocation[id] + 1);
        if (quotient > bestQuotient) {
          bestQuotient = quotient;
          bestId = id;
        }
      }

      if (bestId) {
        allocation[bestId]++;
      }
    }

    return allocation;
  }

  // ----------------------------------------------------------------
  // Sainte-Lague / Webster method
  // ----------------------------------------------------------------
  private sainteLague(tallies: Record<string, number>, seats: number): Record<string, number> {
    const allocation: Record<string, number> = {};
    for (const id of Object.keys(tallies)) {
      allocation[id] = 0;
    }

    for (let i = 0; i < seats; i++) {
      let bestId = '';
      let bestQuotient = -1;

      for (const [id, votes] of Object.entries(tallies)) {
        // Sainte-Lague divisor: 2 * seats already won + 1 (i.e. 1, 3, 5, 7, ...)
        const divisor = 2 * allocation[id] + 1;
        const quotient = votes / divisor;
        if (quotient > bestQuotient) {
          bestQuotient = quotient;
          bestId = id;
        }
      }

      if (bestId) {
        allocation[bestId]++;
      }
    }

    return allocation;
  }

  // ----------------------------------------------------------------
  // Hare / Largest Remainder method
  // ----------------------------------------------------------------
  private hare(tallies: Record<string, number>, seats: number, totalVotes: number): Record<string, number> {
    const allocation: Record<string, number> = {};
    const quota = totalVotes / seats; // Hare quota

    // First pass: automatic seats (integer part of votes/quota)
    let seatsAllocated = 0;
    const remainders: { id: string; remainder: number }[] = [];

    for (const [id, votes] of Object.entries(tallies)) {
      const autoSeats = Math.floor(votes / quota);
      allocation[id] = autoSeats;
      seatsAllocated += autoSeats;
      remainders.push({
        id,
        remainder: votes / quota - autoSeats,
      });
    }

    // Second pass: distribute remaining seats to largest remainders
    remainders.sort((a, b) => b.remainder - a.remainder);
    let remaining = seats - seatsAllocated;

    for (const entry of remainders) {
      if (remaining <= 0) break;
      allocation[entry.id]++;
      remaining--;
    }

    return allocation;
  }

  private checkQuorum(totalVotes: number, config: ElectionConfig): boolean | undefined {
    if (config.quorumRequired == null) return undefined;
    return totalVotes >= config.quorumRequired;
  }
}
