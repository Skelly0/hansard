import { loadConfig } from './config.js';
import { runDeviceFlow } from './auth/deviceFlow.js';
import { readToken, writeToken, deleteToken } from './auth/tokenStore.js';

/**
 * Run the device flow and persist the token. Safe to re-run — overwrites
 * any existing token. This must run interactively (not under Claude Desktop's
 * stdio transport) because it opens a browser and prints to stderr.
 */
export async function runLogin(): Promise<void> {
  const config = loadConfig();
  const log = (msg: string) => process.stderr.write(msg + '\n');

  log(`[hansard-mcp] Logging in via ${config.apiUrl}…`);
  const { token, playerId } = await runDeviceFlow(config.apiUrl);

  await writeToken(config.tokenFile, {
    token,
    playerId,
    savedAt: new Date().toISOString(),
  });

  // Confirm by hitting /mcp/me so we can print the actual username.
  try {
    const res = await fetch(`${config.apiUrl}/api/auth/mcp/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const me = await res.json() as { username: string; characterName: string | null };
      log(`[hansard-mcp] Logged in as ${me.characterName ?? me.username}.`);
    }
  } catch { /* token is saved either way */ }

  log(`[hansard-mcp] Token saved to ${config.tokenFile}.`);
}

/**
 * Revoke the saved token on the API and delete the local file.
 */
export async function runLogout(): Promise<void> {
  const config = loadConfig();
  const log = (msg: string) => process.stderr.write(msg + '\n');

  const stored = await readToken(config.tokenFile);
  if (!stored) {
    log('[hansard-mcp] No token found — nothing to do.');
    return;
  }

  try {
    await fetch(`${config.apiUrl}/api/auth/mcp/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${stored.token}` },
    });
  } catch (err) {
    log(`[hansard-mcp] Warning: server-side revocation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  await deleteToken(config.tokenFile);
  log(`[hansard-mcp] Logged out (token deleted from ${config.tokenFile}).`);
}
