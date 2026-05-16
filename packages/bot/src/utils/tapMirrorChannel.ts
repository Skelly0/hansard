import { ChannelType, type GuildChannel } from 'discord.js';

/**
 * Return null if the channel is safe for wiretap mirroring, otherwise an error message.
 *
 * Allowed: `GuildText` and `PrivateThread`. Private threads are checked through their parent
 * channel because thread visibility inherits from the parent.
 */
export function validateTapMirrorChannel(
  channel: { id: string; type: ChannelType } | GuildChannel,
): string | null {
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.PrivateThread) {
    return 'Wiretap mirror channel must be a text channel or private thread (no public threads or announcement channels).';
  }

  const guildChannel = channel as GuildChannel & { parent?: GuildChannel | null };
  let channelToCheck: GuildChannel = guildChannel;
  if (channel.type === ChannelType.PrivateThread) {
    const parent = guildChannel.parent;
    if (!parent) {
      return 'Private thread has no resolvable parent channel — refusing to use as wiretap mirror.';
    }
    channelToCheck = parent;
  }

  if (!('permissionsFor' in channelToCheck) || typeof channelToCheck.permissionsFor !== 'function') {
    return 'Cannot resolve permissions for the chosen channel.';
  }
  const everyone = channelToCheck.guild.roles.everyone;
  const everyonePerms = channelToCheck.permissionsFor(everyone);
  if (!everyonePerms) {
    return 'Cannot resolve @everyone permissions for the chosen channel.';
  }
  if (everyonePerms.has('ViewChannel')) {
    return 'Wiretap mirror channel must be private — @everyone must not have View Channel permission. Pick a staff channel or omit `mirror-channel` to use the default tap channel.';
  }
  return null;
}
