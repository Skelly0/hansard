import {
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { offices } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import { findElectionByReference } from './_electionReference.js';

/**
 * /vote info election:<title-or-id> — show the metadata "details page" for an
 * election: type, method, threshold, start/end times, status.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const electionRef = interaction.options.getString('election', true);
    const actorIsStaff = !!interaction.member && (await isStaff(interaction.member as any));

    const { election, errorMessage } = await findElectionByReference(db, electionRef);

    if (!election || (election.status === 'draft' && !actorIsStaff)) {
      await interaction.editReply({
        embeds: [errorEmbed(errorMessage ?? 'Election not found.')],
      });
      return;
    }

    // Resolve linked office name if present
    let officeName: string | null = null;
    if (election.forOfficeId) {
      const [office] = await db
        .select({ name: offices.name })
        .from(offices)
        .where(eq(offices.id, election.forOfficeId))
        .limit(1);
      officeName = office?.name ?? null;
    }

    const config = election.config ?? {};
    const fields = [
      { name: 'Type', value: election.type, inline: true },
      { name: 'Method', value: election.method, inline: true },
      { name: 'Status', value: election.status, inline: true },
      { name: 'Round', value: String(election.roundNumber), inline: true },
      {
        name: 'Interface',
        value: election.useReactions ? 'Discord reactions' : 'Buttons',
        inline: true,
      },
    ];

    // Threshold display
    const thresholdParts: string[] = [];
    if (config.majorityType) thresholdParts.push(`majority: \`${config.majorityType}\``);
    if (config.passThreshold != null) {
      thresholdParts.push(`pass: \`${(config.passThreshold * 100).toFixed(0)}%\``);
    }
    if (config.quorumRequired != null) {
      const q = config.quorumType === 'percentage'
        ? `${(config.quorumRequired * 100).toFixed(0)}%`
        : String(config.quorumRequired);
      thresholdParts.push(`quorum: \`${q}\``);
    }
    if (config.seatsAvailable != null) thresholdParts.push(`seats: \`${config.seatsAvailable}\``);
    fields.push({
      name: 'Threshold',
      value: thresholdParts.length > 0 ? thresholdParts.join(' • ') : '*default*',
      inline: false,
    });

    // Timing — use Discord's <t:UNIX:F> formatter
    const fmt = (d: Date | null) =>
      d ? `<t:${Math.floor(d.getTime() / 1000)}:F>` : '*not set*';

    if (election.nominationsOpenAt || election.nominationsCloseAt) {
      fields.push({
        name: 'Nominations',
        value: `${fmt(election.nominationsOpenAt)} → ${fmt(election.nominationsCloseAt)}`,
        inline: false,
      });
    }
    fields.push({
      name: 'Voting Window',
      value: `${fmt(election.votingOpensAt)} → ${fmt(election.votingClosesAt)}`,
      inline: false,
    });

    if (officeName) {
      fields.push({ name: 'For Office', value: officeName, inline: true });
    }
    if (config.sealedResults) {
      fields.push({ name: 'Sealed', value: 'Yes', inline: true });
    }
    if (config.requiresNpcConfirmation) {
      fields.push({ name: 'NPC Confirmation', value: 'Required', inline: true });
    }

    const embed = createEmbed({
      title: election.title,
      description: election.description ?? undefined,
      system: 'voting',
      fields,
    });

    await interaction.editReply({ embeds: [embed] });
}
