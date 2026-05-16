import type { ChatInputCommandInteraction } from 'discord.js';
import { eq, ilike, asc } from 'drizzle-orm';
import { offices } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';

const KNOWN_PERMISSIONS = [
  'legislative_leader',
  'appoint_ministers',
  'call_elections',
  'executive_orders',
  'veto',
];

const TIER_CHOICES = [
  'head_of_state',
  'head_of_government',
  'cabinet',
  'legislature',
  'regional',
  'other',
];

export const FIELD_CHOICES = [
  { name: 'tier', value: 'tier' },
  { name: 'permissions (comma-separated)', value: 'permissions' },
  { name: 'max-holders', value: 'max-holders' },
  { name: 'discord-role', value: 'discord-role' },
  { name: 'requires-confirmation', value: 'requires-confirmation' },
  { name: 'is-active', value: 'is-active' },
  { name: 'sort-order', value: 'sort-order' },
  { name: 'name', value: 'name' },
] as const;

function parseBool(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'on'].includes(v)) return true;
  if (['false', 'no', 'n', '0', 'off'].includes(v)) return false;
  return null;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const member = interaction.member;
  if (!member || !('roles' in member)) {
    await interaction.editReply({
      embeds: [errorEmbed('This command can only be used in a server.')],
    });
    return;
  }

  if (!(await isStaff(member))) {
    await interaction.editReply({
      embeds: [errorEmbed('Only staff can edit offices.')],
    });
    return;
  }

  const officeName = interaction.options.getString('office', true).trim();
  const field = interaction.options.getString('field', true);
  const value = interaction.options.getString('value', true).trim();

  const matches = await db
    .select()
    .from(offices)
    .where(ilike(offices.name, `%${officeName}%`))
    .orderBy(asc(offices.sortOrder));

  const target =
    matches.find((o) => o.name.toLowerCase() === officeName.toLowerCase()) ??
    matches[0];

  if (!target) {
    await interaction.editReply({
      embeds: [errorEmbed(`No office matching "${officeName}" found.`)],
    });
    return;
  }

  const updates: Record<string, unknown> = {};
  let changeSummary: string;

  switch (field) {
    case 'tier': {
      if (!TIER_CHOICES.includes(value)) {
        await interaction.editReply({
          embeds: [
            errorEmbed(
              `Unknown tier \`${value}\`. Valid: ${TIER_CHOICES.map((t) => `\`${t}\``).join(', ')}`,
            ),
          ],
        });
        return;
      }
      updates.tier = value;
      changeSummary = `tier: \`${target.tier}\` → \`${value}\``;
      break;
    }

    case 'permissions': {
      const parsed = value
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);

      const unknown = parsed.filter((p) => !KNOWN_PERMISSIONS.includes(p));
      if (unknown.length > 0) {
        await interaction.editReply({
          embeds: [
            errorEmbed(
              `Unknown permission(s): ${unknown.map((p) => `\`${p}\``).join(', ')}\n\n` +
                `Valid options:\n${KNOWN_PERMISSIONS.map((p) => `• \`${p}\``).join('\n')}`,
            ),
          ],
        });
        return;
      }
      updates.permissions = parsed.length > 0 ? parsed : null;
      const before = (target.permissions as string[] | null) ?? [];
      changeSummary = `permissions: [${before.join(', ') || '*empty*'}] → [${parsed.join(', ') || '*empty*'}]`;
      break;
    }

    case 'max-holders': {
      const n = parseInt(value, 10);
      if (isNaN(n) || n < 1 || n > 500) {
        await interaction.editReply({
          embeds: [errorEmbed('`max-holders` must be an integer between 1 and 500.')],
        });
        return;
      }
      updates.maxHolders = n;
      changeSummary = `max-holders: \`${target.maxHolders}\` → \`${n}\``;
      break;
    }

    case 'discord-role': {
      if (['none', 'null', 'clear', ''].includes(value.toLowerCase())) {
        updates.discordRoleId = null;
        changeSummary = `discord-role: \`${target.discordRoleId ?? 'none'}\` → *cleared*`;
        break;
      }
      const mentionMatch = value.match(/^<@&(\d+)>$/);
      const idMatch = value.match(/^\d+$/);
      const roleId = mentionMatch ? mentionMatch[1] : idMatch ? value : null;
      if (!roleId) {
        await interaction.editReply({
          embeds: [
            errorEmbed(
              'Provide a Discord role mention (e.g. <@&123>), a raw role snowflake, or `none` to clear.',
            ),
          ],
        });
        return;
      }
      updates.discordRoleId = roleId;
      changeSummary = `discord-role: \`${target.discordRoleId ?? 'none'}\` → <@&${roleId}>`;
      break;
    }

    case 'requires-confirmation': {
      const b = parseBool(value);
      if (b === null) {
        await interaction.editReply({
          embeds: [errorEmbed('Value must be `true` or `false`.')],
        });
        return;
      }
      updates.requiresConfirmation = b;
      changeSummary = `requires-confirmation: \`${target.requiresConfirmation}\` → \`${b}\``;
      break;
    }

    case 'is-active': {
      const b = parseBool(value);
      if (b === null) {
        await interaction.editReply({
          embeds: [errorEmbed('Value must be `true` or `false`.')],
        });
        return;
      }
      updates.isActive = b;
      changeSummary = `is-active: \`${target.isActive}\` → \`${b}\``;
      break;
    }

    case 'sort-order': {
      const n = parseInt(value, 10);
      if (isNaN(n)) {
        await interaction.editReply({
          embeds: [errorEmbed('`sort-order` must be an integer.')],
        });
        return;
      }
      updates.sortOrder = n;
      changeSummary = `sort-order: \`${target.sortOrder}\` → \`${n}\``;
      break;
    }

    case 'name': {
      if (value.length < 1 || value.length > 128) {
        await interaction.editReply({
          embeds: [errorEmbed('`name` must be 1–128 characters.')],
        });
        return;
      }
      updates.name = value;
      changeSummary = `name: \`${target.name}\` → \`${value}\``;
      break;
    }

    default:
      await interaction.editReply({
        embeds: [errorEmbed(`Unknown field \`${field}\`.`)],
      });
      return;
  }

  try {
    await db.update(offices).set(updates).where(eq(offices.id, target.id));

    await interaction.editReply({
      embeds: [
        successEmbed(
          `Office Updated: ${target.name}`,
          changeSummary,
        ),
      ],
    });
  } catch (err) {
    console.error('Failed to update office:', err);
    await interaction.editReply({
      embeds: [errorEmbed('Failed to update office. Check the bot logs for details.')],
    });
  }
}
