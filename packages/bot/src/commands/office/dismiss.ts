import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, and, isNull, asc } from 'drizzle-orm';
import { offices, officeHolders, players, playerEventLog } from '@hansard/db';
import { PlayerEventType } from '@hansard/shared';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import { autocompleteOffice } from './_officeAutocomplete.js';
import type { Command } from '../../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('dismiss')
    .setDescription('Remove the current holder from an office (PM power or staff)')
    .addStringOption((opt) =>
      opt
        .setName('office')
        .setDescription('Name of the office')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((opt) =>
      opt
        .setName('reason')
        .setDescription('Reason for dismissal')
        .setRequired(false),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
      return;
    }

    const userIsStaff = await isStaff(member);

    // Look up the invoker's player record
    const [invokerPlayer] = await db
      .select()
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);

    if (!invokerPlayer) {
      await interaction.editReply({ embeds: [errorEmbed('You are not registered as a player.')] });
      return;
    }

    // Check if invoker holds an office with appoint_ministers permission
    let hasAppointPermission = false;
    if (!userIsStaff) {
      const heldOffices = await db
        .select({ permissions: offices.permissions })
        .from(officeHolders)
        .innerJoin(offices, eq(officeHolders.officeId, offices.id))
        .where(
          and(
            eq(officeHolders.playerId, invokerPlayer.id),
            isNull(officeHolders.endDate),
          ),
        );

      hasAppointPermission = heldOffices.some((o) => {
        const perms = o.permissions as string[] | null;
        return perms?.includes('appoint_ministers');
      });
    }

    if (!userIsStaff && !hasAppointPermission) {
      await interaction.editReply({
        embeds: [errorEmbed('You need the `appoint_ministers` permission (or staff access) to use this command.')],
      });
      return;
    }

    // Resolve the office
    const officeName = interaction.options.getString('office', true);
    const reason = interaction.options.getString('reason') ?? undefined;

    const allOffices = await db
      .select()
      .from(offices)
      .where(eq(offices.isActive, true))
      .orderBy(asc(offices.sortOrder));

    const officeMatch = allOffices.find(
      (o) => o.name.toLowerCase() === officeName.toLowerCase(),
    ) ?? allOffices.find(
      (o) => o.name.toLowerCase().includes(officeName.toLowerCase()),
    );

    if (!officeMatch) {
      await interaction.editReply({ embeds: [errorEmbed(`No office matching "${officeName}" found.`)] });
      return;
    }

    // Find the current holder
    const [currentHolder] = await db
      .select({
        holderId: officeHolders.id,
        playerId: officeHolders.playerId,
        playerName: players.characterName,
        discordId: players.discordId,
        discordUsername: players.discordUsername,
      })
      .from(officeHolders)
      .innerJoin(players, eq(officeHolders.playerId, players.id))
      .where(
        and(
          eq(officeHolders.officeId, officeMatch.id),
          isNull(officeHolders.endDate),
        ),
      )
      .limit(1);

    if (!currentHolder) {
      await interaction.editReply({
        embeds: [errorEmbed(`Office "${officeMatch.name}" has no current holder.`)],
      });
      return;
    }

    // End the tenure
    await db
      .update(officeHolders)
      .set({
        endDate: new Date(),
        removalReason: reason ?? 'removed_by_appointer',
        removedById: invokerPlayer.id,
      })
      .where(eq(officeHolders.id, currentHolder.holderId));

    // Log the event
    await db.insert(playerEventLog).values({
      playerId: currentHolder.playerId,
      eventType: PlayerEventType.OFFICE_LEFT,
      description: `Removed from ${officeMatch.name}${reason ? `: ${reason}` : ''}`,
      oldValue: {
        officeId: officeMatch.id,
        officeName: officeMatch.name,
      },
      triggeredById: invokerPlayer.id,
    });

    // Remove Discord role if configured — but only if the player doesn't still
    // hold another active office that maps to the SAME role (best-effort).
    let roleSyncWarning: string | null = null;
    if (officeMatch.discordRoleId && interaction.guild) {
      const stillHolding = await db
        .select({ id: officeHolders.id })
        .from(officeHolders)
        .innerJoin(offices, eq(officeHolders.officeId, offices.id))
        .where(
          and(
            eq(officeHolders.playerId, currentHolder.playerId),
            isNull(officeHolders.endDate),
            eq(offices.discordRoleId, officeMatch.discordRoleId),
          ),
        )
        .limit(1);

      if (stillHolding.length === 0) {
        try {
          const guildMember = await interaction.guild.members.fetch(currentHolder.discordId);
          await guildMember.roles.remove(
            officeMatch.discordRoleId,
            `Hansard: dismissed from ${officeMatch.name}`,
          );
        } catch (roleError) {
          console.warn(
            `Failed to remove Discord role ${officeMatch.discordRoleId} for office ${officeMatch.name}:`,
            roleError,
          );
          roleSyncWarning =
            'Could not remove the linked Discord role. The bot likely needs a higher role in the server hierarchy than the role it manages.';
        }
      }
    }

    const holderName = currentHolder.playerName ?? currentHolder.discordUsername;
    const embed = successEmbed(
      'Holder Dismissed',
      [
        `**${holderName}** has been removed from **${officeMatch.name}**.`,
        reason ? `**Reason:** ${reason}` : '',
        roleSyncWarning ? `\n⚠️ ${roleSyncWarning}` : '',
      ].filter(Boolean).join('\n'),
    );

    await interaction.editReply({ embeds: [embed] });
  },

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await autocompleteOffice(interaction);
  },
};

export default command;
