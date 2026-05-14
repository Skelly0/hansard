import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db.js';
import { simulationClock, players, timeAdvanceLog } from '@hansard/db';
import { advanceTime, previewAdvance } from '@hansard/api/services/simulationService';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import { postObituaryToGraveyard, type GraveyardPostResult } from '../../utils/graveyard.js';
import { postGameEventsEmbed, type GameEventsPostResult } from '../../utils/gameEventsChannel.js';
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

type TimeAdvanceResult = Awaited<ReturnType<typeof advanceTime>>;

function buildPublicAdvanceLines(result: TimeAdvanceResult): string[] {
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
  }

  if (result.ailmentDetails.length === 0 && result.deathDetails.length === 0) {
    lines.push('', '_No public ailments or deaths this tick._');
  }

  return lines;
}

function buildStaffAdvanceLines(
  result: TimeAdvanceResult,
  graveyardPosts: GraveyardPostResult[],
): string[] {
  const lines = buildPublicAdvanceLines(result);

  if (result.deathDetails.length > 0) {
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

  return lines;
}

function appendGameEventsPostStatus(lines: string[], post: GameEventsPostResult): void {
  if (post.status === 'sent' && post.channelId) {
    lines.push('', `Game events summary posted to <#${post.channelId}>.`);
    return;
  }

  if (post.channelId) {
    lines.push('', `Game events summary could not be posted to <#${post.channelId}>; check bot logs.`);
    return;
  }

  lines.push('', '_No game events channel configured._');
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
    )
    .addSubcommand((sub) =>
      sub
        .setName('npc-house')
        .setDescription('Toggle NPC house bill review')
        .addBooleanOption((opt) =>
          opt
            .setName('active')
            .setDescription('Whether passed bills should require NPC house review')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('history')
        .setDescription('Show recent simulation advance log entries')
        .addIntegerOption((opt) =>
          opt
            .setName('limit')
            .setDescription('Number of entries to show (default 10)')
            .setMinValue(1)
            .setMaxValue(25)
            .setRequired(false),
        ),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'status': await handleStatus(interaction); break;
      case 'advance': await handleAdvance(interaction); break;
      case 'preview': await handlePreview(interaction); break;
      case 'set': await handleSet(interaction); break;
      case 'pause': await handlePauseToggle(interaction, true); break;
      case 'unpause': await handlePauseToggle(interaction, false); break;
      case 'npc-house': await handleNpcHouseToggle(interaction); break;
      case 'history': await handleHistory(interaction); break;
    }
  },
};

async function handleHistory(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guild || !interaction.member) {
    await interaction.editReply({ embeds: [errorEmbed('This command must be used in a server.')] });
    return;
  }
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!(await isStaff(member))) {
    await interaction.editReply({
      embeds: [errorEmbed('You do not have permission to view simulation history.')],
    });
    return;
  }

  const limit = interaction.options.getInteger('limit') ?? 10;

  const rows = await db
    .select()
    .from(timeAdvanceLog)
    .orderBy(desc(timeAdvanceLog.createdAt))
    .limit(limit);

  if (rows.length === 0) {
    await interaction.editReply({
      embeds: [
        createEmbed({
          title: 'Time Advance History',
          description: '_No advance log entries yet._',
          system: 'simulation',
        }),
      ],
    });
    return;
  }

  const advancerIds = Array.from(new Set(rows.map((r) => r.advancedById).filter(Boolean)));
  const nameMap = new Map<string, string>();
  if (advancerIds.length > 0) {
    const playerRows = await db
      .select({
        id: players.id,
        characterName: players.characterName,
        discordUsername: players.discordUsername,
      })
      .from(players)
      .where(inArray(players.id, advancerIds));
    for (const p of playerRows) {
      nameMap.set(p.id, p.characterName ?? p.discordUsername ?? 'Unknown');
    }
  }

  const lines = rows.map((row) => {
    const advancer = nameMap.get(row.advancedById) ?? '_unknown_';
    const ticks = row.toTick - row.fromTick;
    const summary = row.summary ?? { deaths: [], ailments: [], aged: 0 };
    const deaths = summary.deaths?.length ?? 0;
    const ailments = summary.ailments?.length ?? 0;
    const aged = summary.aged ?? 0;
    const when = `<t:${Math.floor(row.createdAt.getTime() / 1000)}:R>`;
    return [
      `**${row.fromDate}** → **${row.toDate}** (${ticks > 0 ? '+' : ''}${ticks} tick${ticks === 1 ? '' : 's'})`,
      `  by **${advancer}** • ${when}`,
      `  aged: ${aged} • ailments: ${ailments} • deaths: ${deaths}`,
    ].join('\n');
  });

  await interaction.editReply({
    embeds: [
      createEmbed({
        title: 'Time Advance History',
        description: [`Showing last **${rows.length}** entr${rows.length === 1 ? 'y' : 'ies'}.`, '', lines.join('\n\n')].join('\n'),
        system: 'simulation',
      }),
    ],
  });
}

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

    const publicEmbed = createEmbed({
      title: `Time Advanced +${ticks} ${ticks === 1 ? 'tick' : 'ticks'}`,
      description: buildPublicAdvanceLines(result).join('\n'),
      system: 'simulation',
    });

    const gameEventsPost = await postGameEventsEmbed({
      client: interaction.client,
      embed: publicEmbed,
    });

    const lines = buildStaffAdvanceLines(result, graveyardPosts);
    appendGameEventsPostStatus(lines, gameEventsPost);

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

async function handleNpcHouseToggle(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const active = interaction.options.getBoolean('active', true);
  const clock = await fetchClock();

  if (!clock) {
    await interaction.editReply({ embeds: [errorEmbed('No simulation clock configured.')] });
    return;
  }

  await db.update(simulationClock)
    .set({ npcHouseActive: active, updatedAt: new Date() })
    .where(eq(simulationClock.id, clock.id));

  const embed = successEmbed(
    active ? 'NPC House Activated' : 'NPC House Deactivated',
    active
      ? 'Passed bills will now wait for NPC house review before they can be enacted.'
      : 'Passed bills will now become player-passed after the legislature vote, with no NPC house review.',
  );

  await interaction.editReply({ embeds: [embed] });
}

export default command;
