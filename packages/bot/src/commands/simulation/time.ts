import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { simulationClock, players } from '@hansard/db';
import { advanceTime, previewAdvance } from '@hansard/api/services/simulationService';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { postObituaryToGraveyard, type GraveyardPostResult } from '../../utils/graveyard.js';
import type { Command } from '../../client.js';

type DeathAilment = {
  condition: string;
  severity: string;
};

async function fetchClock() {
  const rows = await db.select().from(simulationClock).limit(1);
  return rows[0] ?? null;
}

function formatDeathAilments(ailments: DeathAilment[] | undefined): string {
  if (!ailments || ailments.length === 0) return '';
  return `; ailments: ${ailments.map(a => `${a.condition} (${a.severity})`).join(', ')}`;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('time')
    .setDescription('Simulation clock management')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Show current simulation date, tick, and season'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('advance')
        .setDescription('Advance the simulation clock by N ticks')
        .addIntegerOption((opt) =>
          opt.setName('ticks').setDescription('Number of ticks to advance (default 1)')
            .setMinValue(1).setMaxValue(100),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('preview')
        .setDescription('Preview what would happen if time advances (dry run)')
        .addIntegerOption((opt) =>
          opt.setName('ticks').setDescription('Number of ticks to preview (default 1)')
            .setMinValue(1).setMaxValue(100),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Override the current simulation date (admin only)')
        .addStringOption((opt) =>
          opt.setName('date').setDescription('New simulation date').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('pause').setDescription('Pause the simulation clock'),
    )
    .addSubcommand((sub) =>
      sub.setName('unpause').setDescription('Unpause the simulation clock'),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'status': await handleStatus(interaction); break;
      case 'advance': await handleAdvance(interaction); break;
      case 'preview': await handlePreview(interaction); break;
      case 'set': await handleSet(interaction); break;
      case 'pause': await handlePauseToggle(interaction, true); break;
      case 'unpause': await handlePauseToggle(interaction, false); break;
    }
  },
};

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const clock = await fetchClock();

  if (!clock) {
    await interaction.editReply({ embeds: [errorEmbed('No simulation clock configured.')] });
    return;
  }

  const embed = createEmbed({
    title: 'Simulation Clock',
    system: 'simulation',
    fields: [
      { name: 'Current Date', value: `\`${clock.currentDate}\``, inline: true },
      { name: 'Tick', value: `\`${clock.currentTick}\``, inline: true },
      { name: 'Tick Unit', value: `\`${clock.tickUnit}\``, inline: true },
      { name: 'Season', value: clock.seasonName, inline: true },
      { name: 'Status', value: clock.isPaused ? '**PAUSED**' : 'Running', inline: true },
      { name: 'Started', value: `\`${clock.startDate}\``, inline: true },
    ],
  });

  await interaction.editReply({ embeds: [embed] });
}

