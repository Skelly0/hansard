import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { commands, type Command } from '../client.js';
import { createEmbed, type System, type EmbedField } from '../utils/embeds.js';

const SYSTEM_BY_PREFIX: Array<{ match: (name: string) => boolean; system: System; label: string }> = [
  { match: (n) => n.startsWith('bill') || n === 'npc-bill', system: 'bills', label: 'Bills' },
  { match: (n) => n.startsWith('vote') || n.startsWith('candidate') || n === 'elect' || n === 'npc-confirm', system: 'voting', label: 'Voting & Elections' },
  { match: (n) => n.startsWith('ticket'), system: 'tickets', label: 'Tickets' },
  { match: (n) => n.startsWith('doc'), system: 'bills', label: 'Documents' },
  { match: (n) => n.startsWith('favour'), system: 'favours', label: 'Favours' },
  { match: (n) => n.startsWith('office') || n === 'appoint' || n === 'dismiss' || n === 'sync-roles', system: 'offices', label: 'Offices' },
  { match: (n) => n.startsWith('party'), system: 'offices', label: 'Parties' },
  { match: (n) => n === 'character' || n === 'lookup' || n === 'history' || n === 'whois' || n === 'roster' || n.startsWith('player'), system: 'players', label: 'Players' },
  { match: (n) => n === 'ailment' || n === 'kill' || n === 'heal' || n.startsWith('time'), system: 'simulation', label: 'Simulation' },
  { match: (n) => n.startsWith('mod'), system: 'moderation', label: 'Moderation' },
  { match: (n) => n === 'ping' || n === 'help' || n === 'dashboard', system: 'simulation', label: 'Utility' },
];

function categorize(cmd: Command): { label: string } {
  const name = cmd.data.name;
  for (const entry of SYSTEM_BY_PREFIX) {
    if (entry.match(name)) return { label: entry.label };
  }
  return { label: 'Other' };
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available commands grouped by system'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const grouped = new Map<string, Command[]>();
    for (const cmd of commands.values()) {
      const { label } = categorize(cmd);
      if (!grouped.has(label)) grouped.set(label, []);
      grouped.get(label)!.push(cmd);
    }

    const fields: EmbedField[] = [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, cmds]) => ({
        name: label,
        value: cmds
          .sort((a, b) => a.data.name.localeCompare(b.data.name))
          .map((c) => `\`/${c.data.name}\` — ${c.data.description}`)
          .join('\n'),
      }));

    const embed = createEmbed({
      title: 'Hansard — Commands',
      description: 'A ledger of every slash command, grouped by system. Type `/` in any channel to invoke.',
      system: 'simulation',
      fields,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
