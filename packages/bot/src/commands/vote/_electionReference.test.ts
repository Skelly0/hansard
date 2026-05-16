import { describe, expect, it } from 'vitest';
import {
  describeElectionReference,
  getDefaultVoteInterface,
  getRequestedVoteInterface,
} from './_electionReference.js';

describe('describeElectionReference', () => {
  it('treats a full UUID as an election id reference', () => {
    expect(describeElectionReference('6232c1cf-f24c-4cc2-b1ce-6ccc71ab7c71')).toEqual({
      kind: 'id',
      value: '6232c1cf-f24c-4cc2-b1ce-6ccc71ab7c71',
    });
  });

  it('treats an 8 character hex value from vote-list as an id prefix', () => {
    expect(describeElectionReference('6232c1cf')).toEqual({
      kind: 'id-prefix',
      value: '6232c1cf',
    });
  });

  it('trims and keeps ordinary titles as title references', () => {
    expect(describeElectionReference('  Land Reform Act  ')).toEqual({
      kind: 'title',
      value: 'Land Reform Act',
    });
  });
});

describe('vote interface defaults', () => {
  it('defaults reaction-compatible voting methods to Discord reactions', () => {
    expect(getDefaultVoteInterface('yea_nay_abstain')).toBe('reactions');
    expect(getDefaultVoteInterface('fptp')).toBe('reactions');
  });

  it('falls back to buttons for methods that cannot be represented as reactions', () => {
    expect(getDefaultVoteInterface('ranked_choice')).toBe('buttons');
    expect(getDefaultVoteInterface('approval')).toBe('buttons');
  });

  it('honors an explicit interface override', () => {
    expect(getRequestedVoteInterface('buttons', 'fptp')).toBe('buttons');
    expect(getRequestedVoteInterface('reactions', 'yea_nay_abstain')).toBe('reactions');
  });
});