async function handleAdvance(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const ticks = interaction.options.getInteger('ticks') ?? 1;

  try {
    const [staffPlayer] = await db.select().from(players)
      .where(eq(players.discordId, interaction.user.id));

    if (!staffPlayer) {
      await interaction.editReply({
        embeds: [errorEmbed('You must be registered as a player to advance time.')],
      });
      return;
    }

    const result = await advanceTime(db, ticks, staffPlayer.id);
    const graveyardPosts: GraveyardPostResult[] = [];

    for (const death of result.deathDetails) {
      graveyardPosts.push(await postObituaryToGraveyard({
        client: interaction.client,
        db,
        playerId: death.playerId,
      }));
    }

    const lines: string[] = [
      `**${result.fromDate}** → **${result.toDate}**`,
      `Tick \`${result.fromTick}\` → \`${result.toTick}\``,
      '',
      `**${result.aged}** players aged`,
    ];

    if (result.ailmentDetails.length > 0) {
      lines.push('', '**New Ailments:**');
      for (const a of result.ailmentDetails) {
        lines.push(`• **${a.characterName ?? 'Unknown'}** — ${a.condition} (${a.severity})`);
      }
    }

    if (result.deathDetails.length > 0) {
      lines.push('', '⚰️ **Deaths:**');
      for (const d of result.deathDetails) {
        lines.push(`• **${d.characterName ?? 'Unknown'}** (age ${d.age}) — ${d.cause}${formatDeathAilments(d.ailments)}`);
      }

      const channelId = graveyardPosts.find(post => post.channelId)?.channelId;
      const sentCount = graveyardPosts.filter(post => post.status === 'sent').length;
      if (sentCount === graveyardPosts.length && channelId) {
        lines.push('', `Obituaries posted to <#${channelId}>.`);
      } else if (sentCount > 0 && channelId) {
        lines.push('', `${sentCount}/${graveyardPosts.length} obituaries posted to <#${channelId}>; check bot logs for failures.`);
      } else {
        lines.push('', 'Obituaries could not be posted to the graveyard channel; check bot logs.');
      }
    }

    if (result.pendingDeathDetails.length > 0) {
      lines.push('', '**Death Rolls Triggered:**');
      for (const d of result.pendingDeathDetails) {
        lines.push(
          `• **${d.characterName ?? 'Unknown'}** (age ${d.age}) — ${d.cause}${formatDeathAilments(d.ailments)}; grace until tick ${d.eligibleFromTick} (${d.eligibleFromDate})`,
        );
      }
    }

    if (
      result.ailmentDetails.length === 0
      && result.deathDetails.length === 0
      && result.pendingDeathDetails.length === 0
    ) {
      lines.push('', '_No ailments or deaths this tick._');
    }

    const embed = createEmbed({
      title: `Time Advanced +${ticks} ${ticks === 1 ? 'tick' : 'ticks'}`,
      description: lines.join('\n'),
      system: 'simulation',
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to advance time';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
  }
}

async function handlePreview(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const ticks = interaction.options.getInteger('ticks') ?? 1;

  try {
    const result = await previewAdvance(db, ticks);

    const lines: string[] = [
      '**This is a preview — nothing has been committed.**',
      '',
      `**${result.fromDate}** → **${result.toDate}**`,
      `Tick \`${result.fromTick}\` → \`${result.toTick}\``,
      '',
      `**${result.aged}** players would age`,
    ];

    if (result.ailmentDetails.length > 0) {
      lines.push('', '**Potential Ailments:**');
      for (const a of result.ailmentDetails) {
        lines.push(`• **${a.characterName ?? 'Unknown'}** — ${a.condition} (${a.severity})`);
      }
    }

    if (result.deathDetails.length > 0) {
      lines.push('', '⚰️ **Potential Deaths:**');
      for (const d of result.deathDetails) {
        lines.push(`• **${d.characterName ?? 'Unknown'}** (age ${d.age}) — ${d.cause}${formatDeathAilments(d.ailments)}`);
      }
    }

    if (result.pendingDeathDetails.length > 0) {
      lines.push('', '**Potential Death Rolls:**');
      for (const d of result.pendingDeathDetails) {
        lines.push(
          `• **${d.characterName ?? 'Unknown'}** (age ${d.age}) — ${d.cause}${formatDeathAilments(d.ailments)}; would enter grace until tick ${d.eligibleFromTick} (${d.eligibleFromDate})`,
        );
      }
    }

    if (
      result.ailmentDetails.length === 0
      && result.deathDetails.length === 0
      && result.pendingDeathDetails.length === 0
    ) {
      lines.push('', '_No ailments or deaths predicted this tick._');
    }

    const embed = createEmbed({
      title: `Preview: +${ticks} ${ticks === 1 ? 'tick' : 'ticks'}`,
      description: lines.join('\n'),
      system: 'simulation',
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to preview';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
  }
}

async function handleSet(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const newDate = interaction.options.getString('date', true);
  const clock = await fetchClock();

  if (!clock) {
    await interaction.editReply({ embeds: [errorEmbed('No simulation clock configured.')] });
    return;
  }

  await db.update(simulationClock)
    .set({ currentDate: newDate, updatedAt: new Date() })
    .where(eq(simulationClock.id, clock.id));

  await interaction.editReply({
    embeds: [successEmbed('Date Updated', `Simulation date set to \`${newDate}\``)],
  });
}

async function handlePauseToggle(
  interaction: ChatInputCommandInteraction,
  pause: boolean,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const clock = await fetchClock();

  if (!clock) {
    await interaction.editReply({ embeds: [errorEmbed('No simulation clock configured.')] });
    return;
  }

  if (clock.isPaused === pause) {
    await interaction.editReply({
      embeds: [errorEmbed(`Clock is already ${pause ? 'paused' : 'running'}.`)],
    });
    return;
  }

  await db.update(simulationClock)
    .set({ isPaused: pause, updatedAt: new Date() })
    .where(eq(simulationClock.id, clock.id));

  const embed = successEmbed(
    pause ? 'Clock Paused' : 'Clock Unpaused',
    pause
      ? 'The simulation clock has been paused. Time will not advance until unpaused.'
      : 'The simulation clock is now running. Time can be advanced.',
  );

  await interaction.editReply({ embeds: [embed] });
}

export default command;
