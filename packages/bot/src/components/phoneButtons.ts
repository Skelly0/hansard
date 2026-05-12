import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
} from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { db } from '../db.js';
import { eq } from 'drizzle-orm';
import { players } from '@hansard/db';
import {
  PhoneService,
  PhoneServiceError,
} from '@hansard/api/services/phoneService';
import { hangUpAndNotify, postCallOpenedToStaffThread } from '../utils/phoneRelay.js';
import { errorEmbed } from '../utils/embeds.js';

export const PHONE_ANSWER_PREFIX = 'phone_answer:';
export const PHONE_DECLINE_PREFIX = 'phone_decline:';

export function isPhoneButton(customId: string): boolean {
  return customId.startsWith(PHONE_ANSWER_PREFIX) || customId.startsWith(PHONE_DECLINE_PREFIX);
}

export function buildIncomingCallActions(callId: string): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`${PHONE_ANSWER_PREFIX}${callId}`)
      .setLabel('Answer')
      .setStyle(ButtonStyle.Success)
      .setEmoji('\u{1F4DE}'), // 📞
    new ButtonBuilder()
      .setCustomId(`${PHONE_DECLINE_PREFIX}${callId}`)
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('\u{1F6AB}'), // 🚫
  );
  return row;
}

async function resolvePlayerByDiscordId(discordId: string): Promise<{ id: string; characterName: string | null } | null> {
  const [row] = await db
    .select({ id: players.id, characterName: players.characterName })
    .from(players)
    .where(eq(players.discordId, discordId))
    .limit(1);
  return row ?? null;
}

/** Returns true if the interaction was a phone button and we handled it. */
export async function handlePhoneButton(interaction: ButtonInteraction): Promise<boolean> {
  const customId = interaction.customId;
  if (!isPhoneButton(customId)) return false;

  const [prefix, callId] = customId.includes(':') ? [
    customId.startsWith(PHONE_ANSWER_PREFIX) ? PHONE_ANSWER_PREFIX : PHONE_DECLINE_PREFIX,
    customId.slice(customId.indexOf(':') + 1),
  ] : [customId, ''];

  if (!callId) {
    await interaction.reply({ embeds: [errorEmbed('Malformed phone button.')], ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  const player = await resolvePlayerByDiscordId(interaction.user.id);
  if (!player || !player.characterName) {
    await interaction.editReply({
      embeds: [errorEmbed('You need an active character to use the phone system.')],
    });
    return true;
  }

  const svc = new PhoneService(db);

  if (prefix === PHONE_ANSWER_PREFIX) {
    try {
      await svc.answerCall(callId, player.id);
    } catch (err) {
      if (err instanceof PhoneServiceError) {
        await interaction.editReply({ embeds: [errorEmbed(err.message)] });
      } else {
        console.error('[phone:button] answer failed:', err);
        await interaction.editReply({ embeds: [errorEmbed('Failed to answer the call.')] });
      }
      return true;
    }

    // Disable the buttons on the ring message and update the embed text.
    try {
      const message = interaction.message;
      const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('phone_answered_disabled')
          .setLabel('Connected')
          .setStyle(ButtonStyle.Success)
          .setDisabled(true),
      );
      const connectedEmbed = new EmbedBuilder()
        .setTitle('\u{1F4DE} Call connected')
        .setColor(0x788c5d)
        .setDescription(
          'You answered the call. Type any message in this DM to speak — every message is logged and cannot be edited or deleted. Use `/phone hangup` to end the call.',
        );
      await message.edit({ embeds: [connectedEmbed], components: [disabledRow] });
    } catch (err) {
      console.error('[phone:button] answer: failed to update ring DM:', err);
    }

    // Notify the caller via DM + open the staff thread immediately. Without the staff-thread
    // creation here, a call that connects and then hangs up without anyone typing leaves no
    // staff audit thread, violating the "fully-mirrored ledger" promise.
    try {
      const participants = await svc.getCallParticipants(callId);
      // Best-effort: open the staff thread now so zero-message calls still get oversight.
      await postCallOpenedToStaffThread(interaction.client, participants);
      const callerUser = await interaction.client.users.fetch(participants.callerPlayer.discordId);
      await callerUser.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('\u{1F4DE} Call connected')
            .setColor(0x788c5d)
            .setDescription('Your call was answered. Type any message in this DM to speak. `/phone hangup` ends the call.'),
        ],
      });
    } catch (err) {
      console.error('[phone:button] answer: failed to notify caller / open staff thread:', err);
    }

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Call answered')
          .setColor(0x788c5d)
          .setDescription('You are now connected. Type messages in this DM channel.'),
      ],
    });
    return true;
  }

  // Decline path
  try {
    await svc.declineCall(callId, player.id);
  } catch (err) {
    if (err instanceof PhoneServiceError) {
      await interaction.editReply({ embeds: [errorEmbed(err.message)] });
    } else {
      console.error('[phone:button] decline failed:', err);
      await interaction.editReply({ embeds: [errorEmbed('Failed to decline the call.')] });
    }
    return true;
  }

  try {
    const message = interaction.message;
    const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('phone_declined_disabled')
        .setLabel('Declined')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    );
    const declinedEmbed = new EmbedBuilder()
      .setTitle('\u{1F6AB} Call declined')
      .setColor(0xc25b4e)
      .setDescription('You declined this call.');
    await message.edit({ embeds: [declinedEmbed], components: [disabledRow] });
  } catch (err) {
    console.error('[phone:button] decline: failed to update ring DM:', err);
  }

  // Notify caller their call was declined.
  try {
    const { callerPlayer } = await svc.getCallParticipants(callId);
    const callerUser = await interaction.client.users.fetch(callerPlayer.discordId);
    await callerUser.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('\u{1F6AB} Call declined')
          .setColor(0xc25b4e)
          .setDescription('Your call was declined by the recipient.'),
      ],
    });
  } catch (err) {
    console.error('[phone:button] decline: failed to notify caller:', err);
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Call declined')
        .setColor(0xc25b4e)
        .setDescription('The caller has been notified.'),
    ],
  });
  return true;
}

// re-export for routing convenience
export { hangUpAndNotify };
