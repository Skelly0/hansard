import {
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  SlashCommandBuilder,
  escapeMarkdown,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Guild,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { players } from '@hansard/db';
import { db } from '../../db.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import {
  PhoneService,
  PhoneServiceError,
  type PhoneDirectoryEntry,
} from '@hansard/api/services/phoneService';
import { buildIncomingCallActions } from '../../components/phoneButtons.js';
import { hangUpAndNotify } from '../../utils/phoneRelay.js';
import { resolveStaffRoleIds } from '../../utils/staffRoles.js';
import { clearNoCallCache } from '../../events/messageCreate.js';
import { resolvePhonePlayer } from './playerLookup.js';
import { validateTapMirrorChannel } from '../../utils/tapMirrorChannel.js';
import {
  formatPhoneCallStatus,
  formatPhoneEndedReason,
  isValidPhoneNumber,
  PHONE_NUMBER_INVALID,
  PHONE_RING_TIMEOUT_MS,
} from '@hansard/shared';
import type { Command } from '../../client.js';

const CALL_COLOUR = 0x9b7cb8;
const DIRECTORY_PAGE_SIZE = 20;

async function requirePlayer(interaction: ChatInputCommandInteraction): Promise<{ id: string; characterName: string; isAlive: boolean } | null> {
  const row = await resolvePhonePlayer(interaction.user.id);
  if (!row || !row.characterName) {
    await interaction.editReply({
      embeds: [errorEmbed('You need an active character before you can use the phone system.')],
    });
    return null;
  }
  return { id: row.id, characterName: row.characterName, isAlive: row.isAlive };
}

function svc(): PhoneService {
  return new PhoneService(db);
}

function formatInlineCode(value: string): string {
  return `\`${value.replace(/`/g, "'")}\``;
}

function directoryMatches(entry: PhoneDirectoryEntry, search: string): boolean {
  const needle = search.toLowerCase();
  return entry.characterName.toLowerCase().includes(needle)
    || entry.discordUsername.toLowerCase().includes(needle)
    || entry.numberRaw.toLowerCase().includes(needle)
    || entry.numberNormalized.toLowerCase().includes(needle)
    || (entry.label?.toLowerCase().includes(needle) ?? false);
}

function formatDirectoryLine(entry: PhoneDirectoryEntry): string {
  const name = escapeMarkdown(entry.characterName);
  const label = entry.label ? ` *(${escapeMarkdown(entry.label)})*` : '';
  return `• **${name}** — ${formatInlineCode(entry.numberRaw)}${label}`;
}

// -----------------------------------------------------------------------------
// register / numbers / delete
// -----------------------------------------------------------------------------

async function handleRegister(interaction: ChatInputCommandInteraction): Promise<void> {
  const player = await requirePlayer(interaction);
  if (!player) return;

  const numberInput = interaction.options.getString('number', true);
  const label = interaction.options.getString('label')?.trim() || null;

  if (!isValidPhoneNumber(numberInput)) {
    await interaction.editReply({ embeds: [errorEmbed(PHONE_NUMBER_INVALID)] });
    return;
  }

  try {
    const row = await svc().registerNumber({ playerId: player.id, numberRaw: numberInput, label });
    await interaction.editReply({
      embeds: [
        successEmbed(
          'Number registered',
          [
            `\u{1F4DE} **${row.numberRaw}**${row.label ? ` *(${row.label})*` : ''}`,
            '',
            'Anyone can dial this number to reach you. Make sure your Discord DMs are open.',
            '',
            'Next steps:',
            '• `/phone dial <number>` to start a call',
            '• `/phone directory` to find other registered lines',
            '• `/phone numbers` to list your lines',
            '• `/phone history` to review your recent calls',
            '• `/phone delete` to retire this number',
          ].join('\n'),
        ),
      ],
    });
  } catch (err) {
    if (err instanceof PhoneServiceError) {
      await interaction.editReply({ embeds: [errorEmbed(err.message)] });
      return;
    }
    console.error('[phone:cmd] register failed:', err);
    await interaction.editReply({ embeds: [errorEmbed('Failed to register the number.')] });
  }
}

