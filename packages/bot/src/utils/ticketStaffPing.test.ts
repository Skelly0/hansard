import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendTicketStaffPing } from './ticketStaffPing.js';

describe('sendTicketStaffPing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.STAFF_ROLE_ID;
  });

  it('mentions the configured staff role in the ticket thread', async () => {
    process.env.STAFF_ROLE_ID = 'staff-role-id';
    const send = vi.fn().mockResolvedValue(undefined);

    await sendTicketStaffPing(
      { send } as any,
      { roles: { cache: new Map(), fetch: vi.fn() } } as any,
      42,
    );

    expect(send).toHaveBeenCalledWith({
      allowedMentions: { roles: ['staff-role-id'] },
      content: '<@&staff-role-id> New ticket #42 is ready for staff review.',
    });
  });

  it('falls back to a guild role named Staff when STAFF_ROLE_ID is unset', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const staffRole = { id: 'cached-staff-role-id', name: 'Staff' };

    await sendTicketStaffPing(
      { send } as any,
      {
        roles: {
          cache: new Map([[staffRole.id, staffRole]]),
          fetch: vi.fn(),
        },
      } as any,
      43,
    );

    expect(send).toHaveBeenCalledWith({
      allowedMentions: { roles: ['cached-staff-role-id'] },
      content: '<@&cached-staff-role-id> New ticket #43 is ready for staff review.',
    });
  });

  it('does not send a non-pinging placeholder when no staff role can be resolved', async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await sendTicketStaffPing(
      { send } as any,
      {
        roles: {
          cache: new Map(),
          fetch: vi.fn().mockResolvedValue(new Map()),
        },
      } as any,
      44,
    );

    expect(send).not.toHaveBeenCalled();
  });
});
