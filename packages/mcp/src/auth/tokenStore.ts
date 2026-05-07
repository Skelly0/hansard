import { readFile, writeFile, mkdir, unlink, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface StoredToken {
  token: string;
  playerId: string;
  savedAt: string; // ISO timestamp; informational only
}

export async function readToken(file: string): Promise<StoredToken | null> {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as StoredToken;
    if (!parsed.token || !parsed.playerId) return null;
    return parsed;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeToken(file: string, token: StoredToken): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(token, null, 2), { encoding: 'utf8', mode: 0o600 });
  // Chmod again in case the file already existed with looser perms.
  if (process.platform !== 'win32') {
    try { await chmod(file, 0o600); } catch { /* best-effort */ }
  }
}

export async function deleteToken(file: string): Promise<void> {
  try {
    await unlink(file);
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
}
