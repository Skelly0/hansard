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
    // OAuth2 `state` nonce minted by /api/auth/discord and checked by the
    // callback (RFC 6749 §10.12 login-CSRF defence). Single use.
    oauthState?: string;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    player?: Player;
    // Set by staff-only middleware or route branches that perform staff/admin
    // mutations so the API can mirror web-driven actions to the Discord mod log.
    staffActionLog?: boolean;
    // sha-256 hex of the bearer token, set by requireMcpToken so downstream
    // handlers (e.g. revoke) don't have to re-parse the Authorization header.
    mcpTokenHash?: string;
  }
}
