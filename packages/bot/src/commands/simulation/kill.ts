import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
} from 'discord.js';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, playerEventLog, simulationClock, officeHolders, offices } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import type { Command } from '../../client.js';

const GRAVEYARD_COLOUR = 0x9C9890;

type DeathAilment = {
  condition: string;
  severity: string;
};

// ============================================================
// Helpers
// ============================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function summarizeDeathAilments(ailments: unknown): DeathAilment[] {
  if (!Array.isArray(ailments)) return [];

  const byCondition = new Map<string, DeathAilment>();
  for (const ailment of ailments) {
    if (!isRecord(ailment)) continue;
    const { condition, severity } = ailment;
    if (typeof condition !== 'string' || typeof severity !== 'string') continue;

    const normalized = condition.trim();
    if (!normalized) continue;
    byCondition.set(normalized.toLowerCase(), { condition: normalized, severity });
  }

  return [...byCondition.values()];
}

function formatDeathAilments(ailments: DeathAilment[]): string {
  return ailments.map(a => `${a.condition} (${a.severity})`).join(', ');
}

async function fetchClock() {
  const rows = await db.select().from(simulationClock).limit(1);
  return rows[0] ?? null;
}

async function processPlayerDeath(
  playerId: string,
  causeOfDeath: string,
  deathDate: string,
  deathTick: number,
  triggeredById: string | null,
  deathAilments: DeathAilment[] = [],
) {
  const ailmentsText = formatDeathAilments(deathAilments);

  await db.update(players).set({
    isAlive: false, deathDate, causeOfDeath, healthStatus: 'deceased',
  }).where(eq(players.id, playerId));

  await db.insert(playerEventLog).values({
    playerId, eventType: 'death',
    description: `Died of ${causeOfDeath}${ailmentsText ? `; ailments: ${ailmentsText}` : ''}`,
    newValue: { causeOfDeath, deathDate, ailments: deathAilments },
    simTick: deathTick, simDate: deathDate,
    triggeredById, isAutomatic: false,
  });

  // Vacate all offices
  const heldOffices = await db.select({
    holderId: officeHolders.id, officeId: officeHolders.officeId, officeName: offices.name,
  }).from(officeHolders)
    .innerJoin(offices, eq(officeHolders.officeId, offices.id))
    .where(and(eq(officeHolders.playerId, playerId), isNull(officeHolders.endDate)));

  for (const held of heldOffices) {
    await db.update(officeHolders).set({ endDate: new Date(), removalReason: 'died' })
      .where(eq(officeHolders.id, held.holderId));
    await db.insert(playerEventLog).values({
      playerId, eventType: 'office_left',
      description: `Vacated ${held.officeName} (died in office)`,
      oldValue: { officeId: held.officeId, officeName: held.officeName },
      simTick: deathTick, simDate: deathDate,
      triggeredById, isAutomatic: false,
    });
  }
}

async function generateObituary(playerId: string) {
  const [player] = await db.select().from(players).where(eq(players.id, playerId));
  if (!player) throw new Error('Player not found');

  const events = await db.select().from(playerEventLog)
    .where(eq(playerEventLog.playerId, playerId));

  const partyChanges = events
    .filter(e => e.eventType === 'party_change')
    .map(e => ({
      description: e.description,
      date: e.simDate,
      oldValue: e.oldValue as { partyName?: string } | null,
      newValue: e.newValue as { partyName?: string } | null,
    }));

  const officesHeld = events
    .filter(e => e.eventType === 'office_appointed' || e.eventType === 'office_left')
    .map(e => ({
      description: e.description,
      date: e.simDate,
      eventType: e.eventType,
      newValue: e.newValue as { officeName?: string } | null,
    }));

  const name = player.characterName ?? 'Unknown';
  const narrativeParts: string[] = [];

  if (player.currentAge != null) {
    narrativeParts.push(`${name} lived to the age of ${player.currentAge}.`);
  }

  if (partyChanges.length > 0) {
    const lastParty = partyChanges[partyChanges.length - 1];
    const partyName = lastParty?.newValue?.partyName ?? 'an independent faction';
    narrativeParts.push(`A member of ${partyName}.`);
  }

  const appointmentEvents = officesHeld.filter(o => o.eventType === 'office_appointed');
  if (appointmentEvents.length > 0) {
    const officeNames = appointmentEvents
      .map(o => o.newValue?.officeName ?? o.description)
      .filter(Boolean);
    if (officeNames.length > 0) {
      narrativeParts.push(`Served as ${officeNames.join(', ')}.`);
    }
  }

  if (player.causeOfDeath) {
    narrativeParts.push(`Died of ${player.causeOfDeath}.`);
  }

  const ailments = summarizeDeathAilments(player.ailments);
  const ailmentsText = formatDeathAilments(ailments);
  if (ailmentsText) {
    narrativeParts.push(`Ailments at death: ${ailmentsText}.`);
  }

  return {
    characterName: player.characterName ?? 'Unknown',
    birthDate: player.birthDate ?? 'unknown',
    deathDate: player.deathDate ?? 'unknown',
    age: player.currentAge,
    causeOfDeath: player.causeOfDeath ?? 'unknown causes',
    ailments,
    partyHistory: partyChanges,
    officesHeld,
    narrative: narrativeParts.join(' '),
    portraitUrl: player.characterPortraitUrl,
  };
}

