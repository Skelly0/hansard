import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../../db.js';
import {
  simulationClock,
  timeAdvanceLog,
  players,
  playerEventLog,
  officeHolders,
  offices,
} from '@hansard/db';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import type { Command } from '../../client.js';
import type { AgingConfig, AilmentPoolEntry, TimeAdvanceSummary } from '@hansard/shared';

// ============================================================
// Default Aging Config (mirrors the API service)
// ============================================================

const DEFAULT_AGING_CONFIG: AgingConfig = {
  ailmentAgeThreshold: 55,
  ailmentBaseChance: 0.05,
  ailmentAgeScaling: 0.02,
  deathAgeThreshold: 70,
  deathBaseChance: 0.02,
  deathAgeScaling: 0.03,
  criticalAilmentDeathChance: 0.15,
  ailmentPool: [
    { name: 'gout', severity: 'minor', weight: 3, description: 'Painful joint inflammation' },
    { name: 'fever', severity: 'minor', weight: 3, description: 'Persistent high fever' },
    { name: 'pneumonia', severity: 'major', weight: 2, description: 'Severe lung infection' },
    { name: 'heart disease', severity: 'major', weight: 2, minAge: 60, description: 'Weakening of the heart' },
    { name: 'tuberculosis', severity: 'major', weight: 1, description: 'Wasting disease of the lungs' },
    { name: 'stroke', severity: 'critical', weight: 1, minAge: 65, description: 'Sudden cerebral event' },
  ],
  minStartingAge: 18,
  maxStartingAge: 70,
  defaultStartingAge: 30,
  startingAgeFavourBonus: { enabled: false, tiers: [] },
};

// ============================================================
// Inline helpers (same logic as simulationService.ts)
// ============================================================

type AilmentEntry = {
  condition: string;
  severity: 'minor' | 'major' | 'critical';
  acquiredAtTick: number;
  acquiredAtAge: number;
  notes?: string;
};

interface DeathDetail {
  playerId: string;
  characterName: string | null;
  age: number | null;
  cause: string;
}

interface AilmentDetail {
  playerId: string;
  characterName: string | null;
  condition: string;
  severity: string;
}

interface AdvanceResult {
  fromTick: number;
  toTick: number;
  fromDate: string;
  toDate: string;
  summary: TimeAdvanceSummary;
  deathDetails: DeathDetail[];
  ailmentDetails: AilmentDetail[];
  aged: number;
}

function advanceDateByTicks(dateStr: string, ticks: number, tickUnit: string): string {
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const date = new Date(`${dateStr}T00:00:00Z`);
    switch (tickUnit) {
      case 'day': date.setUTCDate(date.getUTCDate() + ticks); break;
      case 'week': date.setUTCDate(date.getUTCDate() + ticks * 7); break;
      case 'month': date.setUTCMonth(date.getUTCMonth() + ticks); break;
      case 'year': date.setUTCFullYear(date.getUTCFullYear() + ticks); break;
    }
    return date.toISOString().split('T')[0]!;
  }
  const freeformMatch = dateStr.match(/Year\s+(\d+),?\s*Month\s+(\d+)/i);
  if (freeformMatch) {
    let year = parseInt(freeformMatch[1]!, 10);
    let month = parseInt(freeformMatch[2]!, 10);
    switch (tickUnit) {
      case 'month': case 'day': case 'week':
        month += ticks;
        while (month > 12) { month -= 12; year++; }
        while (month < 1) { month += 12; year--; }
        break;
      case 'year': year += ticks; break;
    }
    return `Year ${year}, Month ${month}`;
  }
  return `${dateStr} +${ticks} ${tickUnit}s`;
}

function ageIncrementPerTick(tickUnit: string): number {
  switch (tickUnit) {
    case 'year': return 1;
    case 'month': return 1 / 12;
    case 'week': return 1 / 52;
    case 'day': return 1 / 365;
    default: return 1;
  }
}

function rollAilment(config: AgingConfig, playerAge: number): AilmentPoolEntry | null {
  const eligible = config.ailmentPool.filter(a => !a.minAge || playerAge >= a.minAge);
  if (eligible.length === 0) return null;
  const totalWeight = eligible.reduce((sum, a) => sum + a.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const ailment of eligible) {
    roll -= ailment.weight;
    if (roll <= 0) return ailment;
  }
  return eligible[eligible.length - 1]!;
}

