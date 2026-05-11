import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, parties, factions, playerEventLog } from '@hansard/db';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';
import { autocompleteParty } from './_partyAutocomplete.js';

async function clearPartyLeaderIfMatches(partyId: string | null, playerId: string): Promise<void> {
  if (!partyId) return;

  await db
    .update(parties)
    .set({ leaderId: null })
    .where(and(
      eq(parties.id, partyId),
      eq(parties.leaderId, playerId),
    ));
}

async function handleJoin(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const partyInput = interaction.options.getString('party', true).trim();

  // Find the player
  const playerRows = await db
    .select()
    .from(players)
    .where(eq(players.discordId, interaction.user.id))
    .limit(1);

  if (playerRows.length === 0 || !playerRows[0].characterName) {
    await interaction.editReply({
      embeds: [
        errorEmbed('You haven\'t created a character yet. Use `/character create` first.'),
      ],
    });
    return;
  }

  const player = playerRows[0];

  // Find the target party. Autocomplete submits the party ID; hand-typed input
  // still works by full name or short name.
  const partyRows = await db
    .select()
    .from(parties)
    .where(eq(parties.isActive, true));

  const targetParty = partyRows.find(
    (p) => p.id === partyInput ||
           p.name.toLowerCase() === partyInput.toLowerCase() ||
           p.shortName?.toLowerCase() === partyInput.toLowerCase(),
  );

  if (!targetParty) {
    const available = partyRows.map((p) => `- ${p.name}${p.shortName ? ` (${p.shortName})` : ''}`).join('\n');
    await interaction.editReply({
      embeds: [
        errorEmbed(
          `No active party found matching **${partyInput}**.\n\n**Available parties:**\n${available || '*No parties available.*'}`,
        ),
      ],
    });
    return;
  }

  // Check if already in this party
  if (player.partyId === targetParty.id) {
    await interaction.editReply({
      embeds: [
        errorEmbed(`You're already a member of **${targetParty.name}**.`),
      ],
    });
    return;
  }

  if (targetParty.isInviteOnly) {
    await interaction.editReply({
      embeds: [
        errorEmbed(`**${targetParty.name}** is invite-only. Ask staff to add you to the party.`),
      ],
    });
    return;
  }

  // Get old party name for logging
  let oldPartyName = 'Independent';
  if (player.partyId) {
    const oldPartyRows = await db
      .select({ name: parties.name })
      .from(parties)
      .where(eq(parties.id, player.partyId))
      .limit(1);
    if (oldPartyRows.length > 0) oldPartyName = oldPartyRows[0].name;
  }

  // Update the player's party
  await db
    .update(players)
    .set({
      partyId: targetParty.id,
      lastActiveAt: new Date(),
    })
    .where(eq(players.id, player.id));

  await clearPartyLeaderIfMatches(player.partyId, player.id);

  // Log the event
  await db.insert(playerEventLog).values({
    playerId: player.id,
    eventType: 'party_change',
    description: `${player.characterName} left ${oldPartyName} and joined ${targetParty.name}.`,
    oldValue: { partyId: player.partyId, partyName: oldPartyName },
    newValue: { partyId: targetParty.id, partyName: targetParty.name },
    triggeredById: player.id,
  });

  // Discord role sync
  const member = interaction.guild?.members.cache.get(interaction.user.id);
  if (member) {
    // Remove old party role
    if (player.partyId) {
      const oldParty = await db
        .select({ discordRoleId: parties.discordRoleId })
        .from(parties)
        .where(eq(parties.id, player.partyId))
        .limit(1);

      if (oldParty[0]?.discordRoleId) {
        try {
          await member.roles.remove(oldParty[0].discordRoleId);
        } catch (err) {
          console.warn(`Failed to remove old party role: ${err}`);
        }
      }
    }

    // Add new party role
    if (targetParty.discordRoleId) {
      try {
        await member.roles.add(targetParty.discordRoleId);
      } catch (err) {
        console.warn(`Failed to add new party role: ${err}`);
      }
    }
  }

  await interaction.editReply({
    embeds: [
      successEmbed(
        'Party Joined',
        `**${player.characterName}** has joined **${targetParty.name}**.`,
      ),
    ],
  });
}

