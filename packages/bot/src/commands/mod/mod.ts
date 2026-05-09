import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, and, desc, ne } from 'drizzle-orm';
import { db } from '../../db.js';
import { modActions, modNotes, players, playerEventLog } from '@hansard/db';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { postModLog } from '../../utils/modLog.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Format a mod action type into a readable label. */
function formatType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Truncate a string to a max length. */
function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

/**
 * Parse a human-readable duration string into milliseconds.
 * Supports: 1h, 1d, 7d, 2w, 1m, etc.
 */
function parseDuration(input: string): { ms: number; label: string } | null {
  const match = input.trim().match(/^(\d+)\s*(m|d|w|h)$/i);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  const multipliers: Record<string, { ms: number; label: string }> = {
    h: { ms: 60 * 60 * 1000, label: 'hour' },
    d: { ms: 24 * 60 * 60 * 1000, label: 'day' },
    w: { ms: 7 * 24 * 60 * 60 * 1000, label: 'week' },
    m: { ms: 30 * 24 * 60 * 60 * 1000, label: 'month' },
  };

  const mult = multipliers[unit];
  if (!mult) return null;

  return {
    ms: value * mult.ms,
    label: `${value} ${mult.label}${value !== 1 ? 's' : ''}`,
  };
}

/**
 * Look up a player by their Discord ID.
 * Returns id + characterName, or null if not found.
 */
async function lookupPlayer(discordId: string) {
  const [player] = await db
    .select({ id: players.id, characterName: players.characterName, isActive: players.isActive })
    .from(players)
    .where(eq(players.discordId, discordId))
    .limit(1);
  return player ?? null;
}

/**
 * Look up the moderator's player record (staff must be registered).
 */
async function lookupModerator(discordId: string) {
  const [player] = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.discordId, discordId))
    .limit(1);
  return player ?? null;
}

// ─── /mod warn ──────────────────────────────────────────────────────────────

async function handleWarn(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason', true);

  const targetPlayer = await lookupPlayer(targetUser.id);
  if (!targetPlayer) {
    await interaction.editReply({ embeds: [errorEmbed(`${targetUser.username} is not a registered player.`)] });
    return;
  }

  const modPlayer = await lookupModerator(interaction.user.id);
  if (!modPlayer) {
    await interaction.editReply({ embeds: [errorEmbed('You are not registered as a player. Staff must have a player record.')] });
    return;
  }

  const [action] = await db.insert(modActions).values({
    targetPlayerId: targetPlayer.id,
    moderatorId: modPlayer.id,
    type: 'formal_warning',
    reason,
    isActive: true,
  }).returning();

  const displayName = targetPlayer.characterName ?? targetUser.username;

  const embed = createEmbed({
    title: 'Warning Issued',
    system: 'moderation',
    fields: [
      { name: 'Player', value: `**${displayName}** (${targetUser.toString()})`, inline: true },
      { name: 'Type', value: '`formal_warning`', inline: true },
      { name: 'Moderator', value: interaction.user.toString(), inline: true },
      { name: 'Reason', value: `> ${reason}` },
      { name: 'Action ID', value: `\`${action.id}\``, inline: true },
    ],
  });

  await interaction.editReply({ embeds: [embed] });
  await postModLog(interaction, embed);

  // DM the target user about the warning
  try {
    const dmEmbed = createEmbed({
      title: 'You have received a formal warning',
      description: `> ${reason}`,
      system: 'moderation',
      fields: [
        { name: 'Issued By', value: interaction.user.username, inline: true },
      ],
    });
    await targetUser.send({ embeds: [dmEmbed] });
  } catch {
    // User may have DMs disabled
  }
}

// ─── /mod note ──────────────────────────────────────────────────────────────

