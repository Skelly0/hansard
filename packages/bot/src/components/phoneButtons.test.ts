import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { ButtonInteraction } from 'discord.js';

const mocks = vi.hoisted(() => ({
  svc: {
    answerCall: vi.fn(),
    declineCall: vi.fn(),
    expireRingingCall: vi.fn(),
    expireRingingCalls: vi.fn(),
    getCallParticipants: vi.fn(),
    claimVoicemailPeep: vi.fn(),
    markVoicemailPeeped: vi.fn(),
    systemEndCall: vi.fn(),
  },
  relay: {
    hangUpAndNotify: vi.fn(),
    postCallOpenedToStaffThread: vi.fn(),
    sendVoicemailBeep: vi.fn(),
  },
  resolvePhonePlayer: vi.fn(),
}));

class MockPhoneServiceError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

vi.mock('../db.js', () => ({ db: {} }));
vi.mock('@hansard/api/services/phoneService', () => ({
  PhoneService: vi.fn(function PhoneService() {
    return mocks.svc;
  }),
  PhoneServiceError: MockPhoneServiceError,
}));
vi.mock('../utils/phoneRelay.js', () => mocks.relay);
vi.mock('../commands/phone/playerLookup.js', () => ({
  resolvePhonePlayer: mocks.resolvePhonePlayer,
}));

const { handlePhoneButton, PHONE_ANSWER_PREFIX } = await import('./phoneButtons.js');

function makeInteraction(customId = `${PHONE_ANSWER_PREFIX}call-1`) {
  return {
    customId,
    user: { id: 'discord-1' },
    client: { users: { fetch: vi.fn() } },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    message: {
      edit: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as ButtonInteraction & {
    message: { edit: ReturnType<typeof vi.fn> };
  };
}

describe('handlePhoneButton expired ringing calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolvePhonePlayer.mockResolvedValue({ id: 'player-1', characterName: 'Ada' });
    mocks.relay.hangUpAndNotify.mockResolvedValue(undefined);
    mocks.relay.sendVoicemailBeep.mockResolvedValue(undefined);
    mocks.svc.claimVoicemailPeep.mockResolvedValue({ id: 'call-1', status: 'voicemail' });
    mocks.svc.markVoicemailPeeped.mockResolvedValue(undefined);
    mocks.svc.systemEndCall.mockResolvedValue(undefined);
  });

  it('expires only the clicked call instead of sweeping unrelated expired calls', async () => {
    const interaction = makeInteraction();
    mocks.svc.answerCall.mockRejectedValueOnce(
      new MockPhoneServiceError('invalid_state', 'Call is no longer ringing.'),
    );
    mocks.svc.expireRingingCall.mockResolvedValueOnce({
      id: 'call-1',
      status: 'missed',
      endedReason: 'ring_timeout',
    });
    mocks.svc.expireRingingCalls.mockResolvedValueOnce([
      { id: 'unrelated-call', status: 'missed', endedReason: 'ring_timeout' },
    ]);

    await handlePhoneButton(interaction);

    expect(mocks.svc.expireRingingCall).toHaveBeenCalledWith('call-1', expect.any(Date));
    expect(mocks.svc.expireRingingCalls).not.toHaveBeenCalled();
    expect(mocks.relay.hangUpAndNotify).toHaveBeenCalledWith(interaction.client, 'call-1', 'ring_timeout');
  });

  it('keeps already-voicemail stale buttons labeled as voicemail', async () => {
    const interaction = makeInteraction();
    mocks.svc.answerCall.mockRejectedValueOnce(
      new MockPhoneServiceError('invalid_state', 'Call is already voicemail.'),
    );
    mocks.svc.getCallParticipants.mockResolvedValueOnce({
      call: { id: 'call-1', status: 'voicemail', voicemailBeepedAt: new Date() },
      callerPlayer: { discordId: 'caller-discord' },
      recipientPlayer: { discordId: 'recipient-discord' },
      callerNumber: { numberRaw: '111' },
      recipientNumber: { numberRaw: '222' },
    });

    await handlePhoneButton(interaction);

    const editArg = interaction.message.edit.mock.calls[0]?.[0] as { embeds?: Array<{ data?: { description?: string } }> };
    expect(editArg.embeds?.[0]?.data?.description).toContain('voicemail');
    expect(mocks.svc.expireRingingCalls).not.toHaveBeenCalled();
  });

  it('does not send a duplicate peep when another worker has already claimed it', async () => {
    const interaction = makeInteraction();
    mocks.svc.answerCall.mockRejectedValueOnce(
      new MockPhoneServiceError('invalid_state', 'Call is no longer ringing.'),
    );
    mocks.svc.expireRingingCall.mockResolvedValueOnce({
      id: 'call-1',
      status: 'voicemail',
      voicemailBeepedAt: null,
    });
    mocks.svc.claimVoicemailPeep.mockResolvedValueOnce(null);

    await handlePhoneButton(interaction);

    expect(mocks.svc.claimVoicemailPeep).toHaveBeenCalledWith('call-1', expect.any(Date));
    expect(mocks.relay.sendVoicemailBeep).not.toHaveBeenCalled();
    expect(mocks.svc.markVoicemailPeeped).not.toHaveBeenCalled();
  });

  it('keeps voicemail open when peep delivery succeeds but stamping fails', async () => {
    const interaction = makeInteraction();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.svc.answerCall.mockRejectedValueOnce(
      new MockPhoneServiceError('invalid_state', 'Call is no longer ringing.'),
    );
    mocks.svc.expireRingingCall.mockResolvedValueOnce({
      id: 'call-1',
      status: 'voicemail',
      voicemailBeepedAt: null,
    });
    mocks.svc.markVoicemailPeeped.mockRejectedValueOnce(new Error('write failed'));

    try {
      await handlePhoneButton(interaction);
    } finally {
      consoleError.mockRestore();
    }

    expect(mocks.relay.sendVoicemailBeep).toHaveBeenCalledWith(interaction.client, 'call-1');
    expect(mocks.svc.markVoicemailPeeped).toHaveBeenCalledWith('call-1', expect.any(Date));
    expect(mocks.svc.systemEndCall).not.toHaveBeenCalled();
    const editArg = interaction.message.edit.mock.calls[0]?.[0] as { embeds?: Array<{ data?: { description?: string } }> };
    expect(editArg.embeds?.[0]?.data?.description).toContain('voicemail');
  });
});