async function handleLeave(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  // Find the player
  const playerRows = await db
    .select()
    .from(players)
    .where(eq(players.discordId, interaction.user.id))
    .limit(1);

  if (playerRows.length === 0 || !playerRows[0].characterName) {
    await interaction.editReply({
      embeds: [
        errorEmbed('You haven\'t created a character yet. Use `/character create` first.'),
      ],
    });
    return;
  }

  const player = playerRows[0];

  if (!player.partyId) {
    await interaction.editReply({
      embeds: [errorEmbed('You\'re already independent (no party).')],
    });
    return;
  }

  // Get current party name
  let oldPartyName = 'Unknown';
  const oldPartyRows = await db
    .select({ name: parties.name, discordRoleId: parties.discordRoleId })
    .from(parties)
    .where(eq(parties.id, player.partyId))
    .limit(1);

  if (oldPartyRows.length > 0) oldPartyName = oldPartyRows[0].name;

  // Update player — clear partyId
  await db
    .update(players)
    .set({
      partyId: null,
      lastActiveAt: new Date(),
    })
    .where(eq(players.id, player.id));

  await clearPartyLeaderIfMatches(player.partyId, player.id);

  // Log the event
  await db.insert(playerEventLog).values({
    playerId: player.id,
    eventType: 'party_change',
    description: `${player.characterName} left ${oldPartyName} and became independent.`,
    oldValue: { partyId: player.partyId, partyName: oldPartyName },
    newValue: { partyId: null, partyName: 'Independent' },
    triggeredById: player.id,
  });

  // Remove Discord role
  const member = interaction.guild?.members.cache.get(interaction.user.id);
  if (member && oldPartyRows[0]?.discordRoleId) {
    try {
      await member.roles.remove(oldPartyRows[0].discordRoleId);
    } catch (err) {
      console.warn(`Failed to remove party role: ${err}`);
    }
  }

  await interaction.editReply({
    embeds: [
      successEmbed(
        'Party Left',
        `**${player.characterName}** has left **${oldPartyName}** and is now independent.`,
      ),
    ],
  });
}