async function handleNumbers(interaction: ChatInputCommandInteraction): Promise<void> {
  const player = await requirePlayer(interaction);
  if (!player) return;
  const rows = await svc().listMyNumbers(player.id);
  if (!rows.length) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Your phone lines')
          .setColor(CALL_COLOUR)
          .setDescription('No active numbers. Register one with `/phone register number:<digits>`.'),
      ],
    });
    return;
  }
  const lines = rows.map((r) => `• **${r.numberRaw}**${r.label ? ` *(${r.label})*` : ''}`).join('\n');
  await interaction.editReply({
    embeds: [
      new EmbedBuilder().setTitle('Your phone lines').setColor(CALL_COLOUR).setDescription(lines),
    ],
  });
}

async function handleDirectory(interaction: ChatInputCommandInteraction): Promise<void> {
  const rows = await svc().listDirectory();
  const search = interaction.options.getString('search')?.trim() || null;
  const page = Math.max(1, interaction.options.getInteger('page') ?? 1);
  const filtered = search ? rows.filter((row) => directoryMatches(row, search)) : rows;

  if (!filtered.length) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Phone directory')
          .setColor(CALL_COLOUR)
          .setDescription(search ? 'No active phone numbers match that search.' : 'No active phone numbers are registered yet.'),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / DIRECTORY_PAGE_SIZE));
  if (page > totalPages) {
    await interaction.editReply({
      embeds: [errorEmbed(`No page ${page} — only ${totalPages} page${totalPages === 1 ? '' : 's'} of phone numbers.`)],
      allowedMentions: { parse: [] },
    });
    return;
  }

  const start = (page - 1) * DIRECTORY_PAGE_SIZE;
  const lines = filtered.slice(start, start + DIRECTORY_PAGE_SIZE).map(formatDirectoryLine);
  const embed = new EmbedBuilder()
    .setTitle('Phone directory')
    .setColor(CALL_COLOUR)
    .setDescription(lines.join('\n'))
    .setFooter({
      text: totalPages > 1
        ? `Page ${page} of ${totalPages} • ${filtered.length} numbers`
        : `${filtered.length} number${filtered.length === 1 ? '' : 's'}`,
    });

  if (search) {
    embed.addFields({ name: 'Search', value: formatInlineCode(search), inline: true });
  }

  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function handleDelete(interaction: ChatInputCommandInteraction): Promise<void> {
  const player = await requirePlayer(interaction);
  if (!player) return;
  const numberInput = interaction.options.getString('number', true);
  const row = await svc().lookupNumber(numberInput);
  if (!row || row.playerId !== player.id) {
    await interaction.editReply({ embeds: [errorEmbed('You do not own an active line with that number.')] });
    return;
  }
  try {
    await svc().deactivateNumber(row.id, player.id, { userId: player.id, isStaff: false });
    await interaction.editReply({
      embeds: [successEmbed('Number retired', `\u{260E} **${row.numberRaw}** is no longer reachable.`)],
    });
  } catch (err) {
    if (err instanceof PhoneServiceError) {
      await interaction.editReply({ embeds: [errorEmbed(err.message)] });
      return;
    }
    console.error('[phone:cmd] delete failed:', err);
    await interaction.editReply({ embeds: [errorEmbed('Failed to retire the number.')] });
  }
}

// -----------------------------------------------------------------------------
// dial / hangup / history
// -----------------------------------------------------------------------------

