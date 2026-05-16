import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { eq, and, isNotNull, isNull } from 'drizzle-orm';
import { offices, officeHolders, players, parties } from '@hansard/db';
import { errorEmbed, createEmbed } from '../utils/embeds.js';
import { db } from '../db.js';
import { isStaff } from '../utils/permissions.js';
import type { Command } from '../client.js';

/**
 * /sync-roles — staff-only maintenance command.
 *
 * Reconciles Discord roles with DB state:
 *   1. Office roles — every active office_holder gets the office's discordRoleId.
 *   2. Party roles — every player.partyId maps to the party's discordRoleId.
 *
 * Also REMOVES misaligned roles: if a guild member has an office/party role
 * but the DB says they shouldn't, the role is stripped.
 *
 * Reports per-bucket added/removed counts plus any hierarchy/permission failures.
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('sync-roles')
    .setDescription('Reconcile Discord roles with office and party assignments (staff only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.editReply({
        embeds: [errorEmbed('This command can only be used in a server.')],
      });
      return;
    }

    if (!(await isStaff(member as GuildMember))) {
      await interaction.editReply({
        embeds: [errorEmbed('Only staff can run /sync-roles.')],
      });
      return;
    }

    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply({
        embeds: [errorEmbed('Could not resolve guild context.')],
      });
      return;
    }

    // Build the set of role IDs the bot is responsible for managing.
    const officesRows = await db
      .select({ id: offices.id, name: offices.name, discordRoleId: offices.discordRoleId })
      .from(offices)
      .where(and(eq(offices.isActive, true), isNotNull(offices.discordRoleId)));

    const partiesRows = await db
      .select({ id: parties.id, name: parties.name, discordRoleId: parties.discordRoleId })
      .from(parties)
      .where(and(eq(parties.isActive, true), isNotNull(parties.discordRoleId)));

    const managedOfficeRoleIds = new Set(
      officesRows.map((o) => o.discordRoleId).filter((x): x is string => Boolean(x)),
    );
    const managedPartyRoleIds = new Set(
      partiesRows.map((p) => p.discordRoleId).filter((x): x is string => Boolean(x)),
    );

    if (managedOfficeRoleIds.size === 0 && managedPartyRoleIds.size === 0) {
      await interaction.editReply({
        embeds: [errorEmbed('No offices or parties have a `discordRoleId` configured. Nothing to sync.')],
      });
      return;
    }

    // Compute the desired role-set for each player based on DB.
    // Map: discordId -> { offices: Set<roleId>, party: roleId | null, displayName }
    const desired = new Map<
      string,
      { officeRoles: Set<string>; partyRole: string | null; characterName: string | null }
    >();

    // Active office holders -> office roles
    const activeHolders = await db
      .select({
        discordId: players.discordId,
        characterName: players.characterName,
        roleId: offices.discordRoleId,
      })
      .from(officeHolders)
      .innerJoin(players, eq(officeHolders.playerId, players.id))
      .innerJoin(offices, eq(officeHolders.officeId, offices.id))
      .where(and(isNull(officeHolders.endDate), isNotNull(offices.discordRoleId)));

    for (const row of activeHolders) {
      if (!row.roleId) continue;
      const entry = desired.get(row.discordId) ?? {
        officeRoles: new Set<string>(),
        partyRole: null,
        characterName: row.characterName,
      };
      entry.officeRoles.add(row.roleId);
      desired.set(row.discordId, entry);
    }

    // Players with parties -> party role
    const partiedPlayers = await db
      .select({
        discordId: players.discordId,
        characterName: players.characterName,
        roleId: parties.discordRoleId,
      })
      .from(players)
      .innerJoin(parties, eq(players.partyId, parties.id))
      .where(and(eq(players.isActive, true), isNotNull(parties.discordRoleId)));

    for (const row of partiedPlayers) {
      if (!row.roleId) continue;
      const entry = desired.get(row.discordId) ?? {
        officeRoles: new Set<string>(),
        partyRole: null,
        characterName: row.characterName,
      };
      entry.partyRole = row.roleId;
      desired.set(row.discordId, entry);
    }

    // Also fetch all players that have a discord ID — even if they have no
    // offices/party — so we can strip roles that have drifted from DB state.
    const allPlayerRows = await db
      .select({
        discordId: players.discordId,
        characterName: players.characterName,
      })
      .from(players)
      .where(eq(players.isActive, true));

    for (const row of allPlayerRows) {
      if (!desired.has(row.discordId)) {
        desired.set(row.discordId, {
          officeRoles: new Set<string>(),
          partyRole: null,
          characterName: row.characterName,
        });
      }
    }

    // Pre-fetch the guild member cache in one shot to avoid per-row API calls.
    const memberCache = await guild.members.fetch();

    let added = 0;
    let removed = 0;
    let processed = 0;
    const failures: string[] = [];

    for (const [discordId, want] of desired) {
      const guildMember = memberCache.get(discordId);
      if (!guildMember) continue;
      processed++;

      const desiredRoleIds = new Set<string>(want.officeRoles);
      if (want.partyRole) desiredRoleIds.add(want.partyRole);

      const current = guildMember.roles.cache;

      // Add missing roles
      for (const roleId of desiredRoleIds) {
        if (!current.has(roleId)) {
          try {
            await guildMember.roles.add(roleId, 'Hansard: /sync-roles');
            added++;
          } catch (err) {
            console.warn(`sync-roles: failed to add ${roleId} to ${discordId}:`, err);
            const label = want.characterName ?? guildMember.user.username;
            failures.push(`add → ${label}`);
          }
        }
      }

      // Remove managed roles the player should no longer have
      for (const [roleId] of current) {
        const isManaged = managedOfficeRoleIds.has(roleId) || managedPartyRoleIds.has(roleId);
        if (isManaged && !desiredRoleIds.has(roleId)) {
          try {
            await guildMember.roles.remove(roleId, 'Hansard: /sync-roles');
            removed++;
          } catch (err) {
            console.warn(`sync-roles: failed to remove ${roleId} from ${discordId}:`, err);
            const label = want.characterName ?? guildMember.user.username;
            failures.push(`remove → ${label}`);
          }
        }
      }
    }

    const lines: string[] = [
      `**Members processed:** ${processed}`,
      `**Roles added:** ${added}`,
      `**Roles removed:** ${removed}`,
      `**Office roles managed:** ${managedOfficeRoleIds.size}`,
      `**Party roles managed:** ${managedPartyRoleIds.size}`,
    ];

    if (failures.length > 0) {
      const sample = failures.slice(0, 8).join(', ');
      lines.push(
        '',
        `⚠️ **${failures.length} role op(s) failed.**`,
        `Most likely cause: Hansard's role is below the managed role(s) in the server's role hierarchy. Move Hansard above them in **Server Settings → Roles**.`,
        '',
        `_Examples:_ ${sample}${failures.length > 8 ? '…' : ''}`,
      );
    }

    const embed = createEmbed({
      title: 'Role Sync Complete',
      system: 'offices',
      description: lines.join('\n'),
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
