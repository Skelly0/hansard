import { spawn } from 'node:child_process';

interface DeviceInitResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  interval: number;
  expires_in: number;
}

type PollResponse =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'approved'; token: string; player_id: string };

/**
 * Run the full device flow against the API:
 * 1. POST /device/init to get a pairing code
 * 2. Print + open the verification URL in the user's browser
 * 3. Poll until approved or expired
 * 4. Return the long-lived bearer token
 */
export async function runDeviceFlow(apiUrl: string): Promise<{ token: string; playerId: string }> {
  const initRes = await fetch(`${apiUrl}/api/auth/device/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!initRes.ok) {
    throw new Error(`Failed to init device flow: ${initRes.status} ${await initRes.text()}`);
  }
  const init = await initRes.json() as DeviceInitResponse;

  // CLI output goes to stderr so that if this is ever piped into Claude
  // Desktop's stdio transport (it shouldn't be, but be safe), it doesn't
  // pollute the protocol channel.
  const log = (msg: string) => process.stderr.write(msg + '\n');
  log('');
  log('  Open this URL in your browser to approve:');
  log('  ' + init.verification_uri_complete);
  log('');
  log('  Pairing code: ' + init.user_code);
  log('');

  openInBrowser(init.verification_uri_complete);

  const deadline = Date.now() + init.expires_in * 1000;
  const intervalMs = init.interval * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);

    const pollRes = await fetch(`${apiUrl}/api/auth/device/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: init.device_code }),
    });

    if (pollRes.status === 410 || pollRes.status === 404) {
      throw new Error('Pairing code expired before approval. Run login again.');
    }
    if (!pollRes.ok) {
      // Transient error — keep polling.
      continue;
    }
    const data = await pollRes.json() as PollResponse;
    if (data.status === 'pending') continue;
    if (data.status === 'expired') {
      throw new Error('Pairing code expired before approval. Run login again.');
    }
    if (data.status === 'approved') {
      return { token: data.token, playerId: data.player_id };
    }
  }
  throw new Error('Device flow timed out waiting for approval.');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Open the given URL in the user's default browser without going through a
 * shell — `&` and other shell-active characters in the URL would otherwise
 * be parsed by `cmd.exe` / `sh` even inside quotes. spawn() with array args
 * passes them as a single argv slot, sidestepping shell parsing entirely.
 *
 * Detached + unref so the CLI can exit while the browser keeps running.
 */
function openInBrowser(url: string): void {
  const opts = { detached: true, stdio: 'ignore' as const };
  if (process.platform === 'win32') {
    // The empty "" is the (unused) window title — required because the URL
    // would otherwise be interpreted as the title.
    spawn('cmd', ['/c', 'start', '""', url], { ...opts, windowsVerbatimArguments: true })
      .on('error', () => { /* best-effort */ })
      .unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], opts).on('error', () => { /* best-effort */ }).unref();
  } else {
    spawn('xdg-open', [url], opts).on('error', () => { /* best-effort */ }).unref();
  }
}
