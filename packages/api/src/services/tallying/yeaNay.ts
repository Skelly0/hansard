import type { TallyStrategy, Ballot, BallotVote, ElectionConfig, TallyResult } from './types.js';

/**
 * Yea / Nay / Abstain voting with configurable majority types.
 *
 * Supports:
 * - **simple**:       yea > nay (of those who voted yea or nay)
 * - **absolute**:     yea > 50% of ALL eligible voters (quorumRequired = eligible count)
 * - **supermajority**: yea >= passThreshold of (yea + nay) voters
 * - **qualified**:    same as supermajority, uses passThreshold
 * - **unanimous**:    100% yea (no nay votes among those who voted yea/nay)
 */
export class YeaNayStrategy implements TallyStrategy {
  tally(ballots: Ballot[], config: ElectionConfig): TallyResult {
    let yea = 0;
    let nay = 0;
    let abstain = 0;

    for (const ballot of ballots) {
      if (ballot.vote.type !== 'yea_nay_abstain') continue;
      switch (ballot.vote.choice) {
        case 'yea':     yea++;     break;
        case 'nay':     nay++;     break;
        case 'abstain': abstain++; break;
      }
    }

    const totalVotes = yea + nay + abstain;
    const votingVotes = yea + nay; // excluding abstentions for most majority calcs
    const quorumMet = this.checkQuorum(totalVotes, config);

    const passed = this.checkPassed(yea, nay, votingVotes, totalVotes, config);

    const result: TallyResult = {
      totalVotes,
      turnout: totalVotes,
      quorumMet,
      passed,
      finalTallies: { yea, nay, abstain },
      winners: passed ? ['yea'] : ['nay'],
    };

    return result;
  }

  validate(ballot: BallotVote, _config: ElectionConfig): boolean {
    if (ballot.type !== 'yea_nay_abstain') return false;
    return ['yea', 'nay', 'abstain'].includes(ballot.choice);
  }

  private checkPassed(
    yea: number,
    nay: number,
    votingVotes: number,
    totalVotes: number,
    config: ElectionConfig,
  ): boolean {
    const majorityType = config.majorityType ?? 'simple';

    switch (majorityType) {
      case 'simple':
        // Yea > nay (of those who voted yea or nay)
        return yea > nay;

      case 'absolute':
        // Yea > 50% of ALL eligible voters
        // quorumRequired is used as the eligible voter count for absolute majority
        if (config.quorumRequired != null) {
          return yea > config.quorumRequired / 2;
        }
        // Fallback: more than half of all who voted (including abstentions)
        return yea > totalVotes / 2;

      case 'supermajority':
      case 'qualified': {
        // Yea >= passThreshold of voting members (yea + nay)
        const threshold = config.passThreshold ?? 0.667;
        if (votingVotes === 0) return false;
        return yea / votingVotes >= threshold;
      }

      case 'unanimous':
        // 100% yea — no nay votes among those who actually voted yea/nay
        return nay === 0 && yea > 0;

      default:
        return yea > nay;
    }
  }

  private checkQuorum(totalVotes: number, config: ElectionConfig): boolean | undefined {
    if (config.quorumRequired == null) return undefined;
    if (config.quorumType === 'percentage') {
      // quorumRequired is a percentage (0-100), but we need eligible count
      // Since we don't have eligible count here, treat it as absolute
      return totalVotes >= config.quorumRequired;
    }
    return totalVotes >= config.quorumRequired;
  }
}