async function handleDial(interaction: ChatInputCommandInteraction): Promise<void> {
  const player = await requirePlayer(interaction);
  if (!player) return;

  const targetNumber = interaction.options.getString('number', true);
  const fromNumber = interaction.options.getString('from');

  const recipient = await svc().lookupNumber(targetNumber);
  if (!recipient) {
    await interaction.editReply({ embeds: [errorEmbed('No active line found with that number.')] });
    return;
  }

  // Choose caller's number. If `from` provided, must own it; otherwise pick their first active.
  const myNumbers = await svc().listMyNumbers(player.id);
  if (!myNumbers.length) {
    await interaction.editReply({
      embeds: [errorEmbed('You need to register a phone number before dialing. Try `/phone register`.')],
    });
    return;
  }
  let callerNumber = myNumbers[0];
  if (fromNumber) {
    const resolved = await svc().lookupNumber(fromNumber);
    if (!resolved || resolved.playerId !== player.id) {
      await interaction.editReply({ embeds: [errorEmbed('You do not own that calling number.')] });
      return;
    }
    callerNumber = resolved;
  }

  let participants;
  try {
    participants = await svc().initiateCall({
      callerPlayerId: player.id,
      callerNumberId: callerNumber.id,
      recipientNumberId: recipient.id,
    });
  } catch (err) {
    if (err instanceof PhoneServiceError) {
      await interaction.editReply({ embeds: [errorEmbed(err.message)] });
      return;
    }
    console.error('[phone:cmd] dial failed:', err);
    await interaction.editReply({ embeds: [errorEmbed('Failed to start the call.')] });
    return;
  }

  // A ringing call now exists for both parties. Clear any stale "no open call" negative-cache
  // entries (left over from a pre-call DM) so the messageCreate fast path doesn't drop their
  // first in-call messages with a wrong "you're not in a call" reply.
  clearNoCallCache(interaction.user.id);
  clearNoCallCache(participants.recipientPlayer.discordId);

  // Send the ring DM. Split the try/catch so DB hiccups on the followup `setRingMessageId`
  // don't get misattributed as DM-closed (which would end an otherwise functional call).
  let ringMessageId: string | null = null;
  try {
    const recipientUser = await interaction.client.users.fetch(participants.recipientPlayer.discordId);
    // Real phones don't tell the recipient which of their own numbers was dialed. Show just
    // the calling number.
    const ringEmbed = new EmbedBuilder()
      .setTitle('\u{1F4DE} Incoming call')
      .setColor(CALL_COLOUR)
      .setDescription(
        `**${participants.callerNumber.numberRaw}** is calling you.\n\nMessages on this call are logged and cannot be edited or deleted. Answer to connect, or decline to send the caller a refusal.`,
      )
      .setFooter({ text: `This ring expires in ${Math.round(PHONE_RING_TIMEOUT_MS / 1000)} seconds.` });
    const row = buildIncomingCallActions(participants.call.id);
    const ringMessage = await recipientUser.send({
      embeds: [ringEmbed],
      components: [row],
      allowedMentions: { parse: [] },
    });
    ringMessageId = ringMessage.id;
  } catch (err) {
    console.error('[phone:cmd] dial: recipient DM failed:', err);
    try {
      await svc().systemEndCall(participants.call.id, 'dm_closed');
    } catch (innerErr) {
      console.error('[phone:cmd] dial: failed to clean up after DM failure:', innerErr);
    }
    await interaction.editReply({
      embeds: [errorEmbed('Recipient has DMs closed and could not be reached.')],
    });
    return;
  }

  // Persist the ring message ID so terminal transitions (hangup, decline, expiry, force-end)
  // can edit the DM to disable stale Answer/Decline buttons. A DB hiccup here is non-fatal —
  // the call is still functional; we just lose the auto-disable. Don't mislabel as dm_closed.
  if (ringMessageId) {
    try {
      await svc().setRingMessageId(participants.call.id, ringMessageId);
    } catch (err) {
      console.error('[phone:cmd] dial: failed to persist ring message id (non-fatal):', err);
    }
  }

  // Caller "Ringing..." DM echoes which of their numbers was used — surprising-number issue.
  try {
    const callerUser = await interaction.client.users.fetch(participants.callerPlayer.discordId);
    await callerUser.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('\u{1F4DE} Ringing...')
          .setColor(CALL_COLOUR)
          .setDescription(
            `Calling **${participants.recipientNumber.numberRaw}** from **${participants.callerNumber.numberRaw}**. You'll be notified when they pick up.\n\nUse \`/phone hangup\` to cancel before they answer.`,
          ),
      ],
      allowedMentions: { parse: [] },
    });
  } catch {
    /* caller has DMs closed — still let the slash reply confirm */
  }

  await interaction.editReply({
    embeds: [
      successEmbed(
        'Dialing',
        `Ringing **${participants.recipientNumber.numberRaw}** from **${participants.callerNumber.numberRaw}**${fromNumber ? '' : ' *(default line)*'}. Check your DMs — the call will connect there if it's answered.`,
      ),
    ],
  });
}

