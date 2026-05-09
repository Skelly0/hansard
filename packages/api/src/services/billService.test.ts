import { describe, expect, it, vi } from 'vitest';
import { getVoters } from './billService';

describe('getVoters', () => {
  function makeMockDb(billRows: any[], ballotRows: any[]) {
    const billLimit = vi.fn().mockResolvedValue(billRows);
    const billWhere = vi.fn().mockReturnValue({ limit: billLimit });
    const billFrom = vi.fn().mockReturnValue({ where: billWhere });

    const orderBy = vi.fn().mockResolvedValue(ballotRows);
    const ballotWhere = vi.fn().mockReturnValue({ orderBy });
    const innerJoin = vi.fn().mockReturnValue({ where: ballotWhere });
    const ballotFrom = vi.fn().mockReturnValue({ innerJoin });

    const select = vi.fn()
      .mockReturnValueOnce({ from: billFrom })
      .mockReturnValueOnce({ from: ballotFrom });

    return { select, billFrom, ballotFrom, innerJoin };
  }

  it('returns player ids and display names for bill player votes', async () => {
    const db: any = makeMockDb(
      [{ id: 'bill-1', playerVoteId: 'election-1', npcVote: null }],
      [{
        ballot: {
          voterId: 'player-1',
          vote: { type: 'yea_nay_abstain', choice: 'yea' },
          castAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        characterName: 'Ada Vance',
        discordUsername: 'ada',
      }],
    );

    const result = await getVoters(db, 'bill-slug');

    expect(result?.playerVotes).toEqual([{
      voterId: 'player-1',
      playerId: 'player-1',
      characterName: 'Ada Vance',
      choice: 'yea',
      castAt: '2026-01-01T00:00:00.000Z',
    }]);
    expect(db.innerJoin).toHaveBeenCalled();
  });

  it('falls back to Discord username when the character name is missing', async () => {
    const db: any = makeMockDb(
      [{ id: 'bill-1', playerVoteId: 'election-1', npcVote: null }],
      [{
        ballot: {
          voterId: 'player-1',
          vote: { type: 'yea_nay_abstain', choice: 'abstain' },
          castAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        characterName: null,
        discordUsername: 'ada',
      }],
    );

    const result = await getVoters(db, 'bill-slug');

    expect(result?.playerVotes[0]?.characterName).toBe('ada');
  });
});