function getWorstSeverity(ailments: { severity: string }[]): string {
  if (ailments.some(a => a.severity === 'critical')) return 'critical';
  if (ailments.some(a => a.severity === 'major')) return 'major';
  if (ailments.some(a => a.severity === 'minor')) return 'minor';
  return 'healthy';
}

async function processPlayerDeath(
  playerId: string,
  causeOfDeath: string,
  deathDate: string,
  deathTick: number,
  triggeredById: string | null,
  isAutomatic: boolean,
) {
  await db.update(players).set({
    isAlive: false, deathDate, causeOfDeath, healthStatus: 'deceased',
  }).where(eq(players.id, playerId));

  await db.insert(playerEventLog).values({
    playerId, eventType: 'death',
    description: `Died of ${causeOfDeath}`,
    newValue: { causeOfDeath, deathDate },
    simTick: deathTick, simDate: deathDate,
    triggeredById, isAutomatic,
  });

  const heldOffices = await db.select({
    holderId: officeHolders.id, officeId: officeHolders.officeId, officeName: offices.name,
  }).from(officeHolders)
    .innerJoin(offices, eq(officeHolders.officeId, offices.id))
    .where(and(eq(officeHolders.playerId, playerId), isNull(officeHolders.endDate)));

  for (const held of heldOffices) {
    await db.update(officeHolders).set({ endDate: new Date(), removalReason: 'died' })
      .where(eq(officeHolders.id, held.holderId));
    await db.insert(playerEventLog).values({
      playerId, eventType: 'office_left',
      description: `Vacated ${held.officeName} (died in office)`,
      oldValue: { officeId: held.officeId, officeName: held.officeName },
      simTick: deathTick, simDate: deathDate,
      triggeredById, isAutomatic,
    });
  }
}

async function fetchClock() {
  const rows = await db.select().from(simulationClock).limit(1);
  return rows[0] ?? null;
}

async function runAdvance(ticks: number, advancedById: string, dryRun: boolean): Promise<AdvanceResult> {
  const clock = await fetchClock();
  if (!clock) throw new Error('No simulation clock found. Create one first.');
  if (!dryRun && clock.isPaused) throw new Error('Simulation clock is paused. Unpause before advancing.');

  const config = DEFAULT_AGING_CONFIG;
  const fromTick = clock.currentTick;
  const toTick = fromTick + ticks;
  const fromDate = clock.currentDate;
  const toDate = advanceDateByTicks(fromDate, ticks, clock.tickUnit);
  const ageIncrement = ageIncrementPerTick(clock.tickUnit) * ticks;

  const livingPlayers = await db.select().from(players).where(eq(players.isAlive, true));

  const deathDetails: DeathDetail[] = [];
  const ailmentDetails: AilmentDetail[] = [];
  let agedCount = 0;

  for (const player of livingPlayers) {
    if (player.currentAge == null) continue;

    const newAge = Math.floor(player.currentAge + ageIncrement);
    if (newAge !== player.currentAge) agedCount++;

    if (!dryRun) {
      await db.update(players).set({ currentAge: newAge }).where(eq(players.id, player.id));
    }

    // Ailment roll
    if (newAge >= config.ailmentAgeThreshold) {
      const ailmentChance = config.ailmentBaseChance + (newAge - config.ailmentAgeThreshold) * config.ailmentAgeScaling;
      if (Math.random() < ailmentChance) {
        const ailment = rollAilment(config, newAge);
        if (ailment) {
          const currentAilments = (player.ailments ?? []) as AilmentEntry[];
          if (!currentAilments.some(a => a.condition === ailment.name)) {
            if (!dryRun) {
              const newAilmentEntry: AilmentEntry = {
                condition: ailment.name, severity: ailment.severity,
                acquiredAtTick: toTick, acquiredAtAge: newAge,
              };
              const updatedAilments = [...currentAilments, newAilmentEntry];
              await db.update(players).set({
                ailments: updatedAilments, healthStatus: getWorstSeverity(updatedAilments),
              }).where(eq(players.id, player.id));
              await db.insert(playerEventLog).values({
                playerId: player.id, eventType: 'ailment_acquired',
                description: `Acquired ${ailment.severity} ailment: ${ailment.name}`,
                newValue: newAilmentEntry, simTick: toTick, simDate: toDate, isAutomatic: true,
              });
              // Update local ref for death roll
              player.ailments = updatedAilments as typeof player.ailments;
            }
            ailmentDetails.push({
              playerId: player.id, characterName: player.characterName,
              condition: ailment.name, severity: ailment.severity,
            });
          }
        }
      }
    }

    // Death roll
    const currentAilments = (player.ailments ?? []) as AilmentEntry[];
    let deathChance = 0;
    let causeOfDeath: string | null = null;

    const criticals = currentAilments.filter(a => a.severity === 'critical');
    if (criticals.length > 0) {
      deathChance += config.criticalAilmentDeathChance * criticals.length;
      causeOfDeath = criticals[0]!.condition;
    }
    const majors = currentAilments.filter(a => a.severity === 'major');
    if (majors.length >= 2) {
      deathChance += 0.05 * majors.length;
      if (!causeOfDeath) causeOfDeath = 'complications from multiple ailments';
    }
    if (newAge >= config.deathAgeThreshold) {
      const ageDeathChance = config.deathBaseChance + (newAge - config.deathAgeThreshold) * config.deathAgeScaling;
      if (ageDeathChance > deathChance) causeOfDeath = 'natural causes';
      deathChance = Math.max(deathChance, ageDeathChance);
    }

    if (deathChance > 0 && Math.random() < deathChance) {
      if (!dryRun) {
        await processPlayerDeath(player.id, causeOfDeath ?? 'unknown causes', toDate, toTick, null, true);
      }
      deathDetails.push({
        playerId: player.id, characterName: player.characterName,
        age: newAge, cause: causeOfDeath ?? 'unknown causes',
      });
    }
  }

  if (!dryRun) {
    await db.update(simulationClock).set({
      currentTick: toTick, currentDate: toDate, updatedAt: new Date(),
    }).where(eq(simulationClock.id, clock.id));

    const summary: TimeAdvanceSummary = {
      deaths: deathDetails.map(d => d.playerId),
      ailments: ailmentDetails.map(a => a.playerId),
      aged: agedCount,
    };
    await db.insert(timeAdvanceLog).values({
      fromTick, toTick, fromDate, toDate, advancedById, summary,
    });
  }

  return {
    fromTick, toTick, fromDate, toDate,
    summary: {
      deaths: deathDetails.map(d => d.playerId),
      ailments: ailmentDetails.map(a => a.playerId),
      aged: agedCount,
    },
    deathDetails, ailmentDetails, aged: agedCount,
  };
}