async function handleHangup(interaction: ChatInputCommandInteraction): Promise<void> {
  const player = await requirePlayer(interaction);
  if (!player) return;

  const openCall = await svc().findOpenCallForPlayer(player.id);
  if (!openCall) {
    await interaction.editReply({ embeds: [errorEmbed('You are not currently in a call.')] });
    return;
  }

  let ended;
  try {
    ended = await svc().endCall(openCall.id, player.id);
  } catch (err) {
    if (err instanceof PhoneServiceError) {
      await interaction.editReply({ embeds: [errorEmbed(err.message)] });
      return;
    }
    console.error('[phone:cmd] hangup failed:', err);
    await interaction.editReply({ embeds: [errorEmbed('Failed to hang up.')] });
    return;
  }

  // Use the reason the service actually wrote — it derives it from the actor role.
  const notifyReason = (ended.endedReason ?? 'hangup_caller') as Parameters<typeof hangUpAndNotify>[2];
  await hangUpAndNotify(interaction.client, openCall.id, notifyReason);
  await interaction.editReply({ embeds: [successEmbed('Call ended', 'The line is now free.')] });
}

async function handleHistory(interaction: ChatInputCommandInteraction): Promise<void> {
  const player = await requirePlayer(interaction);
  if (!player) return;

  const pageSize = 10;
  const page = Math.max(1, interaction.options.getInteger('page') ?? 1);
  const offset = (page - 1) * pageSize;

  const { calls, total } = await svc().getCallHistory(
    player.id,
    { userId: player.id, isStaff: false },
    { limit: pageSize, offset },
  );
  if (!total) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle('Call history').setColor(CALL_COLOUR).setDescription('No calls yet.')],
    });
    return;
  }
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (page > totalPages) {
    await interaction.editReply({
      embeds: [errorEmbed(`No page ${page} — only ${totalPages} page${totalPages === 1 ? '' : 's'} of history.`)],
    });
    return;
  }
  const lines = calls.map((c) => {
    const isOutbound = c.callerPlayerId === player.id;
    // Discord-relative timestamp auto-localizes per viewer.
    const stamp = `<t:${Math.floor(c.startedAt.getTime() / 1000)}:f>`;
    const other = isOutbound ? c.recipient : c.caller;
    const name = other.characterName ?? other.numberRaw ?? 'Unknown';
    const arrow = isOutbound ? '\u{2192}' : '\u{2190}';
    const status = formatPhoneCallStatus(c.status);
    const ended = c.endedReason ? ` \u{2014} ${formatPhoneEndedReason(c.endedReason)}` : '';
    return `${stamp} ${arrow} **${name}** (${other.numberRaw ?? '?'}) \u{2014} ${status}${ended}`;
  });
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Call history')
        .setColor(CALL_COLOUR)
        .setDescription(lines.join('\n'))
        .setFooter({
          text:
            totalPages > 1
              ? `Page ${page} of ${totalPages} \u{2022} ${total} calls \u{2022} /phone history page:${page + 1 > totalPages ? 1 : page + 1}`
              : `${calls.length} of ${total}`,
        }),
    ],
  });
}

// -----------------------------------------------------------------------------
// Admin subcommand group (staff only at runtime)
// -----------------------------------------------------------------------------

/**
 * Resolve the set of guilds to check for staff-role membership. If `PHONE_GUILD_ID` is set,
 * we restrict to that one guild so staff trust does not leak across guilds in multi-guild
 * deployments (e.g. a staff member in an unrelated guild should not be trusted as staff
 * for this game's phone admin actions). Single-guild deployments keep the legacy behavior.
 */
function guildsForStaffCheck(interaction: ChatInputCommandInteraction): Iterable<Guild> {
  const configured = process.env.PHONE_GUILD_ID?.trim();
  if (configured) {
    const guild = interaction.client.guilds.cache.get(configured);
    return guild ? [guild] : [];
  }
  return interaction.client.guilds.cache.values();
}