async function handleAssign(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const member = interaction.member;
  if (!member || !('roles' in member)) {
    await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
    return;
  }
  if (!(await isStaff(member))) {
    await interaction.editReply({ embeds: [errorEmbed('Only staff can assign characters to parties.')] });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const partyInput = interaction.options.getString('party', true).trim();

  const [targetPlayer] = await db
    .select()
    .from(players)
    .where(eq(players.discordId, targetUser.id))
    .limit(1);

  if (!targetPlayer || !targetPlayer.characterName) {
    await interaction.editReply({ embeds: [errorEmbed(`${targetUser.username} has no registered character.`)] });
    return;
  }

  const [staffPlayer] = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.discordId, interaction.user.id))
    .limit(1);

  const partyRows = await db
    .select()
    .from(parties)
    .where(eq(parties.isActive, true));

  const targetParty = partyRows.find(
    (p) => p.id === partyInput ||
           p.name.toLowerCase() === partyInput.toLowerCase() ||
           p.shortName?.toLowerCase() === partyInput.toLowerCase(),
  );

  if (!targetParty) {
    const available = partyRows.map((p) => `- ${p.name}${p.shortName ? ` (${p.shortName})` : ''}`).join('\n');
    await interaction.editReply({
      embeds: [
        errorEmbed(
          `No active party found matching **${partyInput}**.\n\n**Available parties:**\n${available || '*No parties available.*'}`,
        ),
      ],
    });
    return;
  }

  if (targetPlayer.partyId === targetParty.id) {
    await interaction.editReply({
      embeds: [errorEmbed(`**${targetPlayer.characterName}** is already a member of **${targetParty.name}**.`)],
    });
    return;
  }

  let oldPartyName = 'Independent';
  let oldPartyRoleId: string | null = null;
  if (targetPlayer.partyId) {
    const [oldParty] = await db
      .select({ name: parties.name, discordRoleId: parties.discordRoleId })
      .from(parties)
      .where(eq(parties.id, targetPlayer.partyId))
      .limit(1);
    oldPartyName = oldParty?.name ?? 'Unknown';
    oldPartyRoleId = oldParty?.discordRoleId ?? null;
  }

  await db
    .update(players)
    .set({ partyId: targetParty.id })
    .where(eq(players.id, targetPlayer.id));

  await clearPartyLeaderIfMatches(targetPlayer.partyId, targetPlayer.id);

  await db.insert(playerEventLog).values({
    playerId: targetPlayer.id,
    eventType: 'party_change',
    description: `${targetPlayer.characterName} left ${oldPartyName} and joined ${targetParty.name} (staff action).`,
    oldValue: targetPlayer.partyId ? { partyId: targetPlayer.partyId, partyName: oldPartyName } : null,
    newValue: { partyId: targetParty.id, partyName: targetParty.name },
    triggeredById: staffPlayer?.id ?? null,
  });

  let roleSyncWarning: string | null = null;
  if (interaction.guild && (oldPartyRoleId || targetParty.discordRoleId)) {
    try {
      const targetMember = await interaction.guild.members.fetch(targetUser.id);
      if (oldPartyRoleId) await targetMember.roles.remove(oldPartyRoleId);
      if (targetParty.discordRoleId) await targetMember.roles.add(targetParty.discordRoleId);
    } catch (error) {
      console.warn(`Failed to sync party roles for ${targetPlayer.characterName}:`, error);
      roleSyncWarning = '\n\nDiscord role sync failed; run `/sync-roles` after checking the bot role hierarchy.';
    }
  }

  await interaction.editReply({
    embeds: [
      successEmbed(
        'Party Assigned',
        `**${targetPlayer.characterName}** has been moved from **${oldPartyName}** to **${targetParty.name}**.${roleSyncWarning ?? ''}`,
      ),
    ],
  });
}

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  // Fetch all active parties with member counts and faction info
  const partyRows = await db
    .select({
      id: parties.id,
      name: parties.name,
      shortName: parties.shortName,
      ideology: parties.ideology,
      colour: parties.colour,
      factionId: parties.factionId,
      isInviteOnly: parties.isInviteOnly,
    })
    .from(parties)
    .where(eq(parties.isActive, true));

  if (partyRows.length === 0) {
    await interaction.editReply({
      embeds: [
        createEmbed({
          title: 'Political Parties',
          description: '*No active parties exist yet.*',
          system: 'players',
        }),
      ],
    });
    return;
  }

  // Count members per party
  const memberCounts = await db
    .select({
      partyId: players.partyId,
      count: sql<number>`count(*)::int`,
    })
    .from(players)
    .where(eq(players.isActive, true))
    .groupBy(players.partyId);

  const countMap = new Map(memberCounts.map((mc) => [mc.partyId, mc.count]));

  // Fetch faction names for display
  const factionIds = [...new Set(partyRows.map((p) => p.factionId).filter(Boolean))];
  const factionMap = new Map<string, string>();

  if (factionIds.length > 0) {
    const factionRows = await db
      .select({ id: factions.id, name: factions.name })
      .from(factions);

    for (const f of factionRows) {
      factionMap.set(f.id, f.name);
    }
  }

  // Build party list
  const partyLines = partyRows.map((p) => {
    const members = countMap.get(p.id) ?? 0;
    const faction = p.factionId ? factionMap.get(p.factionId) ?? 'Unknown' : 'Cross-faction';
    const ideology = p.ideology ? ` — *${p.ideology}*` : '';
    return [
      `**${p.name}**${p.shortName ? ` (${p.shortName})` : ''}`,
      `> ${faction}${ideology}`,
      `> Members: **${members}**${p.isInviteOnly ? ' · invite-only' : ''}`,
    ].join('\n');
  });

  // Count independents
  const independentCount = countMap.get(null) ?? 0;

  const embed = createEmbed({
    title: 'Political Parties',
    description: partyLines.join('\n\n'),
    system: 'players',
    fields: [
      {
        name: 'Independents',
        value: `**${independentCount}** player${independentCount === 1 ? '' : 's'} without party affiliation.`,
      },
    ],
  });

  await interaction.editReply({ embeds: [embed] });
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('party')
    .setDescription('Party management')
    .addSubcommand((sub) =>
      sub
        .setName('join')
        .setDescription('Join a political party')
        .addStringOption((opt) =>
          opt
            .setName('party')
            .setDescription('The party name to join')
            .setRequired(true)
            .setMaxLength(128)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('leave').setDescription('Leave your current party and become independent'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('assign')
        .setDescription('Assign another character to a party (staff only)')
        .addUserOption((opt) =>
          opt
            .setName('user')
            .setDescription('The character owner to assign')
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('party')
            .setDescription('The party to assign')
            .setRequired(true)
            .setMaxLength(128)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List all active parties with member counts'),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'join':
        await handleJoin(interaction);
        break;
      case 'leave':
        await handleLeave(interaction);
        break;
      case 'assign':
        await handleAssign(interaction);
        break;
      case 'list':
        await handleList(interaction);
        break;
    }
  },

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await autocompleteParty(interaction);
  },
};

export default command;
