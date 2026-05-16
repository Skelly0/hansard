import type { ChatInputCommandInteraction } from 'discord.js';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, playerEventLog, simulationClock, officeHolders, offices, parties } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { postObituaryToGraveyard } from '../../utils/graveyard.js';
import { isStaff } from '../../utils/permissions.js';

type DeathAilment = {
  condition: string;
  severity: string;
};

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

  // A dead character cannot lead a party; clear any leaderId pointing at them.
  await db.update(parties).set({ leaderId: null }).where(eq(parties.leaderId, playerId));

  await db.insert(playerEventLog).values({
    playerId, eventType: 'death',
    description: `Died of ${causeOfDeath}${ailmentsText ? `; ailments: ${ailmentsText}` : ''}`,
    newValue: { causeOfDeath, deathDate, ailments: deathAilments },
    simTick: deathTick, simDate: deathDate,
    triggeredById, isAutomatic: false,
  });

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

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guild || !interaction.member) {
    await interaction.editReply({
      embeds: [errorEmbed('This command must be used in a server.')],
    });
    return;
  }
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!(await isStaff(member))) {
    await interaction.editReply({
      embeds: [errorEmbed('Only staff can kill characters.')],
    });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const cause = interaction.options.getString('cause', true);

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

  const [staffPlayer] = await db.select().from(players)
    .where(eq(players.discordId, interaction.user.id));

  try {
    const clock = await fetchClock();
    const currentDate = clock?.currentDate ?? 'unknown';
    const currentTick = clock?.currentTick ?? 0;
    const deathAilments = summarizeDeathAilments(targetPlayer.ailments);

    await processPlayerDeath(
      targetPlayer.id,
      cause,
      currentDate,
      currentTick,
      staffPlayer?.id ?? null,
      deathAilments,
    );

    const graveyardPost = await postObituaryToGraveyard({
      client: interaction.client,
      db,
      playerId: targetPlayer.id,
    });
    const obituary = graveyardPost.obituary ?? {
      characterName: targetPlayer.characterName ?? targetUser.username,
      age: targetPlayer.currentAge,
      ailments: deathAilments,
    };
    const graveyardNotice = graveyardPost.status === 'sent'
      ? `Obituary posted to <#${graveyardPost.channelId}>.`
      : graveyardPost.channelId
        ? `Death recorded, but the obituary could not be posted to <#${graveyardPost.channelId}>. Check bot logs.`
        : '_No graveyard channel configured. Set GRAVEYARD\\_CHANNEL\\_ID to enable obituary posts._';

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
        graveyardNotice,
      ].join('\n'),
      system: 'graveyard',
    });

    await interaction.editReply({ embeds: [confirmEmbed] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to kill character';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
  }
}