async function ensureStaff(interaction: ChatInputCommandInteraction): Promise<boolean> {
  // Phone admin can run in DMs, so `interaction.member` is not a reliable trust source.
  // Require the same strict check used for wiretap mirror-users: a DB staff flag AND a live
  // configured staff role in the configured/all guilds. That prevents stale DB flags from
  // keeping admin powers after someone leaves staff or leaves the guild.
  if (await discordUserIsStaff(interaction, interaction.user.id)) return true;
  await interaction.editReply({ embeds: [errorEmbed('Only staff can use phone admin tools.')] });
  return false;
}

/**
 * Stricter than `ensureStaff`: a wiretap mirror user must hold BOTH the DB `players.isStaff`
 * flag AND a live configured staff role in the (configured-or-all) guild(s). The DB flag alone
 * is not enough — a retired staffer whose flag was never cleared, or who has left the guild,
 * must not silently keep receiving wiretap copies. Requiring live guild role membership ties
 * the mirror trust to current standing rather than a stale row.
 */
async function discordUserIsStaff(interaction: ChatInputCommandInteraction, discordUserId: string): Promise<boolean> {
  const [row] = await db
    .select({ isStaff: players.isStaff })
    .from(players)
    .where(eq(players.discordId, discordUserId))
    .limit(1);
  if (!row?.isStaff) return false;

  // DB flag is set — now confirm a current staff role in the guild. Same `PHONE_GUILD_ID`
  // containment as `ensureStaff` so a tap mirror-user from a different guild does not pass.
  for (const guild of guildsForStaffCheck(interaction)) {
    try {
      const member = await guild.members.fetch(discordUserId).catch(() => null);
      if (!member) continue;
      const staffRoleIds = await resolveStaffRoleIds(guild, 'phone:discordUserIsStaff');
      if (staffRoleIds.length === 0) continue;
      if (member.roles.cache.some((r) => staffRoleIds.includes(r.id))) return true;
    } catch (err) {
      console.error('[phone:cmd] mirror-user staff check failed:', err);
    }
  }
  return false;
}

async function handleAdminTapCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureStaff(interaction))) return;
  const numberInput = interaction.options.getString('number', true);
  const reason = interaction.options.getString('reason') || null;
  const mirrorUser = interaction.options.getUser('mirror-user');
  const mirrorChannel = interaction.options.getChannel('mirror-channel');

  // Channel-type validation: a wiretap fed into a public channel would broadcast wiretap
  // traffic to the whole guild. Refuse any channel where `@everyone` retains ViewChannel.
  if (mirrorChannel) {
    const channelError = validateTapMirrorChannel(mirrorChannel);
    if (channelError) {
      await interaction.editReply({ embeds: [errorEmbed(channelError)] });
      return;
    }
  }
  if (mirrorUser && !(await discordUserIsStaff(interaction, mirrorUser.id))) {
    await interaction.editReply({
      embeds: [errorEmbed('Wiretap mirror user must be a staff member. Use a staff channel, yourself, or omit `mirror-user`.')],
    });
    return;
  }

  const number = await svc().lookupNumber(numberInput);
  if (!number) {
    await interaction.editReply({ embeds: [errorEmbed('No active number matches that input.')] });
    return;
  }

  const staffPlayer = await resolvePhonePlayer(interaction.user.id);
  if (!staffPlayer) {
    await interaction.editReply({ embeds: [errorEmbed('Staff player record not found.')] });
    return;
  }

  try {
    const tap = await svc().setTap(
      {
        targetNumberId: number.id,
        createdById: staffPlayer.id,
        reason,
        mirrorChannelId: mirrorChannel?.id ?? null,
        mirrorDiscordUserId: mirrorUser?.id ?? null,
      },
      { userId: staffPlayer.id, isStaff: true },
    );
    await interaction.editReply({
      embeds: [
        successEmbed(
          'Wiretap active',
          [
            `Tap ID: \`${tap.id}\``,
            `Target: **${number.numberRaw}**`,
            mirrorChannel ? `Mirror channel: <#${mirrorChannel.id}>` : 'Mirror channel: default `PHONE_TAP_CHANNEL_ID`',
            mirrorUser ? `Mirror user: <@${mirrorUser.id}>` : null,
            reason ? `Reason: ${reason}` : null,
          ].filter(Boolean).join('\n'),
        ),
      ],
    });
  } catch (err) {
    if (err instanceof PhoneServiceError) {
      await interaction.editReply({ embeds: [errorEmbed(err.message)] });
      return;
    }
    console.error('[phone:cmd] admin tap-create failed:', err);
    await interaction.editReply({ embeds: [errorEmbed('Failed to set wiretap.')] });
  }
}

