import type { ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { players } from '@hansard/db';
import { manualDeath } from '@hansard/api/services/simulationService';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { postObituaryToGraveyard } from '../../utils/graveyard.js';
import { isStaff } from '../../utils/permissions.js';
import { postStaffActionLog } from '../../utils/modLog.js';

type DeathAilment = {
  condition: string;
  severity: string;
};

function formatDeathAilments(ailments: DeathAilment[]): string {
  return ailments.map(a => `${a.condition} (${a.severity})`).join(', ');
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
    const deathResult = await manualDeath(db, targetPlayer.id, cause, staffPlayer?.id);
    const currentDate = deathResult.deathDate;
    const deathAilments = deathResult.ailments;

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

    await postStaffActionLog(interaction, {
      title: 'Character Killed',
      system: 'graveyard',
      fields: [
        { name: 'Player', value: `**${obituary.characterName}** (<@${targetUser.id}>)`, inline: true },
        { name: 'Cause', value: cause, inline: true },
        { name: 'Date', value: currentDate, inline: true },
        { name: 'Age', value: `${obituary.age ?? 'unknown'}`, inline: true },
        ...(ailmentsText ? [{ name: 'Ailments', value: ailmentsText }] : []),
      ],
    });
    await interaction.editReply({ embeds: [confirmEmbed] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to kill character';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
  }
}