async function handleNote(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser('user', true);
  const content = interaction.options.getString('content', true);

  const targetPlayer = await lookupPlayer(targetUser.id);
  if (!targetPlayer) {
    await interaction.editReply({ embeds: [errorEmbed(`${targetUser.username} is not a registered player.`)] });
    return;
  }

  const authorPlayer = await lookupModerator(interaction.user.id);
  if (!authorPlayer) {
    await interaction.editReply({ embeds: [errorEmbed('You are not registered as a player. Staff must have a player record.')] });
    return;
  }

  const [note] = await db.insert(modNotes).values({
    targetPlayerId: targetPlayer.id,
    authorId: authorPlayer.id,
    content,
  }).returning();

  const displayName = targetPlayer.characterName ?? targetUser.username;

  const embed = createEmbed({
    title: 'Mod Note Added',
    system: 'moderation',
    fields: [
      { name: 'Player', value: `**${displayName}** (${targetUser.toString()})`, inline: true },
      { name: 'Author', value: interaction.user.toString(), inline: true },
      { name: 'Content', value: `> ${content}` },
      { name: 'Note ID', value: `\`${note.id}\``, inline: true },
    ],
  });

  await interaction.editReply({ embeds: [embed] });
  await postModLog(interaction, embed);
}

// ─── /mod history ───────────────────────────────────────────────────────────

