import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { simulationClock, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';
import type { AgingConfig, AilmentPoolEntry } from '@hansard/shared';

// Mirrors simulationService.previewAdvance — runs the preview logic
// inline so the bot package doesn't need to depend on the API package.

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

interface DeathDetail {
  characterName: string | null;
  age: number;
  cause: string;
}

interface AilmentDetail {
  characterName: string | null;
  condition: string;
  severity: string;
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
  const eligible = config.ailmentPool.filter((a) => !a.minAge || playerAge >= a.minAge);
  if (eligible.length === 0) return null;
  const totalWeight = eligible.reduce((sum, a) => sum + a.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const ailment of eligible) {
    roll -= ailment.weight;
    if (roll <= 0) return ailment;
  }
  return eligible[eligible.length - 1]!;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('time-preview')
    .setDescription('Dry-run preview of advancing the simulation (staff only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((opt) =>
      opt
        .setName('ticks')
        .setDescription('Number of ticks to preview (default 1)')
        .setMinValue(1)
        .setMaxValue(100),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
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
        embeds: [errorEmbed('You do not have permission to preview simulation advances.')],
      });
      return;
    }

    const ticks = interaction.options.getInteger('ticks') ?? 1;

    try {
      const [clock] = await db.select().from(simulationClock).limit(1);
      if (!clock) {
        await interaction.editReply({
          embeds: [errorEmbed('No simulation clock configured.')],
        });
        return;
      }

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

        // Ailment roll
        if (newAge >= config.ailmentAgeThreshold) {
          const ailmentChance =
            config.ailmentBaseChance + (newAge - config.ailmentAgeThreshold) * config.ailmentAgeScaling;
          if (Math.random() < ailmentChance) {
            const ailment = rollAilment(config, newAge);
            if (ailment) {
              const currentAilments = (player.ailments ?? []) as { condition: string }[];
              if (!currentAilments.some((a) => a.condition === ailment.name)) {
                ailmentDetails.push({
                  characterName: player.characterName,
                  condition: ailment.name,
                  severity: ailment.severity,
                });
              }
            }
          }
        }

        // Death roll
        const currentAilments = (player.ailments ?? []) as {
          condition: string;
          severity: 'minor' | 'major' | 'critical';
        }[];
        let deathChance = 0;
        let causeOfDeath: string | null = null;

        const criticals = currentAilments.filter((a) => a.severity === 'critical');
        if (criticals.length > 0) {
          deathChance += config.criticalAilmentDeathChance * criticals.length;
          causeOfDeath = criticals[0]!.condition;
        }
        const majors = currentAilments.filter((a) => a.severity === 'major');
        if (majors.length >= 2) {
          deathChance += 0.05 * majors.length;
          if (!causeOfDeath) causeOfDeath = 'complications from multiple ailments';
        }
        if (newAge >= config.deathAgeThreshold) {
          const ageDeathChance =
            config.deathBaseChance + (newAge - config.deathAgeThreshold) * config.deathAgeScaling;
          if (ageDeathChance > deathChance) causeOfDeath = 'natural causes';
          deathChance = Math.max(deathChance, ageDeathChance);
        }

        if (deathChance > 0 && Math.random() < deathChance) {
          deathDetails.push({
            characterName: player.characterName,
            age: newAge,
            cause: causeOfDeath ?? 'unknown causes',
          });
        }
      }

      const lines: string[] = [
        '_This is a preview — nothing has been committed._',
        '',
        `**${fromDate}** → **${toDate}**`,
        `Tick \`${fromTick}\` → \`${toTick}\``,
        '',
        `**${agedCount}** players would age`,
      ];

      if (ailmentDetails.length > 0) {
        lines.push('', '**Potential Ailments:**');
        for (const a of ailmentDetails.slice(0, 15)) {
          lines.push(`• **${a.characterName ?? 'Unknown'}** — ${a.condition} (${a.severity})`);
        }
        if (ailmentDetails.length > 15) {
          lines.push(`_…and ${ailmentDetails.length - 15} more_`);
        }
      }

      if (deathDetails.length > 0) {
        lines.push('', '⚰️ **Potential Deaths:**');
        for (const d of deathDetails.slice(0, 15)) {
          lines.push(`• **${d.characterName ?? 'Unknown'}** (age ${d.age}) — ${d.cause}`);
        }
        if (deathDetails.length > 15) {
          lines.push(`_…and ${deathDetails.length - 15} more_`);
        }
      }

      if (ailmentDetails.length === 0 && deathDetails.length === 0) {
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
  },
};

export default command;
