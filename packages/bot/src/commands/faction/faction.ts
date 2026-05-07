import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { eq, and, asc, sql } from 'drizzle-orm';
import { factions, parties, players, playerEventLog } from '@hansard/db';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

function parseHexColour(hex: string | null | undefined): number | undefined {
  if (!hex) return undefined;
  const cleaned = hex.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return undefined;
  return parseInt(cleaned, 16);
}

async function findFactionByQuery(query: string, activeOnly = false) {
  const rows = activeOnly
    ? await db.select().from(factions).where(eq(factions.isActive, true)).orderBy(asc(factions.name))
    : await db.select().from(factions).orderBy(asc(factions.name));
  const lower = query.toLowerCase();
  return (
    rows.find((f) => f.name.toLowerCase() === lower) ??
    rows.find((f) => f.shortName?.toLowerCase() === lower) ??
    rows.find((f) => f.name.toLowerCase().includes(lower)) ??
    null
  );
}

async function handleCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !('roles' in member)) {
    await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
    return;
  }
  if (!(await isStaff(member))) {
    await interaction.editReply({ embeds: [errorEmbed('Only staff can create factions.')] });
    return;
  }

  const name = interaction.options.getString('name', true).trim();
  const shortName = interaction.options.getString('short-name')?.trim() || null;
  const description = interaction.options.getString('description')?.trim() || null;
  const colour = interaction.options.getString('colour')?.trim() || null;
  const discordRole = interaction.options.getRole('discord-role');

  if (colour && !/^#[0-9a-fA-F]{6}$/.test(colour)) {
    await interaction.editReply({ embeds: [errorEmbed('Colour must be a 6-digit hex like `#b94a48`.')] });
    return;
  }

  try {
    const [faction] = await db
      .insert(factions)
      .values({
        name,
        shortName,
        description,
        colour,
        discordRoleId: discordRole?.id ?? null,
        isActive: true,
      })
      .returning();

    const lines = [
      `**${faction.name}**${faction.shortName ? ` (${faction.shortName})` : ''}`,
      faction.description ? `*${faction.description}*` : '',
      faction.colour ? `Colour: \`${faction.colour}\`` : '',
      faction.discordRoleId ? `Role: <@&${faction.discordRoleId}>` : '',
      `\nID: \`${faction.id}\``,
    ].filter(Boolean).join('\n');

    await interaction.editReply({ embeds: [successEmbed('Faction Founded', lines)] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create faction';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
  }
}

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const factionRows = await db
    .select()
    .from(factions)
    .where(eq(factions.isActive, true))
    .orderBy(asc(factions.name));

  if (factionRows.length === 0) {
    await interaction.editReply({
      embeds: [
        createEmbed({
          title: 'Active Factions',
          description: '*No active factions exist yet. Create one with `/faction create`.*',
          system: 'offices',
        }),
      ],
    });
    return;
  }

  const playerCounts = await db
    .select({ factionId: players.factionId, count: sql<number>`count(*)::int` })
    .from(players)
    .where(eq(players.isActive, true))
    .groupBy(players.factionId);
  const playerMap = new Map<string | null, number>();
  for (const c of playerCounts) playerMap.set(c.factionId, c.count);

  const partyCounts = await db
    .select({ factionId: parties.factionId, count: sql<number>`count(*)::int` })
    .from(parties)
    .where(eq(parties.isActive, true))
    .groupBy(parties.factionId);
  const partyMap = new Map<string | null, number>();
  for (const c of partyCounts) partyMap.set(c.factionId, c.count);

  const lines = factionRows.map((f) => {
    const memberCount = playerMap.get(f.id) ?? 0;
    const partyCount = partyMap.get(f.id) ?? 0;
    const colourSwatch = f.colour ? ` \`${f.colour}\`` : '';
    const roleMention = f.discordRoleId ? ` <@&${f.discordRoleId}>` : '';
    const desc = f.description ? `\n> *${f.description}*` : '';
    return [
      `**${f.name}**${f.shortName ? ` (${f.shortName})` : ''}${colourSwatch}${roleMention}`,
      `> Parties: **${partyCount}** · Members: **${memberCount}**${desc}`,
    ].join('\n');
  });

  const embed = createEmbed({
    title: 'Active Factions',
    description: lines.join('\n\n').slice(0, 4000),
    system: 'offices',
  });

  if (factionRows.length === 1) {
    const tint = parseHexColour(factionRows[0].colour);
    if (tint !== undefined) embed.setColor(tint);
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleInfo(interaction: ChatInputCommandInteraction): Promise<void> {
  const query = interaction.options.getString('faction', true);
  const target = await findFactionByQuery(query);

  if (!target) {
    await interaction.editReply({ embeds: [errorEmbed(`No faction matching "${query}" found.`)] });
    return;
  }

  const partyRows = await db
    .select({ name: parties.name, shortName: parties.shortName, isActive: parties.isActive })
    .from(parties)
    .where(eq(parties.factionId, target.id))
    .orderBy(asc(parties.name));

  const memberRows = await db
    .select({
      characterName: players.characterName,
      discordUsername: players.discordUsername,
      discordId: players.discordId,
    })
    .from(players)
    .where(and(eq(players.factionId, target.id), eq(players.isActive, true)))
    .orderBy(asc(players.characterName));

  const partyLines = partyRows.length === 0
    ? '*No parties affiliated.*'
    : partyRows
        .map((p) => `• **${p.name}**${p.shortName ? ` (${p.shortName})` : ''}${p.isActive ? '' : ' *(dissolved)*'}`)
        .join('\n').slice(0, 1024);

  const memberLines = memberRows.length === 0
    ? '*No active members.*'
    : memberRows.map((m) => `• <@${m.discordId}> — ${m.characterName ?? m.discordUsername}`).join('\n').slice(0, 1024);

  const meta = [
    target.shortName ? `**Tag:** ${target.shortName}` : '',
    target.description ? `**Description:** ${target.description}` : '',
    target.colour ? `**Colour:** \`${target.colour}\`` : '',
    target.discordRoleId ? `**Role:** <@&${target.discordRoleId}>` : '',
    target.isActive ? '' : '**Status:** Dissolved',
  ].filter(Boolean).join('\n');

  const embed = createEmbed({
    title: `${target.name}${target.isActive ? '' : ' (Dissolved)'}`,
    description: meta || '*No metadata.*',
    system: 'offices',
    fields: [
      { name: `Parties (${partyRows.length})`, value: partyLines },
      { name: `Members (${memberRows.length})`, value: memberLines },
    ],
  });

  const tint = parseHexColour(target.colour);
  if (tint !== undefined) embed.setColor(tint);

  await interaction.editReply({ embeds: [embed] });
}

async function handleEdit(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !('roles' in member)) {
    await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
    return;
  }
  if (!(await isStaff(member))) {
    await interaction.editReply({ embeds: [errorEmbed('Only staff can edit factions.')] });
    return;
  }

  const query = interaction.options.getString('faction', true);
  const target = await findFactionByQuery(query);

  if (!target) {
    await interaction.editReply({ embeds: [errorEmbed(`No faction matching "${query}" found.`)] });
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

  const description = clearable(interaction.options.getString('description'));
  if (description !== undefined) updates.description = description;

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

  const active = interaction.options.getBoolean('active');
  if (active !== null) updates.isActive = active;

  if (Object.keys(updates).length === 0) {
    await interaction.editReply({ embeds: [errorEmbed('No fields to update. Provide at least one option.')] });
    return;
  }

  try {
    const [updated] = await db
      .update(factions)
      .set(updates)
      .where(eq(factions.id, target.id))
      .returning();

    const changed = Object.keys(updates).join(', ');
    await interaction.editReply({
      embeds: [successEmbed(
        'Faction Updated',
        `**${updated.name}**\nFields changed: \`${changed}\``,
      )],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update faction';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
  }
}

async function handleDissolve(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !('roles' in member)) {
    await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
    return;
  }
  if (!(await isStaff(member))) {
    await interaction.editReply({ embeds: [errorEmbed('Only staff can dissolve factions.')] });
    return;
  }

  const confirm = interaction.options.getBoolean('confirm', true);
  if (!confirm) {
    await interaction.editReply({ embeds: [errorEmbed('Pass `confirm:true` — dissolution unassigns every player and party in the faction.')] });
    return;
  }

  const query = interaction.options.getString('faction', true);
  const target = await findFactionByQuery(query, true);

  if (!target) {
    await interaction.editReply({ embeds: [errorEmbed(`No active faction matching "${query}" found.`)] });
    return;
  }

  try {
    const memberRows = await db
      .select({ id: players.id })
      .from(players)
      .where(and(eq(players.factionId, target.id), eq(players.isActive, true)));

    if (memberRows.length > 0) {
      await db
        .update(players)
        .set({ factionId: null })
        .where(eq(players.factionId, target.id));

      for (const m of memberRows) {
        await db.insert(playerEventLog).values({
          playerId: m.id,
          eventType: 'faction_change',
          description: `Faction "${target.name}" was dissolved`,
          oldValue: { factionId: target.id, factionName: target.name },
          newValue: { factionId: null, factionName: null },
          isAutomatic: false,
        });
      }
    }

    const partyRows = await db
      .select({ id: parties.id })
      .from(parties)
      .where(eq(parties.factionId, target.id));

    if (partyRows.length > 0) {
      await db
        .update(parties)
        .set({ factionId: null })
        .where(eq(parties.factionId, target.id));
    }

    await db
      .update(factions)
      .set({ isActive: false })
      .where(eq(factions.id, target.id));

    await interaction.editReply({
      embeds: [successEmbed(
        'Faction Dissolved',
        `**${target.name}** has been dissolved. ${memberRows.length} member${memberRows.length === 1 ? '' : 's'} and ${partyRows.length} part${partyRows.length === 1 ? 'y' : 'ies'} unassigned.\nUse \`/faction edit faction:${target.name} active:true\` to revive.`,
      )],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to dissolve faction';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
  }
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('faction')
    .setDescription('Manage political factions')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a new political faction (staff only)')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('Full faction name').setRequired(true).setMaxLength(128),
        )
        .addStringOption((opt) =>
          opt.setName('short-name').setDescription('Short tag (e.g. "CRW")').setRequired(false).setMaxLength(16),
        )
        .addStringOption((opt) =>
          opt.setName('description').setDescription('Brief description').setRequired(false).setMaxLength(1024),
        )
        .addStringOption((opt) =>
          opt.setName('colour').setDescription('Hex colour, e.g. #b94a48').setRequired(false).setMaxLength(7),
        )
        .addRoleOption((opt) =>
          opt.setName('discord-role').setDescription('Discord role to map to this faction').setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List all active factions with member and party counts'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('info')
        .setDescription('Show faction details — parties, member count, description')
        .addStringOption((opt) =>
          opt.setName('faction').setDescription('Faction (name or short tag)').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Edit an existing faction (staff only)')
        .addStringOption((opt) =>
          opt.setName('faction').setDescription('Faction to edit (name match)').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('name').setDescription('New full name').setRequired(false).setMaxLength(128),
        )
        .addStringOption((opt) =>
          opt.setName('short-name').setDescription('New short tag (use "-" to clear)').setRequired(false).setMaxLength(16),
        )
        .addStringOption((opt) =>
          opt.setName('description').setDescription('New description (use "-" to clear)').setRequired(false).setMaxLength(1024),
        )
        .addStringOption((opt) =>
          opt.setName('colour').setDescription('New hex colour (use "-" to clear)').setRequired(false).setMaxLength(7),
        )
        .addRoleOption((opt) =>
          opt.setName('discord-role').setDescription('New Discord role').setRequired(false),
        )
        .addBooleanOption((opt) =>
          opt.setName('role-clear').setDescription('Clear the mapped Discord role').setRequired(false),
        )
        .addBooleanOption((opt) =>
          opt.setName('active').setDescription('Set active state').setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('dissolve')
        .setDescription('Dissolve a faction (staff only — soft delete; members and parties unassigned)')
        .addStringOption((opt) =>
          opt.setName('faction').setDescription('Faction to dissolve (name match)').setRequired(true),
        )
        .addBooleanOption((opt) =>
          opt.setName('confirm').setDescription('Confirm the dissolution (required)').setRequired(true),
        ),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'create':
        await handleCreate(interaction);
        break;
      case 'list':
        await handleList(interaction);
        break;
      case 'info':
        await handleInfo(interaction);
        break;
      case 'edit':
        await handleEdit(interaction);
        break;
      case 'dissolve':
        await handleDissolve(interaction);
        break;
    }
  },
};

export default command;