async function handleAdminTapRevoke(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureStaff(interaction))) return;
  const tapId = interaction.options.getString('tap-id', true);
  const notes = interaction.options.getString('notes') || undefined;
  const staffPlayer = await resolvePhonePlayer(interaction.user.id);
  if (!staffPlayer) {
    await interaction.editReply({ embeds: [errorEmbed('Staff player record not found.')] });
    return;
  }
  try {
    await svc().revokeTap(tapId, staffPlayer.id, { userId: staffPlayer.id, isStaff: true }, notes);
    await interaction.editReply({ embeds: [successEmbed('Wiretap revoked', `Tap \`${tapId}\` is now inactive.`)] });
  } catch (err) {
    if (err instanceof PhoneServiceError) {
      await interaction.editReply({ embeds: [errorEmbed(err.message)] });
      return;
    }
    console.error('[phone:cmd] admin tap-revoke failed:', err);
    await interaction.editReply({ embeds: [errorEmbed('Failed to revoke wiretap.')] });
  }
}

async function handleAdminTapList(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureStaff(interaction))) return;
  const staffPlayer = await resolvePhonePlayer(interaction.user.id);
  if (!staffPlayer) {
    await interaction.editReply({ embeds: [errorEmbed('Staff player record not found.')] });
    return;
  }
  const taps = await svc().listTaps({ userId: staffPlayer.id, isStaff: true });
  if (!taps.length) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle('Active wiretaps').setColor(CALL_COLOUR).setDescription('None.')],
    });
    return;
  }
  const lines = taps.slice(0, 20).map((t) => {
    const targets = [t.mirrorChannelId ? `<#${t.mirrorChannelId}>` : null, t.mirrorDiscordUserId ? `<@${t.mirrorDiscordUserId}>` : null]
      .filter(Boolean)
      .join(', ') || 'default channel';
    return `• \`${t.id}\` \u{2192} ${targets}${t.reason ? ` — ${t.reason.slice(0, 80)}` : ''}`;
  });
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Active wiretaps')
        .setColor(CALL_COLOUR)
        .setDescription(lines.join('\n'))
        .setFooter({ text: `${taps.length} active` }),
    ],
  });
}

async function handleAdminLookup(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureStaff(interaction))) return;
  const numberInput = interaction.options.getString('number', true);
  const row = await svc().lookupNumber(numberInput);
  if (!row) {
    await interaction.editReply({ embeds: [errorEmbed('No active line with that number.')] });
    return;
  }
  const [owner] = await db
    .select({ id: players.id, characterName: players.characterName, discordId: players.discordId })
    .from(players)
    .where(eq(players.id, row.playerId))
    .limit(1);
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`Number ${row.numberRaw}`)
        .setColor(CALL_COLOUR)
        .addFields(
          { name: 'Owner', value: owner ? `${owner.characterName ?? '(no character)'} (<@${owner.discordId}>)` : 'Unknown', inline: false },
          { name: 'Label', value: row.label ?? '—', inline: true },
          { name: 'Registered', value: row.createdAt.toISOString().slice(0, 10), inline: true },
        ),
    ],
  });
}

