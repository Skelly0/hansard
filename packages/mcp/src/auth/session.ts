import type { StoredToken } from './tokenStore.js';

export interface McpSession {
  playerId: string;
  discordId: string;
  username: string;
  characterName: string | null;
  isStaff: boolean;
  staffRole: string | null;
  permissions: string[];
}

interface MeResponse {
  id: string;
  discordId: string;
  username: string;
  characterName: string | null;
  isStaff: boolean;
  staffRole: string | null;
  permissions: string[];
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Caches the player's identity + permissions, refreshing every 5 minutes.
 *
 * Permissions are office-derived (see aggregatePermissionsForPlayer in the
 * API). 5-minute staleness is acceptable for read-only tools — office
 * changes propagate within one cache cycle.
 */
export class SessionCache {
  private cached: { value: McpSession; fetchedAt: number } | null = null;

  constructor(
    private readonly apiUrl: string,
    private readonly token: StoredToken,
  ) {}

  async get(): Promise<McpSession> {
    if (this.cached && Date.now() - this.cached.fetchedAt < REFRESH_INTERVAL_MS) {
      return this.cached.value;
    }
    const fresh = await this.fetchMe();
    this.cached = { value: fresh, fetchedAt: Date.now() };
    return fresh;
  }

  private async fetchMe(): Promise<McpSession> {
    const res = await fetch(`${this.apiUrl}/api/auth/mcp/me`, {
      headers: { Authorization: `Bearer ${this.token.token}` },
    });
    if (res.status === 401) {
      throw new AuthExpiredError('MCP token rejected by API. Run `hansard-mcp login` to re-authenticate.');
    }
    if (!res.ok) {
      throw new Error(`Failed to refresh identity: ${res.status} ${await res.text()}`);
    }
    const data = await res.json() as MeResponse;
    return {
      playerId: data.id,
      discordId: data.discordId,
      username: data.username,
      characterName: data.characterName,
      isStaff: data.isStaff,
      staffRole: data.staffRole,
      permissions: data.permissions,
    };
  }
}

export class AuthExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthExpiredError';
  }
}
