import '@fastify/session';
import type { Player } from '@hansard/db';

export interface SessionUser {
  id: string;            // players.id (UUID), NOT Discord snowflake
  discordId: string;
  username: string;
  avatar: string | null;
  isStaff: boolean;
  staffRole: string | null;
  permissions: string[];
}

declare module '@fastify/session' {
  interface FastifySessionObject {
    user?: SessionUser;
    // Pending MCP device-flow approval. Set when a user visits
    // /api/auth/device?user_code=… and is bounced through Discord OAuth, so
    // the post-login redirect target is bound to the session instead of
    // round-tripping through an attacker-controllable OAuth `state` value.
    pendingDeviceUserCode?: string;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    player?: Player;
  }
}
