import type { ChatInputCommandInteraction } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, parties, factions, playerEventLog, simulationClock } from '@hansard/db';
import {
  DEFAULT_SIMULATION_CURRENT_DATE,
  PlayerEventType,
  birthDateForAge,
  buildArchivedCharacter,
  profileDataWithArchive,
  validateCharacterName,
} from '@hansard/shared';
import { calculateStartingAgeFavourBonus } from '@hansard/api/services/playerService';
import {
  grantStartingFactionFavours,
  type StartingFactionFavourGrant,
} from '@hansard/api/services/favourService';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import { postStaffActionLog } from '../../utils/modLog.js';
import { clearPartyLeaderIfMatches } from '../party/shared.js';

export const ADMIN_MIN_AGE = 18;
export const ADMIN_MAX_AGE = 90;
const MIN_AGE = ADMIN_MIN_AGE;
const MAX_AGE = ADMIN_MAX_AGE;

export async function executeCharacterCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const member = interaction.member;
  if (!member || !('roles' in member)) {
    await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
    return;
  }
  if (!(await isStaff(member))) {
    await interaction.editReply({ embeds: [errorEmbed('Only staff can create characters for other users.')] });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const rawCharacterName = interaction.options.getString('character-name', true);
  const nameValidation = validateCharacterName(rawCharacterName);
  if (!nameValidation.ok) {
    await interaction.editReply({
      embeds: [errorEmbed(nameValidation.error ?? 'Invalid character name.')],
    });
    return;
  }
  const characterName = nameValidation.normalized!;
  const startingAge = interaction.options.getInteger('starting-age', true);
  const characterBio = interaction.options.getString('bio')?.trim() || null;
  const portraitUrl = interaction.options.getString('portrait-url')?.trim() || null;
  const factionName = interaction.options.getString('faction')?.trim() || null;
  const partyName = interaction.options.getString('party')?.trim() || null;

  if (startingAge < MIN_AGE || startingAge > MAX_AGE) {
    await interaction.editReply({ embeds: [errorEmbed(`Starting age must be between ${MIN_AGE} and ${MAX_AGE}.`)] });
    return;
  }

  // Check existing. A *living* character on the target player row blocks
  // creation; a dead character is archived and the row is reset to the new
  // character (same reincarnation rule as /character create).
  const [existing] = await db
    .select()
    .from(players)
    .where(eq(players.discordId, targetUser.id))
    .limit(1);

  if (existing?.characterName && existing.isAlive) {
    await interaction.editReply({
      embeds: [errorEmbed(`${targetUser.username} already has a character: **${existing.characterName}**.`)],
    });
    return;
  }

  // Resolve faction
  let factionId: string | null = null;
  let factionDisplay = 'None';
  if (factionName) {
    const allFactions = await db.select().from(factions).where(eq(factions.isActive, true));
    const faction = allFactions.find((f) => f.name.toLowerCase() === factionName.toLowerCase())
      ?? allFactions.find((f) => f.name.toLowerCase().includes(factionName.toLowerCase()));
    if (!faction) {
      await interaction.editReply({ embeds: [errorEmbed(`Faction "${factionName}" not found.`)] });
      return;
    }
    factionId = faction.id;
    factionDisplay = faction.name;
  }

  // Resolve party
  let partyId: string | null = null;
  let partyDisplay = 'Independent';
  if (partyName) {
    const allParties = await db.select().from(parties).where(eq(parties.isActive, true));
    const party = allParties.find((p) => p.name.toLowerCase() === partyName.toLowerCase())
      ?? allParties.find((p) => p.name.toLowerCase().includes(partyName.toLowerCase()));
    if (!party) {
      await interaction.editReply({ embeds: [errorEmbed(`Party "${partyName}" not found.`)] });
      return;
    }
    partyId = party.id;
    partyDisplay = party.name;
  }

  // Check name uniqueness
  const [nameTaken] = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.characterName, characterName))
    .limit(1);
  if (nameTaken && nameTaken.id !== existing?.id) {
    await interaction.editReply({ embeds: [errorEmbed(`Character name **${characterName}** is already taken.`)] });
    return;
  }

  const [clock] = await db.select().from(simulationClock).limit(1);
  const simNow = clock?.currentDate ?? DEFAULT_SIMULATION_CURRENT_DATE;
  const birthDate = birthDateForAge(simNow, startingAge);
  const favourBonus = calculateStartingAgeFavourBonus(startingAge);

  try {
    const [staffPlayer] = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);

    const creationResult = await db.transaction(async (tx) => {
      let playerId = '';
      let startingFavourGrant: StartingFactionFavourGrant | null = null;
      let isReincarnation = false;
      let previousCharacterName: string | null = null;

      if (existing) {
        playerId = existing.id;

        if (existing.characterName && existing.isAlive) {
          // Race with another staff action — re-check inside the transaction.
          throw new Error('TARGET_PLAYER_ALREADY_ALIVE');
        }

        if (existing.characterName && !existing.isAlive) {
          isReincarnation = true;
          previousCharacterName = existing.characterName;
          const archive = buildArchivedCharacter(existing);
          const newProfileData = profileDataWithArchive(existing.profileData, archive);

          const [updated] = await tx
            .update(players)
            .set({
              discordUsername: targetUser.username,
              characterName,
              characterBio,
              characterPortraitUrl: portraitUrl,
              startingAge,
              currentAge: startingAge,
              birthDate,
              factionId,
              partyId,
              deathDate: null,
              causeOfDeath: null,
              isAlive: true,
              healthStatus: 'healthy',
              ailments: [],
              startingFavoursGranted: false,
              isActive: true,
              profileData: newProfileData,
            })
            .where(and(eq(players.id, playerId), eq(players.isAlive, false)))
            .returning({ id: players.id });

          if (!updated) {
            throw new Error('TARGET_PLAYER_ALREADY_ALIVE');
          }
        } else {
          await tx
            .update(players)
            .set({
              discordUsername: targetUser.username,
              characterName,
              characterBio,
              characterPortraitUrl: portraitUrl,
              startingAge,
              currentAge: startingAge,
              birthDate,
              factionId,
              partyId,
              startingFavoursGranted: false,
              isActive: true,
            })
            .where(eq(players.id, playerId));
        }
      } else {
        const [created] = await tx
          .insert(players)
          .values({
            discordId: targetUser.id,
            discordUsername: targetUser.username,
            characterName,
            characterBio,
            characterPortraitUrl: portraitUrl,
            startingAge,
            currentAge: startingAge,
            birthDate,
            factionId,
            partyId,
            startingFavoursGranted: false,
          })
          .returning({ id: players.id });
        playerId = created.id;
      }

      const eventDescription = isReincarnation
        ? `${characterName} registered by staff as the successor to **${previousCharacterName}** (age ${startingAge}, faction: ${factionDisplay}, party: ${partyDisplay}).`
        : `${characterName} registered by staff (age ${startingAge}, faction: ${factionDisplay}, party: ${partyDisplay}).`;
      await tx.insert(playerEventLog).values({
        playerId,
        eventType: isReincarnation ? PlayerEventType.REINCARNATION : PlayerEventType.REGISTRATION,
        description: eventDescription,
        newValue: {
          characterName,
          startingAge,
          factionId,
          partyId,
          createdByStaff: true,
          ...(isReincarnation ? { previousCharacterName } : {}),
        },
        triggeredById: staffPlayer?.id ?? null,
      });

      if (favourBonus > 0) {
        startingFavourGrant = await grantStartingFactionFavours(tx, playerId, factionId, favourBonus);
        if (startingFavourGrant) {
          await tx
            .update(players)
            .set({ startingFavoursGranted: true })
            .where(eq(players.id, playerId));
        }
      }

      return { playerId, startingFavourGrant, isReincarnation, previousCharacterName };
    });
    const { startingFavourGrant, isReincarnation, previousCharacterName } = creationResult;

    const embed = successEmbed(
      isReincarnation ? 'Successor Registered (Staff)' : 'Character Created (Staff)',
      [
        isReincarnation && previousCharacterName
          ? `**${characterName}** has been registered as ${targetUser.toString()}'s successor to **${previousCharacterName}**.`
          : `**${characterName}** has been registered for ${targetUser.toString()}.`,
        `**Age:** ${startingAge}`,
        `**Faction:** ${factionDisplay}`,
        `**Party:** ${partyDisplay}`,
        ...(favourBonus > 0
          ? [
              startingFavourGrant
                ? `**Starting Favours:** ${favourBonus} applied to ${startingFavourGrant.categoryName}`
                : `**Starting Favours:** ${favourBonus} recorded; no active favour category matched ${factionDisplay}`,
            ]
          : []),
      ].join('\n'),
    );
    if (portraitUrl) embed.setThumbnail(portraitUrl);
    await postStaffActionLog(interaction, {
      title: isReincarnation ? 'Character Successor Registered' : 'Character Created',
      system: 'players',
      fields: [
        { name: 'User', value: targetUser.toString(), inline: true },
        { name: 'Character', value: characterName, inline: true },
        { name: 'Age', value: `${startingAge}`, inline: true },
        { name: 'Faction', value: factionDisplay, inline: true },
        { name: 'Party', value: partyDisplay, inline: true },
        ...(favourBonus > 0 ? [{ name: 'Starting Favours', value: `${favourBonus}`, inline: true }] : []),
      ],
    });
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    const raw = error instanceof Error ? error.message : 'Failed to create character';
    const message = raw === 'TARGET_PLAYER_ALREADY_ALIVE'
      ? `${targetUser.username} already has a living character. Refresh and try again.`
      : raw;
    await interaction.editReply({ embeds: [errorEmbed(message)] });
  }
}