// ============================================================
// Command
// ============================================================

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
  await interaction.deferReply();
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

    const result = await runAdvance(ticks, staffPlayer.id, false);

    const lines: string[] = [
      `**${result.fromDate}** \u2192 **${result.toDate}**`,
      `Tick \`${result.fromTick}\` \u2192 \`${result.toTick}\``,
      '',
      `**${result.aged}** players aged`,
    ];

    if (result.ailmentDetails.length > 0) {
      lines.push('', '**New Ailments:**');
      for (const a of result.ailmentDetails) {
        lines.push(`\u2022 **${a.characterName ?? 'Unknown'}** \u2014 ${a.condition} (${a.severity})`);
      }
    }

    if (result.deathDetails.length > 0) {
      lines.push('', '\u26B0\uFE0F **Deaths:**');
      for (const d of result.deathDetails) {
        lines.push(`\u2022 **${d.characterName ?? 'Unknown'}** (age ${d.age}) \u2014 ${d.cause}`);
      }
    }

    if (result.ailmentDetails.length === 0 && result.deathDetails.length === 0) {
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
    const result = await runAdvance(ticks, '', true);

    const lines: string[] = [
      '**This is a preview \u2014 nothing has been committed.**',
      '',
      `**${result.fromDate}** \u2192 **${result.toDate}**`,
      `Tick \`${result.fromTick}\` \u2192 \`${result.toTick}\``,
      '',
      `**${result.aged}** players would age`,
    ];

    if (result.ailmentDetails.length > 0) {
      lines.push('', '**Potential Ailments:**');
      for (const a of result.ailmentDetails) {
        lines.push(`\u2022 **${a.characterName ?? 'Unknown'}** \u2014 ${a.condition} (${a.severity})`);
      }
    }

    if (result.deathDetails.length > 0) {
      lines.push('', '\u26B0\uFE0F **Potential Deaths:**');
      for (const d of result.deathDetails) {
        lines.push(`\u2022 **${d.characterName ?? 'Unknown'}** (age ${d.age}) \u2014 ${d.cause}`);
      }
    }

    if (result.ailmentDetails.length === 0 && result.deathDetails.length === 0) {
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