async function handleHistory(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser('user', true);

  const targetPlayer = await lookupPlayer(targetUser.id);
  if (!targetPlayer) {
    await interaction.editReply({ embeds: [errorEmbed(`${targetUser.username} is not a registered player.`)] });
    return;
  }

  // Fetch actions and notes
  const actions = await db
    .select()
    .from(modActions)
    .where(eq(modActions.targetPlayerId, targetPlayer.id))
    .orderBy(desc(modActions.createdAt));

  const notes = await db
    .select()
    .from(modNotes)
    .where(eq(modNotes.targetPlayerId, targetPlayer.id))
    .orderBy(desc(modNotes.createdAt));

  const displayName = targetPlayer.characterName ?? targetUser.username;

  if (actions.length === 0 && notes.length === 0) {
    const embed = createEmbed({
      title: `Mod History: ${displayName}`,
      description: 'No moderation history found for this player.',
      system: 'moderation',
    });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Build action lines (limit to 10 most recent to fit embed)
  const actionLines = actions.slice(0, 10).map((a) => {
    const status = a.isActive ? '**ACTIVE**' : '~~expired~~';
    const date = `<t:${Math.floor(a.createdAt.getTime() / 1000)}:R>`;
    return `${status} \`${formatType(a.type)}\` ${date}\n> ${truncate(a.reason, 100)}`;
  });

  // Build note lines (limit to 5 most recent)
  const noteLines = notes.slice(0, 5).map((n) => {
    const date = `<t:${Math.floor(n.createdAt.getTime() / 1000)}:R>`;
    return `${date}\n> ${truncate(n.content, 100)}`;
  });

  const fields = [];

  // Summary stats
  const activeCount = actions.filter((a) => a.isActive).length;
  fields.push({
    name: 'Summary',
    value: [
      `**Total Actions:** ${actions.length}`,
      `**Active:** ${activeCount}`,
      `**Notes:** ${notes.length}`,
    ].join(' | '),
  });

  if (actionLines.length > 0) {
    fields.push({
      name: `Actions (${actions.length} total)`,
      value: actionLines.join('\n\n'),
    });
  }

  if (noteLines.length > 0) {
    fields.push({
      name: `Staff Notes (${notes.length} total)`,
      value: noteLines.join('\n\n'),
    });
  }

  const embed = createEmbed({
    title: `Mod History: ${displayName}`,
    description: `${targetUser.toString()} (\`${targetPlayer.id}\`)`,
    system: 'moderation',
    fields,
  });

  await interaction.editReply({ embeds: [embed] });
}

// ─── /mod suspend ───────────────────────────────────────────────────────────

async function handleSuspend(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser('user', true);
  const durationStr = interaction.options.getString('duration', true);
  const reason = interaction.options.getString('reason', true);

  // Parse duration
  const duration = parseDuration(durationStr);
  if (!duration) {
    await interaction.editReply({
      embeds: [errorEmbed('Invalid duration format. Use: `1h`, `1d`, `7d`, `2w`, `1m`')],
    });
    return;
  }

  const targetPlayer = await lookupPlayer(targetUser.id);
  if (!targetPlayer) {
    await interaction.editReply({ embeds: [errorEmbed(`${targetUser.username} is not a registered player.`)] });
    return;
  }

  const modPlayer = await lookupModerator(interaction.user.id);
  if (!modPlayer) {
    await interaction.editReply({ embeds: [errorEmbed('You are not registered as a player. Staff must have a player record.')] });
    return;
  }

  const expiresAt = new Date(Date.now() + duration.ms);

  // Create the suspension action
  const [action] = await db.insert(modActions).values({
    targetPlayerId: targetPlayer.id,
    moderatorId: modPlayer.id,
    type: 'temporary_suspension',
    reason,
    expiresAt,
    isActive: true,
  }).returning();

  // Deactivate the player
  await db
    .update(players)
    .set({ isActive: false })
    .where(eq(players.id, targetPlayer.id));

  // Log the suspension event
  await db.insert(playerEventLog).values({
    playerId: targetPlayer.id,
    eventType: 'suspension',
    description: `Suspended for ${duration.label}: ${reason}`,
    newValue: {
      moderatorId: modPlayer.id,
      duration: duration.label,
      reason,
      expiresAt: expiresAt.toISOString(),
    },
    triggeredById: modPlayer.id,
  });

  const displayName = targetPlayer.characterName ?? targetUser.username;
  const expiresTimestamp = `<t:${Math.floor(expiresAt.getTime() / 1000)}:F>`;

  const embed = createEmbed({
    title: 'Player Suspended',
    system: 'moderation',
    fields: [
      { name: 'Player', value: `**${displayName}** (${targetUser.toString()})`, inline: true },
      { name: 'Duration', value: duration.label, inline: true },
      { name: 'Expires', value: expiresTimestamp, inline: true },
      { name: 'Moderator', value: interaction.user.toString(), inline: true },
      { name: 'Reason', value: `> ${reason}` },
      { name: 'Action ID', value: `\`${action.id}\``, inline: true },
    ],
  });

  await interaction.editReply({ embeds: [embed] });
  await postModLog(interaction, embed);

  // DM the target user
  try {
    const dmEmbed = createEmbed({
      title: 'You have been suspended',
      description: [
        `**Duration:** ${duration.label}`,
        `**Expires:** ${expiresTimestamp}`,
        '',
        `**Reason:**`,
        `> ${reason}`,
      ].join('\n'),
      system: 'moderation',
    });
    await targetUser.send({ embeds: [dmEmbed] });
  } catch {
    // User may have DMs disabled
  }
}

// ─── /mod unsuspend ─────────────────────────────────────────────────────────

async function handleUnsuspend(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser('user', true);

  const targetPlayer = await lookupPlayer(targetUser.id);
  if (!targetPlayer) {
    await interaction.editReply({ embeds: [errorEmbed(`${targetUser.username} is not a registered player.`)] });
    return;
  }

  const modPlayer = await lookupModerator(interaction.user.id);
  if (!modPlayer) {
    await interaction.editReply({ embeds: [errorEmbed('You are not registered as a player. Staff must have a player record.')] });
    return;
  }

  // Find active suspension(s) for this player
  const activeSuspensions = await db
    .select()
    .from(modActions)
    .where(
      and(
        eq(modActions.targetPlayerId, targetPlayer.id),
        eq(modActions.type, 'temporary_suspension'),
        eq(modActions.isActive, true),
      ),
    );

  if (activeSuspensions.length === 0) {
    await interaction.editReply({
      embeds: [errorEmbed(`${targetPlayer.characterName ?? targetUser.username} has no active suspension.`)],
    });
    return;
  }

  // Expire all active suspensions
  for (const suspension of activeSuspensions) {
    await db
      .update(modActions)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(modActions.id, suspension.id));
  }

  // Reactivate the player
  await db
    .update(players)
    .set({ isActive: true })
    .where(eq(players.id, targetPlayer.id));

  // Log the unsuspension event
  await db.insert(playerEventLog).values({
    playerId: targetPlayer.id,
    eventType: 'unsuspension',
    description: `Suspension lifted by ${interaction.user.username}`,
    newValue: {
      moderatorId: modPlayer.id,
      suspensionsLifted: activeSuspensions.length,
    },
    triggeredById: modPlayer.id,
  });

  const displayName = targetPlayer.characterName ?? targetUser.username;

  const embed = successEmbed(
    'Suspension Lifted',
    [
      `**${displayName}** (${targetUser.toString()}) has been unsuspended.`,
      '',
      `**${activeSuspensions.length}** suspension action${activeSuspensions.length > 1 ? 's' : ''} expired.`,
      `**Lifted by:** ${interaction.user.toString()}`,
    ].join('\n'),
  );

  await interaction.editReply({ embeds: [embed] });
  await postModLog(interaction, embed);

  // DM the target user
  try {
    const dmEmbed = successEmbed(
      'Your suspension has been lifted',
      'You are now able to participate again. Welcome back.',
    );
    await targetUser.send({ embeds: [dmEmbed] });
  } catch {
    // User may have DMs disabled
  }
}

