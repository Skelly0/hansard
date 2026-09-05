import { EmbedBuilder } from 'discord.js';
import { generateObituary } from '@hansard/api/services/simulationService';
import type { Database } from '@hansard/db';

const GRAVEYARD_COLOUR = 0x9C9890;

type Obituary = Awaited<ReturnType<typeof generateObituary>>;

type SendableChannel = {
  send(options: { embeds: EmbedBuilder[] }): Promise<unknown>;
};

type GraveyardClient = {
  channels: {
    fetch(channelId: string): Promise<unknown>;
  };
};

export type GraveyardPostResult = {
  status: 'sent' | 'not_configured' | 'not_sendable' | 'failed';
  channelId: string | null;
  obituary: Obituary | null;
  error?: unknown;
};

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return !!channel && typeof (channel as { send?: unknown }).send === 'function';
}

/** Resolve `GRAVEYARD_CHANNEL_ID`; `null` when unset so obituaries report `not_configured`. */
export function getGraveyardChannelId(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.GRAVEYARD_CHANNEL_ID?.trim() || null;
}

function formatDeathAilments(ailments: { condition: string; severity: string }[]): string {
  return ailments.map(a => `${a.condition} (${a.severity})`).join(', ');
}

function formatObituaryTitle(obituary: Obituary): string {
  const prefix = `\u26B0\uFE0F ${obituary.characterName}`;
  if (obituary.birthDate && obituary.deathDate) {
    return `${prefix} (${obituary.birthDate} \u2014 ${obituary.deathDate})`;
  }
  if (obituary.deathDate) {
    return `${prefix} (d. ${obituary.deathDate})`;
  }
  if (obituary.birthDate) {
    return `${prefix} (b. ${obituary.birthDate})`;
  }
  return prefix;
}

export function buildObituaryEmbed(obituary: Obituary): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(formatObituaryTitle(obituary))
    .setColor(GRAVEYARD_COLOUR)
    .setFooter({ text: obituary.deathDate ? `Rest in peace. \u2022 ${obituary.deathDate}` : 'Rest in peace.' })
    .setTimestamp();

  if (obituary.narrative) {
    embed.setDescription(`*${obituary.narrative}*`);
  }

  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: 'Cause of Death', value: obituary.causeOfDeath, inline: true },
    { name: 'Age', value: obituary.age != null ? `${obituary.age}` : 'Unknown', inline: true },
  ];

  const ailmentsText = formatDeathAilments(obituary.ailments);
  if (ailmentsText) {
    fields.push({ name: 'Ailments', value: ailmentsText.slice(0, 1024), inline: false });
  }

  if (obituary.partyHistory.length > 0) {
    const partyLines = obituary.partyHistory.map(
      (p) => `\u2022 ${p.description}${p.date ? ` (${p.date})` : ''}`,
    );
    fields.push({
      name: 'Party History',
      value: partyLines.join('\n').slice(0, 1024),
      inline: false,
    });
  }

  const appointments = obituary.officesHeld.filter(o => o.eventType === 'office_appointed');
  if (appointments.length > 0) {
    const officeLines = appointments.map(
      (o) => `\u2022 ${o.description}${o.date ? ` (${o.date})` : ''}`,
    );
    fields.push({
      name: 'Offices Held',
      value: officeLines.join('\n').slice(0, 1024),
      inline: false,
    });
  }

  embed.addFields(fields);

  if (obituary.portraitUrl) {
    embed.setThumbnail(obituary.portraitUrl);
  }

  return embed;
}

export async function postObituaryToGraveyard({
  client,
  db,
  playerId,
  channelId = getGraveyardChannelId(),
}: {
  client: GraveyardClient;
  db: Database;
  playerId: string;
  channelId?: string | null;
}): Promise<GraveyardPostResult> {
  let obituary: Obituary;

  try {
    obituary = await generateObituary(db, playerId);
  } catch (error) {
    console.error(`Failed to generate obituary for player ${playerId}:`, error);
    return { status: 'failed', channelId, obituary: null, error };
  }

  if (!channelId) {
    return { status: 'not_configured', channelId: null, obituary };
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!isSendableChannel(channel)) {
      console.error(`GRAVEYARD_CHANNEL_ID ${channelId} did not resolve to a sendable channel.`);
      return { status: 'not_sendable', channelId, obituary };
    }

    await channel.send({ embeds: [buildObituaryEmbed(obituary)] });
    return { status: 'sent', channelId, obituary };
  } catch (error) {
    console.error(`Failed to post obituary to graveyard channel ${channelId}:`, error);
    return { status: 'failed', channelId, obituary, error };
  }
}
