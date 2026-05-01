import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { offices } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

const TIER_CHOICES = [
  { name: 'Head of State', value: 'head_of_state' },
  { name: 'Head of Government', value: 'head_of_government' },
  { name: 'Cabinet', value: 'cabinet' },
  { name: 'Legislature', value: 'legislature' },
  { name: 'Regional', value: 'regional' },
  { name: 'Other', value: 'other' },
] as const;

const FILLED_BY_CHOICES = [
  { name: 'Elected — chosen via vote', value: 'elected' },
  { name: 'Appointed — by another office holder', value: 'appointed' },
  { name: 'Staff — assigned by staff directly', value: 'staff' },
] as const;

const KNOWN_PERMISSIONS = [
  'legislative_leader',
  'appoint_ministers',
  'call_elections',
  'executive_orders',
  'veto',
];

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('office-create')
    .setDescription('Create a new office (staff only)')
    .addStringOption((opt) =>
      opt
        .setName('name')
        .setDescription('Display name, e.g. "Chancellor"')
        .setRequired(true)
        .setMaxLength(128),
    )
    .addStringOption((opt) =>
      opt
        .setName('tier')
        .setDescription('Where this office sits in the hierarchy')
        .setRequired(true)
        .addChoices(...TIER_CHOICES),
    )
    .addStringOption((opt) =>
      opt
        .setName('permissions')
        .setDescription('Comma-separated permissions, e.g. "legislative_leader,call_elections"')
        .setRequired(false),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('max-holders')
        .setDescription('How many people can hold this office at once (default 1)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(500),
    )
    .addStringOption((opt) =>
      opt
        .setName('filled-by')
        .setDescription('How the office is filled (default: elected)')
        .setRequired(false)
        .addChoices(...FILLED_BY_CHOICES),
    )
    .addRoleOption((opt) =>
      opt
        .setName('discord-role')
        .setDescription('Discord role to grant holders of this office')
        .setRequired(false),
    )
    .addBooleanOption((opt) =>
      opt
        .setName('requires-confirmation')
        .setDescription('Require NPC house confirmation before taking effect')
        .setRequired(false),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
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
        embeds: [errorEmbed('Only staff can create offices.')],
      });
      return;
    }

    const name = interaction.options.getString('name', true).trim();
    const tier = interaction.options.getString('tier', true);
    const permissionsRaw = interaction.options.getString('permissions');
    const maxHolders = interaction.options.getInteger('max-holders') ?? 1;
    const filledBy = interaction.options.getString('filled-by') ?? 'elected';
    const discordRole = interaction.options.getRole('discord-role');
    const requiresConfirmation = interaction.options.getBoolean('requires-confirmation') ?? false;

    let permissions: string[] | null = null;
    if (permissionsRaw) {
      permissions = permissionsRaw
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);

      const unknown = permissions.filter((p) => !KNOWN_PERMISSIONS.includes(p));
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
    }

    try {
      const [created] = await db
        .insert(offices)
        .values({
          name,
          tier,
          maxHolders,
          permissions,
          filledBy,
          requiresConfirmation,
          discordRoleId: discordRole?.id ?? null,
        })
        .returning();

      const summary = [
        `**Tier:** ${tier}`,
        `**Filled by:** ${filledBy}`,
        `**Max holders:** ${maxHolders}`,
        `**Permissions:** ${permissions?.length ? permissions.map((p) => `\`${p}\``).join(', ') : '_(none)_'}`,
        `**Discord role:** ${discordRole ? `<@&${discordRole.id}>` : '_(none)_'}`,
        `**Requires confirmation:** ${requiresConfirmation ? 'yes' : 'no'}`,
        '',
        `Use \`/appoint office:${created.name} user:@player\` to assign someone.`,
      ].join('\n');

      await interaction.editReply({
        embeds: [successEmbed(`Office created: ${created.name}`, summary)],
      });
    } catch (err) {
      console.error('Failed to create office:', err);
      await interaction.editReply({
        embeds: [errorEmbed('Failed to create office. Check the bot logs for details.')],
      });
    }
  },
};

export default command;