// ─── /mod appeal-list ──────────────────────────────────────────────────────

async function handleAppealList(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const pending = await db
    .select()
    .from(modActions)
    .where(eq(modActions.appealStatus, 'pending'))
    .orderBy(desc(modActions.updatedAt))
    .limit(25);

  if (pending.length === 0) {
    await interaction.editReply({
      embeds: [createEmbed({
        title: 'Pending Appeals',
        description: '*No pending appeals.*',
        system: 'moderation',
      })],
    });
    return;
  }

  const lines: string[] = [];
  for (const a of pending) {
    const [target] = await db
      .select({ characterName: players.characterName, discordId: players.discordId })
      .from(players)
      .where(eq(players.id, a.targetPlayerId))
      .limit(1);
    const name = target?.characterName ?? (target?.discordId ? `<@${target.discordId}>` : 'unknown');
    const since = `<t:${Math.floor(a.updatedAt.getTime() / 1000)}:R>`;
    lines.push(
      `\`${a.id.slice(0, 8)}\` — **${name}** — \`${formatType(a.type)}\` — ${since}\n> Reason: ${truncate(a.reason, 80)}\n> Appeal: ${truncate(a.appealReason ?? '*(no appeal text)*', 100)}`,
    );
  }

  const embed = createEmbed({
    title: `Pending Appeals (${pending.length})`,
    description: lines.join('\n\n'),
    system: 'moderation',
    fields: [
      {
        name: 'Review',
        value: 'Use `/mod appeal-review action-id:<full-id> decision:<accept|deny> reason:<...>`',
      },
    ],
  });

  await interaction.editReply({ embeds: [embed] });
}

// ─── /mod appeal-review ────────────────────────────────────────────────────

async function handleAppealReview(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const actionId = interaction.options.getString('action-id', true).trim();
  const decision = interaction.options.getString('decision', true);
  const reviewReason = interaction.options.getString('reason', true);

  if (decision !== 'accept' && decision !== 'deny') {
    await interaction.editReply({ embeds: [errorEmbed('Decision must be `accept` or `deny`.')] });
    return;
  }

  const reviewerPlayer = await lookupModerator(interaction.user.id);
  if (!reviewerPlayer) {
    await interaction.editReply({ embeds: [errorEmbed('You are not registered as a player.')] });
    return;
  }

  const [action] = await db
    .select()
    .from(modActions)
    .where(eq(modActions.id, actionId))
    .limit(1);

  if (!action) {
    await interaction.editReply({ embeds: [errorEmbed(`Mod action \`${actionId}\` not found.`)] });
    return;
  }

  if (action.appealStatus !== 'pending') {
    await interaction.editReply({
      embeds: [errorEmbed(`This action's appeal is not pending (current: \`${action.appealStatus ?? 'none'}\`).`)],
    });
    return;
  }

  const newStatus: 'accepted' | 'denied' = decision === 'accept' ? 'accepted' : 'denied';
  const accepted = newStatus === 'accepted';

  const internalNote = [
    action.internalNotes ?? '',
    `[${new Date().toISOString()}] Appeal ${newStatus} by ${interaction.user.username}: ${reviewReason}`,
  ].filter(Boolean).join('\n');

  await db
    .update(modActions)
    .set({
      appealStatus: newStatus,
      appealReviewedById: reviewerPlayer.id,
      internalNotes: internalNote,
      isActive: accepted ? false : action.isActive,
      updatedAt: new Date(),
    })
    .where(eq(modActions.id, action.id));

  // If accepted, lift the suspension — but only if no OTHER active suspension is in force.
  if (accepted && action.type === 'temporary_suspension') {
    const [otherSuspension] = await db
      .select({ id: modActions.id })
      .from(modActions)
      .where(
        and(
          eq(modActions.targetPlayerId, action.targetPlayerId),
          eq(modActions.type, 'temporary_suspension'),
          eq(modActions.isActive, true),
          ne(modActions.id, action.id),
        ),
      )
      .limit(1);

    if (!otherSuspension) {
      await db
        .update(players)
        .set({ isActive: true })
        .where(eq(players.id, action.targetPlayerId));
    }
  }

  await db.insert(playerEventLog).values({
    playerId: action.targetPlayerId,
    eventType: accepted ? 'unsuspension' : 'suspension',
    description: `Appeal ${newStatus} for ${formatType(action.type)}: ${reviewReason}`,
    newValue: {
      modActionId: action.id,
      decision: newStatus,
      reviewedById: reviewerPlayer.id,
      reviewReason,
    },
    triggeredById: reviewerPlayer.id,
  });

  const [target] = await db
    .select({ characterName: players.characterName, discordId: players.discordId })
    .from(players)
    .where(eq(players.id, action.targetPlayerId))
    .limit(1);
  const targetName = target?.characterName ?? (target?.discordId ? `<@${target.discordId}>` : 'unknown');

  const embed = createEmbed({
    title: `Appeal ${accepted ? 'Accepted' : 'Denied'}`,
    system: 'moderation',
    fields: [
      { name: 'Action', value: `\`${formatType(action.type)}\` (\`${action.id}\`)`, inline: true },
      { name: 'Player', value: targetName, inline: true },
      { name: 'Reviewer', value: interaction.user.toString(), inline: true },
      { name: 'Decision', value: `\`${newStatus}\``, inline: true },
      { name: 'Reason', value: `> ${reviewReason}` },
      ...(accepted ? [{ name: 'Effect', value: 'Action expired; suspensions lifted.' }] : []),
    ],
  });

  await interaction.editReply({ embeds: [embed] });
  await postModLog(interaction, embed);

  // DM the target user about the decision
  if (target?.discordId) {
    try {
      const user = await interaction.client.users.fetch(target.discordId);
      const dm = createEmbed({
        title: `Your appeal has been ${newStatus}`,
        description: [
          `**Action:** \`${formatType(action.type)}\``,
          `**Reviewer note:** ${reviewReason}`,
          accepted ? '\nThe action has been lifted.' : '\nThe action remains in effect.',
        ].join('\n'),
        system: 'moderation',
      });
      await user.send({ embeds: [dm] });
    } catch {
      // DMs disabled
    }
  }
}

