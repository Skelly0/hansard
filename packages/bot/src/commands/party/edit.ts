import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { parties, players } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import { refreshPartyJoinMessage } from '../../utils/partyJoinMessage.js';
import type { Command } from '../../client.js';

const PARTY_JOIN_BOARD_FIELDS = new Set(['name', 'shortName', 'ideology', 'colour', 'isActive', 'isInviteOnly']);

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('party-edit')
    .setDescription('Edit an existing party (staff only)')
    .addStringOption((opt) =>
      opt.setName('party').setDescription('Party to edit (name match)').setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName('name').setDescription('New full name').setRequired(false).setMaxLength(128),
    )
    .addStringOption((opt) =>
      opt.setName('short-name').setDescription('New short tag (use "-" to clear)').setRequired(false).setMaxLength(16),
    )
    .addStringOption((opt) =>
      opt.setName('ideology').setDescription('New ideology (use "-" to clear)').setRequired(false).setMaxLength(256),
    )
    .addStringOption((opt) =>
      opt.setName('colour').setDescription('New hex colour (use "-" to clear)').setRequired(false).setMaxLength(7),
    )
    .addRoleOption((opt) =>
      opt.setName('discord-role').setDescription('New Discord role (omit + role-clear:true to remove)').setRequired(false),
    )
    .addUserOption((opt) =>
      opt.setName('leader').setDescription('Set the party leader to an active party member').setRequired(false),
    )
    .addBooleanOption((opt) =>
      opt.setName('leader-clear').setDescription('Clear the party leader').setRequired(false),
    )
    .addBooleanOption((opt) =>
      opt.setName('role-clear').setDescription('Clear the mapped Discord role').setRequired(false),
    )
    .addBooleanOption((opt) =>
      opt.setName('active').setDescription('Set active state').setRequired(false),
    )
    .addBooleanOption((opt) =>
      opt.setName('invite-only').setDescription('Require staff assignment instead of public self-join').setRequired(false),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
      return;
    }
    if (!(await isStaff(member))) {
      await interaction.editReply({ embeds: [errorEmbed('Only staff can edit parties.')] });
      return;
    }

    const query = interaction.options.getString('party', true);
    const all = await db.select().from(parties).orderBy(asc(parties.name));
    const target =
      all.find((p) => p.name.toLowerCase() === query.toLowerCase()) ??
      all.find((p) => p.shortName?.toLowerCase() === query.toLowerCase()) ??
      all.find((p) => p.name.toLowerCase().includes(query.toLowerCase()));

    if (!target) {
      await interaction.editReply({ embeds: [errorEmbed(`No party matching "${query}" found.`)] });
      return;
    }

    const clearable = (raw: string | null): string | null | undefined => {
      if (raw === null) return undefined;
      return raw.trim() === '-' ? null : raw.trim();
    };

    const updates: Record<string, unknown> = {};

    const name = interaction.options.getString('name');
    if (name) updates.name = name.trim();

    const shortName = clearable(interaction.options.getString('short-name'));
    if (shortName !== undefined) updates.shortName = shortName;

    const ideology = clearable(interaction.options.getString('ideology'));
    if (ideology !== undefined) updates.ideology = ideology;

    const colour = clearable(interaction.options.getString('colour'));
    if (colour !== undefined) {
      if (colour !== null && !/^#[0-9a-fA-F]{6}$/.test(colour)) {
        await interaction.editReply({ embeds: [errorEmbed('Colour must be a 6-digit hex code like `#b94a48`, or `-` to clear.')] });
        return;
      }
      updates.colour = colour;
    }

    const discordRole = interaction.options.getRole('discord-role');
    const roleClear = interaction.options.getBoolean('role-clear');
    if (discordRole) updates.discordRoleId = discordRole.id;
    else if (roleClear) updates.discordRoleId = null;

    const leaderUser = interaction.options.getUser('leader');
    const leaderClear = interaction.options.getBoolean('leader-clear');
    if (leaderUser && leaderClear) {
      await interaction.editReply({ embeds: [errorEmbed('Choose either a leader or `leader-clear`, not both.')] });
      return;
    }
    if (leaderUser) {
      const [leader] = await db
        .select({ id: players.id, characterName: players.characterName })
        .from(players)
        .where(and(
          eq(players.discordId, leaderUser.id),
          eq(players.partyId, target.id),
          eq(players.isActive, true),
          eq(players.isAlive, true),
          isNotNull(players.characterName),
        ))
        .limit(1);

      if (!leader) {
        await interaction.editReply({
          embeds: [errorEmbed(`Leader must be an active member of ${target.name} with a living character.`)],
        });
        return;
      }

      updates.leaderId = leader.id;
    } else if (leaderClear) {
      updates.leaderId = null;
    }

    const active = interaction.options.getBoolean('active');
    if (active !== null) {
      updates.isActive = active;
      updates.dissolvedAt = active ? null : new Date();
    }

    const inviteOnly = interaction.options.getBoolean('invite-only');
    if (inviteOnly !== null) updates.isInviteOnly = inviteOnly;

    if (Object.keys(updates).length === 0) {
      await interaction.editReply({ embeds: [errorEmbed('No fields to update. Provide at least one option.')] });
      return;
    }

    try {
      const [updated] = await db
        .update(parties)
        .set(updates)
        .where(eq(parties.id, target.id))
        .returning();

      if (Object.keys(updates).some((field) => PARTY_JOIN_BOARD_FIELDS.has(field))) {
        try {
          await refreshPartyJoinMessage(interaction.client);
        } catch (error) {
          console.warn(`[party-edit] failed to refresh party join board after editing ${updated.id}:`, error);
        }
      }

      const changed = Object.keys(updates).join(', ');
      await interaction.editReply({
        embeds: [successEmbed(
          'Party Updated',
          `**${updated.name}**\nFields changed: \`${changed}\``,
        )],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update party';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
    }
  },
};

export default command;
