import { describe, expect, it } from 'vitest';
import type { Ballot, ElectionConfig } from './types.js';
import { YeaNayStrategy } from './yeaNay.js';

function ballot(index: number, choice: 'yea' | 'nay' | 'abstain'): Ballot {
  return {
    id: `ballot-${index}`,
    electionId: 'election-1',
    voterId: `voter-${index}`,
    vote: { type: 'yea_nay_abstain', choice },
    castAt: '2026-01-01T00:00:00.000Z',
  };
}

function tally(choices: Array<'yea' | 'nay' | 'abstain'>, config: ElectionConfig) {
  return new YeaNayStrategy().tally(
    choices.map((choice, index) => ballot(index, choice)),
    config,
  );
}

describe('YeaNayStrategy supermajority', () => {
  it('passes at exactly two-thirds of yea and nay votes, excluding abstentions', () => {
    const result = tally(
      ['yea', 'yea', 'nay', 'abstain', 'abstain'],
      { majorityType: 'supermajority' },
    );

    expect(result.passed).toBe(true);
    expect(result.finalTallies).toEqual({ yea: 2, nay: 1, abstain: 2 });
  });

  it('treats legacy rounded 0.667 configs as exact two-thirds', () => {
    const result = tally(
      ['yea', 'yea', 'nay'],
      { majorityType: 'supermajority', passThreshold: 0.667 },
    );

    expect(result.passed).toBe(true);
  });
});
