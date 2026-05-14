import {
  Events,
  type Client,
  type Interaction,
  type AutocompleteInteraction,
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { commands } from '../client.js';
import { errorEmbed } from '../utils/embeds.js';
import { isAwaitingInteraction } from '../utils/awaitingInteractions.js';
import { handleTicketButton, handleSetPriorityButton } from '../components/ticketButtons.js';
import { handleTicketModal } from '../components/ticketModals.js';
import { handleVoteButton, handleVoteCancel, isVoteButton } from '../components/voteButtons.js';
import { handleVoteCreateModal } from '../commands/vote/create.js';
import { handlePhoneButton, isPhoneButton } from '../components/phoneButtons.js';

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
  'vote_create_bill_select:', 'vote_create_bill_modal:',
  'bill_submit_type:', 'bill_submit_modal:',
];

/**
 * Prefixes whose commands opt in to the stale-token recovery scheme
 * (i.e. they call `registerAwaitingInteraction` / `unregisterAwaitingInteraction`
 * around their awaits). For these, the global handler can safely ack a
 * collector-managed customId that is NOT in the registry as "stale".
 *
 * Prefixes in `COLLECTOR_MANAGED_PREFIXES` but NOT here keep the original
 * silent-bail behaviour (commit 1704822) — without the registry call, we
 * can't tell in-flight from stale, so silence is the only safe choice.
 */
const STALE_RECOVERY_PREFIXES = [
  'ticket_category_select:', 'ticket_create_modal:',
];

function isCollectorManaged(customId: string): boolean {
  return COLLECTOR_MANAGED_PREFIXES.some((prefix) => customId.startsWith(prefix));
}

function isStaleRecoveryEnabled(customId: string): boolean {
  return STALE_RECOVERY_PREFIXES.some((prefix) => customId.startsWith(prefix));
}

/**
 * Acknowledge a collector-managed interaction whose awaiter has already
 * expired — without this, Discord paints "Something went wrong" on the
 * user's screen because nothing responded within the 3-second window.
 * Commands that participate must register their customIds via
 * `registerAwaitingInteraction` so the in-flight case is preserved.
 */
async function ackStaleCollectorInteraction(
  interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.reply({
      embeds: [
        errorEmbed(
          'That session has expired. Please run the command again.',
        ),
      ],
      ephemeral: true,
    });
  } catch (error) {
    console.error(
      `Failed to ack stale collector interaction ${interaction.customId}:`,
      error,
    );
  }
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  // Collector-managed: in-flight → bail to avoid racing the awaiter;
  // stale (no live awaiter) → ack so Discord doesn't show "Something went wrong".
  if (isCollectorManaged(interaction.customId)) {
    // Only opt-in prefixes participate in stale-token recovery. Others keep
    // the original silent-bail (commit 1704822) so we don't race awaiters
    // that aren't using the `awaitingInteractions` registry.
    if (
      isStaleRecoveryEnabled(interaction.customId) &&
      !isAwaitingInteraction(interaction.customId)
    ) {
      await ackStaleCollectorInteraction(interaction);
    }
    return;
  }

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

  // Phone answer/decline buttons (persistent customIds on ring DMs)
  if (isPhoneButton(interaction.customId)) {
    await handlePhoneButton(interaction);
    return;
  }

  // Unhandled button — log and bow out. Any command using
  // `awaitMessageComponent` also receives this event; replying here would
  // race the awaiter and cause its `deferReply()`/`update()` to fail with
  // `Unknown interaction` (10062).
  console.log(`Unhandled button interaction: ${interaction.customId}`);
}

async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  // Collector-managed: in-flight → bail to avoid racing the awaiter;
  // stale (no live awaiter) → ack so Discord doesn't show "Something went wrong".
  if (isCollectorManaged(interaction.customId)) {
    // Only opt-in prefixes participate in stale-token recovery. Others keep
    // the original silent-bail (commit 1704822) so we don't race awaiters
    // that aren't using the `awaitingInteractions` registry.
    if (
      isStaleRecoveryEnabled(interaction.customId) &&
      !isAwaitingInteraction(interaction.customId)
    ) {
      await ackStaleCollectorInteraction(interaction);
    }
    return;
  }

  // Ticket modals
  if (await handleTicketModal(interaction)) return;

  // Vote creation modal
  if (interaction.customId.startsWith('vote-create:')) {
    await handleVoteCreateModal(interaction);
    return;
  }

  // Unhandled modal — log and bow out. Any command using `awaitModalSubmit`
  // also receives this event; replying here would race the awaiter and
  // cause its `deferReply()` to fail with `Unknown interaction` (10062).
  console.log(`Unhandled modal submission: ${interaction.customId}`);
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  // Collector-managed: in-flight → bail to avoid racing the awaiter;
  // stale (no live awaiter) → ack so Discord doesn't show "Something went wrong".
  if (isCollectorManaged(interaction.customId)) {
    // Only opt-in prefixes participate in stale-token recovery. Others keep
    // the original silent-bail (commit 1704822) so we don't race awaiters
    // that aren't using the `awaitingInteractions` registry.
    if (
      isStaleRecoveryEnabled(interaction.customId) &&
      !isAwaitingInteraction(interaction.customId)
    ) {
      await ackStaleCollectorInteraction(interaction);
    }
    return;
  }

  // Unhandled select menu — log and bow out. Same reasoning as
  // `handleButton`: an awaiting command would lose the response token.
  console.log(`Unhandled select menu interaction: ${interaction.customId}`);
}

async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const command = commands.get(interaction.commandName);
  if (!command?.autocomplete) {
    // No handler registered — respond with empty list so Discord doesn't hang.
    if (!interaction.responded) {
      try {
        await interaction.respond([]);
      } catch {
        // Token may already be expired; nothing useful to do.
      }
    }
    return;
  }

  try {
    await command.autocomplete(interaction);
  } catch (error) {
    console.error(`Error in autocomplete for /${interaction.commandName}:`, error);
    if (!interaction.responded) {
      try {
        await interaction.respond([]);
      } catch {
        /* swallow */
      }
    }
  }
}

export function registerInteractionCreateEvent(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction);
      } else if (interaction.isAutocomplete()) {
        await handleAutocomplete(interaction);
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