function buildObituaryEmbed(obituary: {
  characterName: string;
  birthDate: string;
  deathDate: string;
  age: number | null;
  causeOfDeath: string;
  ailments: DeathAilment[];
  partyHistory: { description: string; date: string | null }[];
  officesHeld: { description: string; date: string | null; eventType: string }[];
  narrative: string;
  portraitUrl: string | null;
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`\u26B0\uFE0F ${obituary.characterName} (${obituary.birthDate} \u2014 ${obituary.deathDate})`)
    .setColor(GRAVEYARD_COLOUR)
    .setFooter({ text: `Rest in peace. \u2022 ${obituary.deathDate}` })
    .setTimestamp();

  if (obituary.narrative) {
    embed.setDescription(`*${obituary.narrative}*`);
  }

  const fields: { name: string; value: string; inline: boolean }[] = [];

  fields.push({ name: 'Cause of Death', value: obituary.causeOfDeath, inline: true });
  fields.push({ name: 'Age', value: obituary.age != null ? `${obituary.age}` : 'Unknown', inline: true });

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

// ============================================================
// Command
// ============================================================

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('kill')
    .setDescription('Kill a player character and post their obituary')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((opt) =>
      opt.setName('user').setDescription('The player to kill').setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName('cause').setDescription('Cause of death').setRequired(true),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser('user', true);
    const cause = interaction.options.getString('cause', true);

    // Look up target player
    const [targetPlayer] = await db.select().from(players)
      .where(eq(players.discordId, targetUser.id));

    if (!targetPlayer) {
      await interaction.editReply({
        embeds: [errorEmbed('That user is not registered as a player.')],
      });
      return;
    }

    if (!targetPlayer.isAlive) {
      await interaction.editReply({
        embeds: [errorEmbed('That character is already dead.')],
      });
      return;
    }

    // Look up staff player
    const [staffPlayer] = await db.select().from(players)
      .where(eq(players.discordId, interaction.user.id));

    try {
      const clock = await fetchClock();
      const currentDate = clock?.currentDate ?? 'unknown';
      const currentTick = clock?.currentTick ?? 0;
      const deathAilments = summarizeDeathAilments(targetPlayer.ailments);

      // Kill the character
      await processPlayerDeath(
        targetPlayer.id,
        cause,
        currentDate,
        currentTick,
        staffPlayer?.id ?? null,
        deathAilments,
      );

      // Generate obituary
      const obituary = await generateObituary(targetPlayer.id);
      const graveyardEmbed = buildObituaryEmbed(obituary);

      // Post to graveyard channel if configured
      const graveyardChannelId = process.env.GRAVEYARD_CHANNEL_ID;
      if (graveyardChannelId) {
        try {
          const channel = await interaction.client.channels.fetch(graveyardChannelId);
          if (channel && 'send' in channel) {
            await (channel as TextChannel).send({ embeds: [graveyardEmbed] });
          }
        } catch (channelErr) {
          console.error('Failed to post obituary to graveyard channel:', channelErr);
        }
      }

      // Reply in the command channel
      const ailmentsText = formatDeathAilments(obituary.ailments);
      const confirmEmbed = createEmbed({
        title: 'Character Killed',
        description: [
          `**${obituary.characterName}** has died.`,
          '',
          `**Cause:** ${cause}`,
          `**Age:** ${obituary.age ?? 'unknown'}`,
          ...(ailmentsText ? [`**Ailments:** ${ailmentsText}`] : []),
          '',
          graveyardChannelId
            ? `Obituary posted to <#${graveyardChannelId}>.`
            : '_No graveyard channel configured. Set GRAVEYARD\\_CHANNEL\\_ID to enable obituary posts._',
        ].join('\n'),
        system: 'graveyard',
      });

      await interaction.editReply({ embeds: [confirmEmbed] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to kill character';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
    }
  },
};

export default command;
