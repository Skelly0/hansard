import {
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, like } from 'drizzle-orm';
import { db } from '../../db.js';
import { modActions, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';

function formatType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Validate UUID (full or short prefix). The schema uses UUID, no caseNumber column.
function isFullUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function looksLikePrefix(s: string): boolean {
  return /^[0-9a-f]{4,}$/i.test(s);
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guild || !interaction.member) {
    await interaction.editReply({
      embeds: [errorEmbed('This command must be used in a server.')],
    });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!(await isStaff(member))) {
    await interaction.editReply({
      embeds: [errorEmbed('You do not have permission to review appeals.')],
    });
    return;
  }

  const actionInput = interaction.options.getString('action', true).trim();
  const decisionInput = interaction.options.getString('decision', true);

  // appealStatus column allows: null | 'pending' | 'accepted' | 'denied'.
  // We map the user-facing 'approved' → schema's 'accepted'.
  const appealStatus: 'accepted' | 'denied' = decisionInput === 'approved' ? 'accepted' : 'denied';

  // Look up the action by full UUID or by short prefix.
  let matches: (typeof modActions.$inferSelect)[];
  if (isFullUuid(actionInput)) {
    matches = await db.select().from(modActions).where(eq(modActions.id, actionInput));
  } else if (looksLikePrefix(actionInput)) {
    matches = await db
      .select()
      .from(modActions)
      .where(like(modActions.id, `${actionInput.toLowerCase()}%`))
      .limit(2);
  } else {
    await interaction.editReply({
      embeds: [errorEmbed('Action ID must be a UUID or hex prefix (4+ chars).')],
    });
    return;
  }

  if (matches.length === 0) {
    await interaction.editReply({
      embeds: [errorEmbed(`No moderation action matches \`${actionInput}\`.`)],
    });
    return;
  }
  if (matches.length > 1) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          `Prefix \`${actionInput}\` is ambiguous (matched ${matches.length} actions). Use a longer prefix.`,
        ),
      ],
    });
    return;
  }

  const action = matches[0]!;

  // Look up the staff reviewer's player record (so we can credit appealReviewedById).
  const [reviewer] = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.discordId, interaction.user.id))
    .limit(1);

  if (!reviewer) {
    await interaction.editReply({
      embeds: [errorEmbed('You are not registered as a player. Staff must have a player record.')],
    });
    return;
  }

  if (action.appealStatus === 'accepted' || action.appealStatus === 'denied') {
    const prior = action.appealStatus === 'accepted' ? 'approved' : 'denied';
    await interaction.editReply({
      embeds: [errorEmbed(`This appeal has already been decided (previously ${prior}).`)],
    });
    return;
  }

  // If the appeal is approved (accepted), deactivate the underlying action.
  const setValues: Record<string, unknown> = {
    appealStatus,
    appealReviewedById: reviewer.id,
    updatedAt: new Date(),
  };
  if (appealStatus === 'accepted') {
    setValues.isActive = false;
  }

  await db.update(modActions).set(setValues).where(eq(modActions.id, action.id));

  // Look up target name for display.
  const [target] = await db
    .select({ characterName: players.characterName })
    .from(players)
    .where(eq(players.id, action.targetPlayerId))
    .limit(1);

  const decisionLabel = appealStatus === 'accepted' ? 'Approved' : 'Denied';

  const embed = createEmbed({
    title: `Appeal ${decisionLabel}`,
    system: 'moderation',
    fields: [
      { name: 'Action ID', value: `\`${action.id}\``, inline: false },
      { name: 'Type', value: `\`${formatType(action.type)}\``, inline: true },
      { name: 'Target', value: target?.characterName ?? 'Unknown', inline: true },
      { name: 'Decision', value: `**${decisionLabel}**`, inline: true },
      { name: 'Reviewed By', value: interaction.user.toString(), inline: true },
      {
        name: 'Result',
        value:
          appealStatus === 'accepted'
            ? 'Underlying action has been deactivated.'
            : 'Underlying action remains in force.',
        inline: false,
      },
      ...(action.appealReason
        ? [{ name: 'Appeal Reason', value: `> ${action.appealReason}`, inline: false }]
        : []),
    ],
  });

  await interaction.editReply({ embeds: [embed] });
}
