import type { ChatInputCommandInteraction } from 'discord.js';
import { parties } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import { refreshPartyJoinMessage } from '../../utils/partyJoinMessage.js';
import { postStaffActionLog } from '../../utils/modLog.js';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const member = interaction.member;
  if (!member || !('roles' in member)) {
    await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
    return;
  }
  if (!(await isStaff(member))) {
    await interaction.editReply({ embeds: [errorEmbed('Only staff can create parties.')] });
    return;
  }

  const name = interaction.options.getString('name', true).trim();
  const shortName = interaction.options.getString('short-name')?.trim() || null;
  const ideology = interaction.options.getString('ideology')?.trim() || null;
  const colour = interaction.options.getString('colour')?.trim() || null;
  const factionId = interaction.options.getString('faction-id')?.trim() || null;
  const discordRole = interaction.options.getRole('discord-role');
  const isInviteOnly = interaction.options.getBoolean('invite-only') ?? false;

  if (colour && !/^#[0-9a-fA-F]{6}$/.test(colour)) {
    await interaction.editReply({ embeds: [errorEmbed('Colour must be a 6-digit hex like `#b94a48`.')] });
    return;
  }

  try {
    const [party] = await db
      .insert(parties)
      .values({
        name,
        shortName,
        ideology,
        colour,
        factionId,
        discordRoleId: discordRole?.id ?? null,
        isInviteOnly,
        isActive: true,
      })
      .returning();

    let boardRefreshNotice = '';
    if (!party.isInviteOnly) {
      try {
        const refreshed = await refreshPartyJoinMessage(interaction.client);
        if (!refreshed) {
          boardRefreshNotice = [
            '',
            'Party join board refresh failed: no current join board was found.',
            'Run `pnpm --filter @hansard/bot post:party-join` to post a new one.',
          ].join('\n');
        }
      } catch (error) {
        console.warn(`[party create] failed to refresh party join board after creating ${party.id}:`, error);
        boardRefreshNotice = [
          '',
          'Party join board refresh failed; run `pnpm --filter @hansard/bot post:party-join` to refresh it manually.',
        ].join('\n');
      }
    }

    const lines = [
      `**${party.name}**${party.shortName ? ` (${party.shortName})` : ''}`,
      party.ideology ? `*${party.ideology}*` : '',
      party.colour ? `Colour: \`${party.colour}\`` : '',
      party.discordRoleId ? `Role: <@&${party.discordRoleId}>` : '',
      party.isInviteOnly ? 'Access: invite-only' : 'Access: open join',
      `\nID: \`${party.id}\``,
      boardRefreshNotice,
    ].filter(Boolean).join('\n');

    await postStaffActionLog(interaction, {
      title: 'Party Created',
      system: 'players',
      fields: [
        { name: 'Party', value: party.name, inline: true },
        { name: 'ID', value: `\`${party.id}\``, inline: true },
        { name: 'Access', value: party.isInviteOnly ? 'invite-only' : 'open join', inline: true },
        ...(party.discordRoleId ? [{ name: 'Role', value: `<@&${party.discordRoleId}>`, inline: true }] : []),
      ],
    });
    await interaction.editReply({ embeds: [successEmbed('Party Founded', lines)] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create party';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
  }
}