// ─── Command Definition ─────────────────────────────────────────────────────

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Moderation commands (staff only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('warn')
        .setDescription('Issue a formal warning to a player')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The user to warn').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Reason for the warning').setRequired(true).setMaxLength(1000),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('note')
        .setDescription('Add a private mod note to a player')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The user to add a note to').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('content').setDescription('Note content').setRequired(true).setMaxLength(2000),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('history')
        .setDescription('View moderation history for a player')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The user to look up').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('suspend')
        .setDescription('Temporarily suspend a player')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The user to suspend').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('duration').setDescription('Duration (e.g. 1h, 1d, 7d, 2w, 1m)').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Reason for the suspension').setRequired(true).setMaxLength(1000),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('unsuspend')
        .setDescription('Lift a player suspension early')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The user to unsuspend').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('appeal-list')
        .setDescription('List pending appeals'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('appeal-review')
        .setDescription('Approve or deny a pending appeal')
        .addStringOption((opt) =>
          opt.setName('action-id').setDescription('The mod action UUID to review').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('decision').setDescription('Decision').setRequired(true).addChoices(
            { name: 'accept', value: 'accept' },
            { name: 'deny', value: 'deny' },
          ),
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Reviewer note explaining the decision').setRequired(true).setMaxLength(1000),
        ),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Staff gate — all mod commands require staff
    if (!interaction.guild || !interaction.member) {
      await interaction.reply({ embeds: [errorEmbed('This command must be used in a server.')], ephemeral: true });
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!(await isStaff(member))) {
      await interaction.reply({
        embeds: [errorEmbed('You do not have permission to use moderation commands.')],
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'warn':
        return handleWarn(interaction);
      case 'note':
        return handleNote(interaction);
      case 'history':
        return handleHistory(interaction);
      case 'suspend':
        return handleSuspend(interaction);
      case 'unsuspend':
        return handleUnsuspend(interaction);
      case 'appeal-list':
        return handleAppealList(interaction);
      case 'appeal-review':
        return handleAppealReview(interaction);
      default:
        await interaction.reply({ embeds: [errorEmbed(`Unknown subcommand: ${subcommand}`)], ephemeral: true });
    }
  },
};

export default command;
