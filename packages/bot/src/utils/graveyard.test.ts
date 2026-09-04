import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateObituary: vi.fn(),
}));

vi.mock('@hansard/api/services/simulationService', () => ({
  generateObituary: mocks.generateObituary,
}));

import {
  buildObituaryEmbed,
  getGraveyardChannelId,
  postObituaryToGraveyard,
} from './graveyard.js';

function makeObituary(overrides: Record<string, unknown> = {}) {
  return {
    characterName: 'Adrian DuPont',
    birthDate: '2037-01-01',
    deathDate: '2075-01-01',
    age: 38,
    causeOfDeath: 'Heart Attack from a failed coup',
    ailments: [],
    partyHistory: [],
    officesHeld: [],
    narrative: 'Adrian DuPont lived to the age of 38.',
    portraitUrl: null,
    ...overrides,
  } as Parameters<typeof buildObituaryEmbed>[0];
}

describe('graveyard obituary posting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GRAVEYARD_CHANNEL_ID;
    mocks.generateObituary.mockResolvedValue(makeObituary({
      characterName: 'Isabella Grech',
      birthDate: '1956-01-01',
      deathDate: '2026-04-12',
      age: 70,
      causeOfDeath: 'Many things!',
      narrative: 'Isabella Grech lived to the age of 70.',
    }));
  });

  it('returns null when no graveyard channel is configured', () => {
    expect(getGraveyardChannelId()).toBeNull();
  });

  it('still generates the obituary but reports not_configured when no channel is set', async () => {
    const fetch = vi.fn();

    const result = await postObituaryToGraveyard({
      client: { channels: { fetch } } as any,
      db: {} as any,
      playerId: 'player-1',
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.generateObituary).toHaveBeenCalledWith(expect.anything(), 'player-1');
    expect(result).toMatchObject({ status: 'not_configured', channelId: null });
    expect(result.obituary).not.toBeNull();
  });

  it('prefers a trimmed GRAVEYARD_CHANNEL_ID env override', () => {
    process.env.GRAVEYARD_CHANNEL_ID = ' 123456789012345678 ';

    expect(getGraveyardChannelId()).toBe('123456789012345678');
  });

  it('renders both dates in the title when birthDate is known', () => {
    const embed = buildObituaryEmbed(makeObituary());

    expect(embed.data.title).toBe('⚰️ Adrian DuPont (2037-01-01 — 2075-01-01)');
    expect(embed.data.footer?.text).toBe('Rest in peace. • 2075-01-01');
  });

  it('omits the dash and falls back to "d. <deathDate>" when birthDate is null', () => {
    const embed = buildObituaryEmbed(makeObituary({ birthDate: null }));

    expect(embed.data.title).toBe('⚰️ Adrian DuPont (d. 2075-01-01)');
    expect(embed.data.title).not.toContain('unknown');
    expect(embed.data.footer?.text).toBe('Rest in peace. • 2075-01-01');
  });

  it('drops the date suffix entirely when both birthDate and deathDate are null', () => {
    const embed = buildObituaryEmbed(makeObituary({ birthDate: null, deathDate: null }));

    expect(embed.data.title).toBe('⚰️ Adrian DuPont');
    expect(embed.data.footer?.text).toBe('Rest in peace.');
  });

  it('posts a generated obituary embed to the configured graveyard channel', async () => {
    process.env.GRAVEYARD_CHANNEL_ID = '123456789012345678';
    const send = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue({ send });

    const result = await postObituaryToGraveyard({
      client: { channels: { fetch } } as any,
      db: {} as any,
      playerId: 'player-1',
    });

    expect(fetch).toHaveBeenCalledWith('123456789012345678');
    expect(mocks.generateObituary).toHaveBeenCalledWith(expect.anything(), 'player-1');
    expect(send).toHaveBeenCalledWith({ embeds: [expect.anything()] });
    expect(result).toMatchObject({
      status: 'sent',
      channelId: '123456789012345678',
    });
  });
});