export async function executeChangeParty(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const member = interaction.member;
  if (!member || !('roles' in member)) {
    await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
    return;
  }
  if (!(await isStaff(member))) {
    await interaction.editReply({ embeds: [errorEmbed('Only staff can change another player\'s party.')] });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const partyArg = interaction.options.getString('party', true).trim();

  const [target] = await db
    .select()
    .from(players)
    .where(eq(players.discordId, targetUser.id))
    .limit(1);
  if (!target || !target.characterName) {
    await interaction.editReply({ embeds: [errorEmbed(`${targetUser.username} has no registered character.`)] });
    return;
  }

  const [staffPlayer] = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.discordId, interaction.user.id))
    .limit(1);
  if (!staffPlayer) {
    await interaction.editReply({ embeds: [errorEmbed('You are not registered as a player.')] });
    return;
  }

  // Old party name + role for log and Discord sync
  let oldPartyName: string | null = null;
  let oldPartyRoleId: string | null = null;
  if (target.partyId) {
    const [oldParty] = await db
      .select({ name: parties.name, discordRoleId: parties.discordRoleId })
      .from(parties)
      .where(eq(parties.id, target.partyId))
      .limit(1);
    oldPartyName = oldParty?.name ?? null;
    oldPartyRoleId = oldParty?.discordRoleId ?? null;
  }

  let newPartyId: string | null = null;
  let newPartyName: string | null = null;
  let newPartyRoleId: string | null = null;

  if (partyArg.toLowerCase() === 'independent' || partyArg.toLowerCase() === 'none') {
    newPartyId = null;
    newPartyName = null;
  } else {
    const allParties = await db.select().from(parties).where(eq(parties.isActive, true));
    const party = allParties.find((p) => p.name.toLowerCase() === partyArg.toLowerCase())
      ?? allParties.find((p) => p.name.toLowerCase().includes(partyArg.toLowerCase()));
    if (!party) {
      await interaction.editReply({ embeds: [errorEmbed(`Party "${partyArg}" not found.`)] });
      return;
    }
    newPartyId = party.id;
    newPartyName = party.name;
    newPartyRoleId = party.discordRoleId;
  }

  if (newPartyId === target.partyId) {
    await interaction.editReply({ embeds: [errorEmbed(`${target.characterName} is already in that party.`)] });
    return;
  }

  await db
    .update(players)
    .set({ partyId: newPartyId })
    .where(eq(players.id, target.id));

  await clearPartyLeaderIfMatches(target.partyId, target.id);

  await db.insert(playerEventLog).values({
    playerId: target.id,
    eventType: PlayerEventType.PARTY_CHANGE,
    description: newPartyName
      ? oldPartyName
        ? `Left ${oldPartyName} and joined ${newPartyName} (staff action).`
        : `Joined ${newPartyName} (staff action).`
      : `Left ${oldPartyName ?? 'their party'} (now independent, staff action).`,
    oldValue: target.partyId ? { partyId: target.partyId, partyName: oldPartyName } : null,
    newValue: newPartyId ? { partyId: newPartyId, partyName: newPartyName } : null,
    triggeredById: staffPlayer.id,
  });

  let roleSyncWarning: string | null = null;
  if (interaction.guild && (oldPartyRoleId || newPartyRoleId)) {
    try {
      const targetMember = await interaction.guild.members.fetch(targetUser.id);
      if (oldPartyRoleId) await targetMember.roles.remove(oldPartyRoleId);
      if (newPartyRoleId) await targetMember.roles.add(newPartyRoleId);
    } catch (error) {
      console.warn(`Failed to sync party roles for ${target.characterName}:`, error);
      roleSyncWarning = 'Discord role sync failed; check the bot role hierarchy.';
    }
  }

  const embed = createEmbed({
    title: 'Party Changed (Staff)',
    system: 'players',
    fields: [
      { name: 'Player', value: `**${target.characterName}** (${targetUser.toString()})`, inline: true },
      { name: 'From', value: oldPartyName ?? '*Independent*', inline: true },
      { name: 'To', value: newPartyName ?? '*Independent*', inline: true },
      { name: 'Staff', value: interaction.user.toString(), inline: true },
      ...(roleSyncWarning ? [{ name: 'Warning', value: roleSyncWarning, inline: false }] : []),
    ],
  });

  await postStaffActionLog(interaction, {
    title: 'Player Party Changed',
    system: 'players',
    fields: [
      { name: 'Player', value: `**${target.characterName}** (${targetUser.toString()})`, inline: true },
      { name: 'From', value: oldPartyName ?? 'Independent', inline: true },
      { name: 'To', value: newPartyName ?? 'Independent', inline: true },
      ...(roleSyncWarning ? [{ name: 'Warning', value: roleSyncWarning }] : []),
    ],
  });
  await interaction.editReply({ embeds: [embed] });
}

