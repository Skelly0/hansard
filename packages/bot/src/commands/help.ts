import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { commands, type Command } from '../client.js';
import { createEmbed, type System, type EmbedField } from '../utils/embeds.js';
import { isStaff } from '../utils/permissions.js';

const SYSTEM_BY_PREFIX: Array<{ match: (name: string) => boolean; system: System; label: string }> = [
  { match: (n) => n === 'bill', system: 'bills', label: 'Bills' },
  { match: (n) => n === 'vote', system: 'voting', label: 'Voting & Elections' },
  { match: (n) => n === 'ticket', system: 'tickets', label: 'Tickets' },
  { match: (n) => n === 'doc', system: 'bills', label: 'Documents' },
  { match: (n) => n === 'favour', system: 'favours', label: 'Favours' },
  { match: (n) => n === 'office' || n === 'sync-roles', system: 'offices', label: 'Offices' },
  { match: (n) => n === 'party', system: 'offices', label: 'Parties' },
  { match: (n) => n === 'character' || n === 'player', system: 'players', label: 'Players' },
  { match: (n) => n === 'time', system: 'simulation', label: 'Simulation' },
  { match: (n) => n === 'mod', system: 'moderation', label: 'Moderation' },
  { match: (n) => n === 'faction', system: 'offices', label: 'Factions' },
  { match: (n) => n === 'phone', system: 'simulation', label: 'Phones' },
  { match: (n) => n === 'ping' || n === 'help' || n === 'dashboard', system: 'simulation', label: 'Utility' },
];

function categorize(cmd: Command): { label: string } {
  const name = cmd.data.name;
  for (const entry of SYSTEM_BY_PREFIX) {
    if (entry.match(name)) return { label: entry.label };
  }
  return { label: 'Other' };
}

function commandIsRestricted(cmd: Command): boolean {
  const json = cmd.data.toJSON();
  if (json.default_member_permissions != null) return true;

  const markerText = `${json.name} ${json.description}`;
  return /\b(staff|admin|moderation)\b/i.test(markerText);
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show available commands grouped by system'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const staffViewer = interaction.guild && interaction.member
      ? await isStaff(await interaction.guild.members.fetch(interaction.user.id))
      : false;

    const grouped = new Map<string, Command[]>();
    for (const cmd of commands.values()) {
      if (!staffViewer && commandIsRestricted(cmd)) continue;
      const { label } = categorize(cmd);
      if (!grouped.has(label)) grouped.set(label, []);
      grouped.get(label)!.push(cmd);
    }

    // Discord limits: 1024 chars per field value, 25 fields per embed,
    // 6000 chars total per embed. Split categories into chunks, then pack
    // chunks into embeds, sending overflow as followUp messages.
    const FIELD_VALUE_LIMIT = 1024;
    const EMBED_TOTAL_LIMIT = 5500; // safety margin under 6000
    const FIELDS_PER_EMBED = 24;

    const allFields: EmbedField[] = [];
    for (const [label, cmds] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const lines = cmds
        .sort((a, b) => a.data.name.localeCompare(b.data.name))
        .map((c) => `\`/${c.data.name}\` — ${c.data.description}`);

      const chunks: string[] = [];
      let current = '';
      for (const line of lines) {
        const candidate = current ? `${current}\n${line}` : line;
        if (candidate.length > FIELD_VALUE_LIMIT) {
          if (current) chunks.push(current);
          current = line.length > FIELD_VALUE_LIMIT ? line.slice(0, FIELD_VALUE_LIMIT - 1) + '…' : line;
        } else {
          current = candidate;
        }
      }
      if (current) chunks.push(current);

      chunks.forEach((value, i) => {
        allFields.push({
          name: chunks.length > 1 ? `${label} (${i + 1}/${chunks.length})` : label,
          value,
        });
      });
    }

    const fieldGroups: EmbedField[][] = [];
    let bucket: EmbedField[] = [];
    let bucketChars = 0;
    for (const field of allFields) {
      const fieldChars = field.name.length + field.value.length;
      if (bucket.length >= FIELDS_PER_EMBED || bucketChars + fieldChars > EMBED_TOTAL_LIMIT) {
        if (bucket.length) fieldGroups.push(bucket);
        bucket = [];
        bucketChars = 0;
      }
      bucket.push(field);
      bucketChars += fieldChars;
    }
    if (bucket.length) fieldGroups.push(bucket);

    const totalPages = fieldGroups.length;
    for (let i = 0; i < totalPages; i++) {
      const isFirst = i === 0;
      const pageSuffix = totalPages > 1 ? ` (${i + 1}/${totalPages})` : '';
      const embed = createEmbed({
        title: `Hansard — Commands${pageSuffix}`,
        description: isFirst
          ? 'A ledger of available slash commands, grouped by system. Type `/` in any channel to invoke.'
          : undefined,
        system: 'simulation',
        fields: fieldGroups[i],
      });

      if (isFirst) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.followUp({ embeds: [embed], ephemeral: true });
      }
    }
  },
};

export default command;
