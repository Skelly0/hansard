import { describe, expect, it } from 'vitest';
import { buildElectionUpdateSet } from './voteService.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

describe('buildElectionUpdateSet', () => {
  it('always stamps updatedAt', () => {
    expect(buildElectionUpdateSet({}, NOW)).toEqual({ updatedAt: NOW });
  });

  it('passes through only allowlisted fields', () => {
    const set = buildElectionUpdateSet(
      { title: 'New', description: 'Blurb', status: 'voting_open', config: { sealedResults: true } },
      NOW,
    );
    expect(set).toEqual({
      updatedAt: NOW,
      title: 'New',
      description: 'Blurb',
      status: 'voting_open',
      config: { sealedResults: true },
    });
  });

  it('drops columns outside the allowlist so a raw body cannot mass-assign', () => {
    const set = buildElectionUpdateSet(
      {
        title: 'Edited',
        id: 'other-uuid',
        createdById: 'victim',
        results: { winners: ['forged'] },
        relatedBillId: 'some-bill',
        type: 'general_election',
      },
      NOW,
    );
    expect(set).toEqual({ updatedAt: NOW, title: 'Edited' });
    expect(set).not.toHaveProperty('id');
    expect(set).not.toHaveProperty('createdById');
    expect(set).not.toHaveProperty('results');
  });

  it('coerces JSON date strings to Date objects', () => {
    const set = buildElectionUpdateSet({ votingClosesAt: '2099-01-01T00:00:00.000Z' }, NOW);
    expect(set.votingClosesAt).toBeInstanceOf(Date);
    expect((set.votingClosesAt as Date).toISOString()).toBe('2099-01-01T00:00:00.000Z');
  });

  it('keeps an existing Date instance as-is', () => {
    const when = new Date('2099-06-01T12:00:00.000Z');
    const set = buildElectionUpdateSet({ votingOpensAt: when }, NOW);
    expect(set.votingOpensAt).toBe(when);
  });

  it('throws on an unparseable date rather than passing a bad value to Drizzle', () => {
    expect(() => buildElectionUpdateSet({ votingClosesAt: 'not-a-date' }, NOW)).toThrow(
      /votingClosesAt/,
    );
  });

  it('omits date fields that were not supplied', () => {
    const set = buildElectionUpdateSet({ title: 'x' }, NOW);
    expect(set).not.toHaveProperty('votingClosesAt');
    expect(set).not.toHaveProperty('votingOpensAt');
  });
});
