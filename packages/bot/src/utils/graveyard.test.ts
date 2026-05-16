import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateObituary: vi.fn(),
}));

vi.mock('@hansard/api/services/simulationService', () => ({
  generateObituary: mocks.generateObituary,
}));

import {
  DEFAULT_GRAVEYARD_CHANNEL_ID,
  getGraveyardChannelId,
  postObituaryToGraveyard,
} from './graveyard.js';

describe('graveyard obituary posting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GRAVEYARD_CHANNEL_ID;
    mocks.generateObituary.mockResolvedValue({
      characterName: 'Isabella Grech',
      birthDate: '1956-01-01',
      deathDate: 'unknown',
      age: 70,
      causeOfDeath: 'Many things!',
      ailments: [],
      partyHistory: [],
      officesHeld: [],
      narrative: 'Isabella Grech lived to the age of 70.',
      portraitUrl: null,
    });
  });

  it('uses the SCORP3 graveyard channel when no env override is configured', () => {
    expect(getGraveyardChannelId()).toBe(DEFAULT_GRAVEYARD_CHANNEL_ID);
  });

  it('prefers a trimmed GRAVEYARD_CHANNEL_ID env override', () => {
    process.env.GRAVEYARD_CHANNEL_ID = ' 123456789012345678 ';

    expect(getGraveyardChannelId()).toBe('123456789012345678');
  });

  it('posts a generated obituary embed to the configured graveyard channel', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue({ send });

    const result = await postObituaryToGraveyard({
      client: { channels: { fetch } } as any,
      db: {} as any,
      playerId: 'player-1',
    });

    expect(fetch).toHaveBeenCalledWith(DEFAULT_GRAVEYARD_CHANNEL_ID);
    expect(mocks.generateObituary).toHaveBeenCalledWith(expect.anything(), 'player-1');
    expect(send).toHaveBeenCalledWith({ embeds: [expect.anything()] });
    expect(result).toMatchObject({
      status: 'sent',
      channelId: DEFAULT_GRAVEYARD_CHANNEL_ID,
    });
  });
});
