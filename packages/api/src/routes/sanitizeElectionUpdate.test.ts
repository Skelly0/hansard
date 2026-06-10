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

  // A PATCH can arrive with no/odd Content-Type, so request.body may be
  // null/undefined/array/primitive. The old loop dereferenced body[field] and
  // crashed (500); now any non-object body collapses to {} for both roles.
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an array', ['title', 'x']],
    ['a string', 'certified'],
    ['a number', 42],
  ])('returns {} for a non-object body (%s) without throwing', (_label, body) => {
    expect(sanitizeElectionUpdate(body as unknown, false)).toEqual({});
    expect(sanitizeElectionUpdate(body as unknown, true)).toEqual({});
  });

  it('keeps a null title for the route to reject rather than dropping it', () => {
    // null !== undefined, so it survives sanitisation; the route validates that
    // title is a non-empty string and 400s before it can hit the NOT NULL column.
    expect(sanitizeElectionUpdate({ title: null }, false)).toEqual({ title: null });
  });
});
