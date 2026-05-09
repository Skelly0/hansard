import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, parties, factions, playerEventLog, simulationClock } from '@hansard/db';
import { PlayerEventType, birthDateForAge } from '@hansard/shared';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

const MIN_AGE = 18;
const MAX_AGE = 90;

async function handleCharacterCreate(interaction: ChatInputCommandInteraction): Promise<void> {
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
  const characterName = interaction.options.getString('character-name', true).trim();
  const startingAge = interaction.options.getInteger('starting-age', true);
  const characterBio = interaction.options.getString('bio')?.trim() || null;
  const portraitUrl = interaction.options.getString('portrait-url')?.trim() || null;
  const factionName = interaction.options.getString('faction')?.trim() || null;
  const partyName = interaction.options.getString('party')?.trim() || null;

  if (startingAge < MIN_AGE || startingAge > MAX_AGE) {
    await interaction.editReply({ embeds: [errorEmbed(`Starting age must be between ${MIN_AGE} and ${MAX_AGE}.`)] });
    return;
  }

  // Check existing
  const [existing] = await db
    .select({ id: players.id, characterName: players.characterName })
    .from(players)
    .where(eq(players.discordId, targetUser.id))
    .limit(1);

  if (existing?.characterName) {
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
  const simNow = clock?.currentDate ?? `${new Date().getUTCFullYear()}-01-01`;
  const birthDate = birthDateForAge(simNow, startingAge);

  try {
    let playerId: string;
    if (existing) {
      playerId = existing.id;
      await db
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
          isActive: true,
        })
        .where(eq(players.id, playerId));
    } else {
      const [created] = await db
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
        })
        .returning({ id: players.id });
      playerId = created.id;
    }

    const [staffPlayer] = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);

    await db.insert(playerEventLog).values({
      playerId,
      eventType: PlayerEventType.REGISTRATION,
      description: `${characterName} registered by staff (age ${startingAge}, faction: ${factionDisplay}, party: ${partyDisplay}).`,
      newValue: { characterName, startingAge, factionId, partyId, createdByStaff: true },
      triggeredById: staffPlayer?.id ?? null,
    });

    const embed = successEmbed(
      'Character Created (Staff)',
      [
        `**${characterName}** has been registered for ${targetUser.toString()}.`,
        `**Age:** ${startingAge}`,
        `**Faction:** ${factionDisplay}`,
        `**Party:** ${partyDisplay}`,
      ].join('\n'),
    );
    if (portraitUrl) embed.setThumbnail(portraitUrl);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create character';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
  }
}

async function handleChangeParty(interaction: ChatInputCommandInteraction): Promise<void> {
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

  // Old party name for log
  let oldPartyName: string | null = null;
  if (target.partyId) {
    const [oldParty] = await db.select({ name: parties.name }).from(parties).where(eq(parties.id, target.partyId)).limit(1);
    oldPartyName = oldParty?.name ?? null;
  }

  let newPartyId: string | null = null;
  let newPartyName: string | null = null;

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
  }

  if (newPartyId === target.partyId) {
    await interaction.editReply({ embeds: [errorEmbed(`${target.characterName} is already in that party.`)] });
    return;
  }

  await db
    .update(players)
    .set({ partyId: newPartyId })
    .where(eq(players.id, target.id));

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

  const embed = createEmbed({
    title: 'Party Changed (Staff)',
    system: 'players',
    fields: [
      { name: 'Player', value: `**${target.characterName}** (${targetUser.toString()})`, inline: true },
      { name: 'From', value: oldPartyName ?? '*Independent*', inline: true },
      { name: 'To', value: newPartyName ?? '*Independent*', inline: true },
      { name: 'Staff', value: interaction.user.toString(), inline: true },
    ],
  });

  await interaction.editReply({ embeds: [embed] });
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('player-admin')
    .setDescription('Staff player administration')
    .addSubcommand((sub) =>
      sub
        .setName('character-create')
        .setDescription('Create a character on behalf of another user (staff only)')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The user to create a character for').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('character-name').setDescription('Character name').setRequired(true).setMaxLength(128),
        )
        .addIntegerOption((opt) =>
          opt.setName('starting-age').setDescription(`Starting age (${MIN_AGE}-${MAX_AGE})`).setRequired(true).setMinValue(MIN_AGE).setMaxValue(MAX_AGE),
        )
        .addStringOption((opt) =>
          opt.setName('faction').setDescription('Faction name').setRequired(false).setMaxLength(128),
        )
        .addStringOption((opt) =>
          opt.setName('party').setDescription('Party name').setRequired(false).setMaxLength(128),
        )
        .addStringOption((opt) =>
          opt.setName('bio').setDescription('Character biography').setRequired(false).setMaxLength(2000),
        )
        .addStringOption((opt) =>
          opt.setName('portrait-url').setDescription('Portrait image URL').setRequired(false).setMaxLength(512),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('change-party')
        .setDescription('Change another player\'s party (staff only)')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The player whose party to change').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('party').setDescription('Party name (or "independent")').setRequired(true).setMaxLength(128),
        ),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand(true);
    switch (sub) {
      case 'character-create':
        return handleCharacterCreate(interaction);
      case 'change-party':
        return handleChangeParty(interaction);
      default:
        await interaction.reply({ embeds: [errorEmbed(`Unknown subcommand: ${sub}`)], ephemeral: true });
    }
  },
};

export default command;
