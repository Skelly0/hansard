const DISCORD_API_BASE = 'https://discord.com/api/v10';
const MOD_LOG_CHANNEL_ENV = 'MOD_LOG_CHANNEL_ID';
const SUPPRESSED_ALLOWED_MENTIONS = { parse: [] } as const;
const MAX_FIELD_VALUE_LENGTH = 1024;
const MAX_PAYLOAD_ENTRIES = 10;

const REDACTED_KEYS = new Set([
  'accessToken',
  'apiKey',
  'authorization',
  'body',
  'characterBio',
  'characterPortraitUrl',
  'content',
  'description',
  'discordToken',
  'internalNotes',
  'message',
  'notes',
  'password',
  'portraitUrl',
  'secret',
  'text',
  'token',
]);

let warnedMissingToken = false;

export interface ApiStaffActionActor {
  id?: string;
  discordId?: string | null;
  discordUsername?: string | null;
  username?: string | null;
  characterName?: string | null;
}

export interface ApiStaffActionLogOptions {
  actor?: ApiStaffActionActor | null;
  method: string;
  path: string;
  statusCode: number;
  payload?: unknown;
}

interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export async function postApiStaffActionLog(options: ApiStaffActionLogOptions): Promise<void> {
  const channelId = process.env[MOD_LOG_CHANNEL_ENV]?.trim();
  if (!channelId) return;

  const token = getBotToken();
  if (!token) {
    warnMissingToken();
    return;
  }

  const fields: DiscordEmbedField[] = [
    { name: 'Actor', value: formatActor(options.actor), inline: true },
    { name: 'Route', value: code(`${options.method.toUpperCase()} ${options.path}`), inline: true },
    { name: 'Status', value: code(String(options.statusCode)), inline: true },
  ];

  const payloadSummary = summarizePayload(options.payload);
  if (payloadSummary) {
    fields.push({ name: 'Payload', value: payloadSummary });
  }

  await sendOne(channelId, token, {
    embeds: [{
      title: 'Web/API Staff Action',
      color: 0xC25B4E,
      timestamp: new Date().toISOString(),
      fields,
      footer: { text: process.env.BOT_DISPLAY_NAME || 'Hansard' },
    }],
  });
}

function getBotToken(): string | undefined {
  return process.env.MOD_LOG_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN || undefined;
}

function warnMissingToken(): void {
  if (warnedMissingToken) return;
  warnedMissingToken = true;
  console.warn('postApiStaffActionLog skipped: set MOD_LOG_BOT_TOKEN or DISCORD_BOT_TOKEN.');
}

async function sendOne(
  channelId: string,
  token: string,
  body: { embeds: Array<Record<string, unknown>> },
): Promise<void> {
  try {
    const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...body, allowed_mentions: SUPPRESSED_ALLOWED_MENTIONS }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(`postApiStaffActionLog failed (${response.status}): ${text.slice(0, 200)}`);
    }
  } catch (err) {
    console.error('postApiStaffActionLog error:', err);
  }
}

function formatActor(actor: ApiStaffActionActor | null | undefined): string {
  if (!actor) return 'Unknown actor';

  const display = actor.characterName || actor.discordUsername || actor.username || actor.id || 'Unknown actor';
  return actor.discordId ? `**${display}** (<@${actor.discordId}>)` : `**${display}**`;
}

function summarizePayload(payload: unknown): string | undefined {
  if (payload === undefined || payload === null) return undefined;

  if (Array.isArray(payload)) {
    return truncate(`array(${payload.length})`);
  }

  if (typeof payload !== 'object') {
    return truncate(formatPayloadValue('payload', payload));
  }

  const entries = Object.entries(payload as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .slice(0, MAX_PAYLOAD_ENTRIES);
  if (entries.length === 0) return undefined;

  const summary = entries
    .map(([key, value]) => `${key}=${formatPayloadValue(key, value)}`)
    .join(', ');
  const omittedCount = Object.keys(payload as Record<string, unknown>).length - entries.length;
  return truncate(omittedCount > 0 ? `${summary}, ...(+${omittedCount} more)` : summary);
}

function formatPayloadValue(key: string, value: unknown): string {
  if (REDACTED_KEYS.has(key)) return '[redacted]';
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value.length > 80 ? `${value.slice(0, 77)}...` : value);
    case 'number':
    case 'boolean':
      return String(value);
    case 'object':
      return Array.isArray(value) ? `array(${value.length})` : `object(${Object.keys(value).length})`;
    default:
      return `[${typeof value}]`;
  }
}

function code(value: string): string {
  return `\`${value.replace(/`/g, "'")}\``;
}

function truncate(value: string): string {
  if (value.length <= MAX_FIELD_VALUE_LENGTH) return value;
  return `${value.slice(0, MAX_FIELD_VALUE_LENGTH - 3)}...`;
}