async function handleAdminForceEnd(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureStaff(interaction))) return;
  const callId = interaction.options.getString('call-id', true);
  const reason = interaction.options.getString('reason') || undefined;
  // Resolve the staff member's player row so the audit column receives a player UUID
  // (matching `players.id`), not a raw Discord snowflake. Without this lookup the
  // `force_ended_by_id` FK would be wrong and follow-up "who ended this?" queries broken.
  const staffPlayer = await resolvePhonePlayer(interaction.user.id);
  if (!staffPlayer) {
    await interaction.editReply({ embeds: [errorEmbed('Staff player record not found.')] });
    return;
  }
  try {
    await svc().forceEndCall(callId, staffPlayer.id, { userId: staffPlayer.id, isStaff: true }, reason);
    await hangUpAndNotify(interaction.client, callId, 'force_ended_by_staff');
    await interaction.editReply({ embeds: [successEmbed('Call ended', `Call \`${callId}\` was force-ended.`)] });
  } catch (err) {
    if (err instanceof PhoneServiceError) {
      await interaction.editReply({ embeds: [errorEmbed(err.message)] });
      return;
    }
    console.error('[phone:cmd] admin force-end failed:', err);
    await interaction.editReply({ embeds: [errorEmbed('Failed to force-end call.')] });
  }
}

