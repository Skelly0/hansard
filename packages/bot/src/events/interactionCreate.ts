import {
  Events,
  type Client,
  type Interaction,
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { commands } from '../client.js';
import { errorEmbed } from '../utils/embeds.js';
import { handleTicketButton, handleSetPriorityButton } from '../components/ticketButtons.js';
import { handleTicketModal } from '../components/ticketModals.js';
import { handleVoteButton, handleVoteCancel, isVoteButton } from '../components/voteButtons.js';
import { handleVoteCreateModal } from '../commands/vote/create.js';

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const command = commands.get(interaction.commandName);

  if (!command) {
    await interaction.reply({
      embeds: [errorEmbed(`Unknown command: \`/${interaction.commandName}\``)],
      ephemeral: true,
    });
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error executing /${interaction.commandName}:`, error);

    const embed = errorEmbed('Something went wrong while executing that command.');

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ embeds: [embed], ephemeral: true });
    } else {
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
}

/**
 * Custom ID prefixes that are handled by interaction-level collectors
 * within command flows (e.g. character creation, party management).
 * The global handler should not respond to these.
 */
const COLLECTOR_MANAGED_PREFIXES = [
  'char_create_', 'char_edit_', 'char_confirm_', 'char_cancel_',
  'portrait_skip_', 'faction_sel_', 'party_sel_',
  'pagination_',
  'ticket_category_select:', 'ticket_create_modal:',
];

function isCollectorManaged(customId: string): boolean {
  return COLLECTOR_MANAGED_PREFIXES.some((prefix) => customId.startsWith(prefix));
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  // Skip interactions managed by command-level collectors
  if (isCollectorManaged(interaction.customId)) return;

  // Ticket buttons
  if (await handleTicketButton(interaction)) return;
  if (await handleSetPriorityButton(interaction)) return;

  // Vote buttons
  if (isVoteButton(interaction.customId)) {
    if (interaction.customId === 'vote-cancel') {
      await handleVoteCancel(interaction);
    } else {
      await handleVoteButton(interaction);
    }
    return;
  }

  // Unhandled button — acknowledge gracefully
  console.log(`Unhandled button interaction: ${interaction.customId}`);
  await interaction.reply({
    embeds: [errorEmbed('This button is not yet implemented.')],
    ephemeral: true,
  });
}

async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  // Skip interactions managed by command-level collectors
  if (isCollectorManaged(interaction.customId)) return;

  // Ticket modals
  if (await handleTicketModal(interaction)) return;

  // Vote creation modal
  if (interaction.customId.startsWith('vote-create:')) {
    await handleVoteCreateModal(interaction);
    return;
  }

  // Unhandled modal — acknowledge gracefully
  console.log(`Unhandled modal submission: ${interaction.customId}`);
  await interaction.reply({
    embeds: [errorEmbed('This modal is not yet implemented.')],
    ephemeral: true,
  });
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  // Skip interactions managed by command-level collectors
  if (isCollectorManaged(interaction.customId)) return;

  // Unhandled select menu
  console.log(`Unhandled select menu interaction: ${interaction.customId}`);
  await interaction.reply({
    embeds: [errorEmbed('This select menu is not yet implemented.')],
    ephemeral: true,
  });
}

export function registerInteractionCreateEvent(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction);
      } else if (interaction.isButton()) {
        await handleButton(interaction);
      } else if (interaction.isModalSubmit()) {
        await handleModalSubmit(interaction);
      } else if (interaction.isStringSelectMenu()) {
        await handleSelectMenu(interaction);
      }
    } catch (error) {
      console.error('Unhandled error in interaction handler:', error);
    }
  });
}
