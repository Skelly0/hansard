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
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    player?: Player;
  }
}
