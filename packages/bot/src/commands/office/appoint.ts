import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
} from 'discord.js';
import { eq, and, isNull, asc } from 'drizzle-orm';
import { offices, officeHolders, players, playerEventLog } from '@hansard/db';
import { PlayerEventType } from '@hansard/shared';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import { autocompleteOffice } from './_officeAutocomplete.js';
import { postStaffActionLog } from '../../utils/modLog.js';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const member = interaction.member;
  if (!member || !('roles' in member)) {
    await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
    return;
  }

  const userIsStaff = await isStaff(member);

  const [invokerPlayer] = await db
    .select()
    .from(players)
    .where(eq(players.discordId, interaction.user.id))
    .limit(1);

  if (!invokerPlayer) {
    await interaction.editReply({ embeds: [errorEmbed('You are not registered as a player.')] });
    return;
  }

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

  const officeName = interaction.options.getString('office', true);
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

  const targetUser = interaction.options.getUser('user', true);
  const [targetPlayer] = await db
    .select()
    .from(players)
    .where(eq(players.discordId, targetUser.id))
    .limit(1);

  if (!targetPlayer) {
    await interaction.editReply({
      embeds: [errorEmbed(`${targetUser.username} is not registered as a player.`)],
    });
    return;
  }

  if (!targetPlayer.isAlive) {
    await interaction.editReply({
      embeds: [errorEmbed('Cannot appoint a deceased character to office.')],
    });
    return;
  }

  const [existingHolding] = await db
    .select()
    .from(officeHolders)
    .where(
      and(
        eq(officeHolders.officeId, officeMatch.id),
        eq(officeHolders.playerId, targetPlayer.id),
        isNull(officeHolders.endDate),
      ),
    )
    .limit(1);

  if (existingHolding) {
    const name = targetPlayer.characterName ?? targetUser.username;
    await interaction.editReply({
      embeds: [errorEmbed(`${name} already holds the office of ${officeMatch.name}.`)],
    });
    return;
  }

  const currentHolders = await db
    .select()
    .from(officeHolders)
    .where(
      and(
        eq(officeHolders.officeId, officeMatch.id),
        isNull(officeHolders.endDate),
      ),
    );

  if (currentHolders.length >= officeMatch.maxHolders) {
    await interaction.editReply({
      embeds: [errorEmbed(
        `Office "${officeMatch.name}" already has ${currentHolders.length}/${officeMatch.maxHolders} holders. Dismiss the current holder first.`,
      )],
    });
    return;
  }

  await db.insert(officeHolders).values({
    officeId: officeMatch.id,
    playerId: targetPlayer.id,
    appointedBy: invokerPlayer.id,
    appointmentMethod: 'appointed',
  });

  await db.insert(playerEventLog).values({
    playerId: targetPlayer.id,
    eventType: PlayerEventType.OFFICE_APPOINTED,
    description: `Appointed to ${officeMatch.name}`,
    newValue: {
      officeId: officeMatch.id,
      officeName: officeMatch.name,
      appointedById: invokerPlayer.id,
    },
    triggeredById: invokerPlayer.id,
  });

  let roleSyncWarning: string | null = null;
  if (officeMatch.discordRoleId && interaction.guild) {
    try {
      const guildMember = await interaction.guild.members.fetch(targetUser.id);
      await guildMember.roles.add(
        officeMatch.discordRoleId,
        `Hansard: appointed to ${officeMatch.name}`,
      );
    } catch (roleError) {
      console.warn(
        `Failed to grant Discord role ${officeMatch.discordRoleId} for office ${officeMatch.name}:`,
        roleError,
      );
      roleSyncWarning =
        'Could not assign the linked Discord role. The bot likely needs a higher role in the server hierarchy than the role it manages.';
    }
  }

  const playerName = targetPlayer.characterName ?? targetUser.username;
  const description = [
    `**${playerName}** has been appointed to **${officeMatch.name}**.`,
    roleSyncWarning ? `\n⚠️ ${roleSyncWarning}` : '',
  ].filter(Boolean).join('');

  const embed = successEmbed('Appointment Confirmed', description);

  await postStaffActionLog(interaction, {
    title: 'Office Holder Appointed',
    system: 'offices',
    fields: [
      { name: 'Player', value: `**${playerName}** (<@${targetUser.id}>)`, inline: true },
      { name: 'Office', value: officeMatch.name, inline: true },
      ...(roleSyncWarning ? [{ name: 'Warning', value: roleSyncWarning }] : []),
    ],
  });
  await interaction.editReply({ embeds: [embed] });
}

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await autocompleteOffice(interaction);
}