// -----------------------------------------------------------------------------
// Command definition
// -----------------------------------------------------------------------------

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('phone')
    .setDescription('Phone registry: register numbers, dial others, manage wiretaps (staff only)')
    // Available in both guild channels and DMs so /phone hangup works from the call DM.
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
    .addSubcommand((sub) =>
      sub
        .setName('register')
        .setDescription('Register a new phone number to your character')
        .addStringOption((opt) =>
          opt.setName('number').setDescription('3-20 digits, optional leading +').setRequired(true).setMaxLength(32),
        )
        .addStringOption((opt) =>
          opt.setName('label').setDescription('Optional vanity name like "Burner"').setRequired(false).setMaxLength(64),
        ),
    )
    .addSubcommand((sub) => sub.setName('numbers').setDescription('List your active phone numbers'))
    .addSubcommand((sub) =>
      sub
        .setName('directory')
        .setDescription('List active phone numbers you can dial')
        .addStringOption((opt) =>
          opt
            .setName('search')
            .setDescription('Filter by character, number, username, or label')
            .setRequired(false)
            .setMaxLength(128),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('page')
            .setDescription('Page number (20 numbers per page; defaults to 1)')
            .setMinValue(1)
            .setMaxValue(999)
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Retire one of your phone numbers')
        .addStringOption((opt) =>
          opt
            .setName('number')
            .setDescription('The number to retire')
            .setRequired(true)
            .setMaxLength(32)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('dial')
        .setDescription('Call another player by their number')
        .addStringOption((opt) =>
          opt.setName('number').setDescription('Number to call').setRequired(true).setMaxLength(32),
        )
        .addStringOption((opt) =>
          opt
            .setName('from')
            .setDescription('Which of your numbers to call from (defaults to most recent)')
            .setRequired(false)
            .setMaxLength(32)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('hangup').setDescription('End your current call'))
    .addSubcommand((sub) =>
      sub
        .setName('history')
        .setDescription('Show your recent calls')
        .addIntegerOption((opt) =>
          opt
            .setName('page')
            .setDescription('Page number (10 calls per page; defaults to 1)')
            .setMinValue(1)
            .setMaxValue(999)
            .setRequired(false),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('admin')
        .setDescription('Staff-only phone administration')
        .addSubcommand((sub) =>
          sub
            .setName('tap-create')
            .setDescription('Set a wiretap on a phone number')
            .addStringOption((opt) =>
              opt.setName('number').setDescription('Number to tap').setRequired(true).setMaxLength(32),
            )
            .addStringOption((opt) =>
              opt.setName('reason').setDescription('Reason for the tap (audit)').setRequired(false).setMaxLength(512),
            )
            .addUserOption((opt) =>
              opt.setName('mirror-user').setDescription('Optional Discord user to DM tap copies to').setRequired(false),
            )
            .addChannelOption((opt) =>
              opt
                .setName('mirror-channel')
                .setDescription('Override the default tap mirror channel (private channels / private threads only)')
                .setRequired(false)
                // Defense-in-depth: constrain at the slash UI so voice/stage/forum/category
                // never reach the runtime validator. Runtime check (validateTapMirrorChannel)
                // is the security boundary; this is a UX improvement.
                .addChannelTypes(ChannelType.GuildText, ChannelType.PrivateThread),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('tap-revoke')
            .setDescription('Revoke an active wiretap')
            .addStringOption((opt) =>
              opt.setName('tap-id').setDescription('Tap UUID from /phone admin tap-list').setRequired(true),
            )
            .addStringOption((opt) =>
              opt.setName('notes').setDescription('Audit notes for the revocation').setRequired(false).setMaxLength(512),
            ),
        )
        .addSubcommand((sub) => sub.setName('tap-list').setDescription('List active wiretaps'))
        .addSubcommand((sub) =>
          sub
            .setName('lookup')
            .setDescription('Find the owner of a phone number')
            .addStringOption((opt) =>
              opt.setName('number').setDescription('Number to look up').setRequired(true).setMaxLength(32),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('force-end')
            .setDescription('End an in-progress call (moderation)')
            .addStringOption((opt) =>
              opt.setName('call-id').setDescription('Call UUID').setRequired(true),
            )
            .addStringOption((opt) =>
              opt.setName('reason').setDescription('Reason (audit)').setRequired(false).setMaxLength(64),
            ),
        ),
    )
    // Discord-level admin gate is *additionally* applied via runtime isStaff checks
    // — keep the parent command visible so non-staff can still use /phone register etc.
    // Do NOT set default_member_permissions on the parent, or non-staff lose user commands.
    .setDefaultMemberPermissions(null) as SlashCommandBuilder,

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'number' && focused.name !== 'from') {
      await interaction.respond([]);
      return;
    }
    const sub = interaction.options.getSubcommand();
    // Autocomplete only fires for the caller's own numbers on `delete` / `dial from`.
    if (sub !== 'delete' && !(sub === 'dial' && focused.name === 'from')) {
      await interaction.respond([]);
      return;
    }
    const [row] = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);
    if (!row) {
      await interaction.respond([]);
      return;
    }
    const numbers = await svc().listMyNumbers(row.id);
    const q = String(focused.value ?? '').toLowerCase();
    const filtered = numbers
      .filter((n) =>
        !q
        || n.numberRaw.toLowerCase().includes(q)
        || n.numberNormalized.toLowerCase().includes(q)
        || (n.label?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 25)
      .map((n) => ({
        name: n.label ? `${n.numberRaw} — ${n.label}` : n.numberRaw,
        value: n.numberRaw,
      }));
    await interaction.respond(filtered);
  },

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    await interaction.deferReply({ ephemeral: true });

    try {
      if (group === 'admin') {
        switch (sub) {
          case 'tap-create':
            await handleAdminTapCreate(interaction);
            break;
          case 'tap-revoke':
            await handleAdminTapRevoke(interaction);
            break;
          case 'tap-list':
            await handleAdminTapList(interaction);
            break;
          case 'lookup':
            await handleAdminLookup(interaction);
            break;
          case 'force-end':
            await handleAdminForceEnd(interaction);
            break;
          default:
            await interaction.editReply({ embeds: [errorEmbed(`Unknown admin subcommand: ${sub}`)] });
        }
        return;
      }

      switch (sub) {
        case 'register':
          await handleRegister(interaction);
          break;
        case 'numbers':
          await handleNumbers(interaction);
          break;
        case 'directory':
          await handleDirectory(interaction);
          break;
        case 'delete':
          await handleDelete(interaction);
          break;
        case 'dial':
          await handleDial(interaction);
          break;
        case 'hangup':
          await handleHangup(interaction);
          break;
        case 'history':
          await handleHistory(interaction);
          break;
        default:
          await interaction.editReply({ embeds: [errorEmbed(`Unknown subcommand: ${sub}`)] });
      }
    } catch (err) {
      console.error(`[phone:cmd] ${group ?? ''} ${sub} uncaught:`, err);
      await interaction.editReply({ embeds: [errorEmbed('Something went wrong handling that command.')] });
    }
  },
};

export default command;
export { validateTapMirrorChannel };
export const __testables = { ensureStaff, discordUserIsStaff };
