import { describe, expect, it } from 'vitest';
import { sanitizeElectionUpdate } from './voting.js';

describe('sanitizeElectionUpdate', () => {
  it('passes the body through untouched for staff', () => {
    const body = { title: 'New', status: 'certified', config: { sealedResults: true } };
    expect(sanitizeElectionUpdate(body, true)).toBe(body);
  });

  it('narrows a non-staff creator to benign metadata only', () => {
    const body = {
      title: 'Renamed',
      description: 'Updated blurb',
      status: 'voting_open',
      config: { sealedResults: false },
      votingClosesAt: new Date('2099-01-01'),
      discordMessageId: 'spoofed',
    };
    expect(sanitizeElectionUpdate(body, false)).toEqual({
      title: 'Renamed',
      description: 'Updated blurb',
    });
  });

  it('drops a non-staff attempt to self-certify with no benign fields', () => {
    expect(sanitizeElectionUpdate({ status: 'certified' }, false)).toEqual({});
  });

  it('omits undefined benign fields rather than writing them as undefined', () => {
    expect(sanitizeElectionUpdate({ title: 'Only title' }, false)).toEqual({ title: 'Only title' });
  });
});
