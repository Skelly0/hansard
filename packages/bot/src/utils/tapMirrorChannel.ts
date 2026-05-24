import { ChannelType, type GuildChannel } from 'discord.js';

/**
 * Return null if the channel is safe for wiretap mirroring, otherwise an error message.
 *
 * Allowed: `GuildText` and `PrivateThread`. Private threads are accepted by type; a public
 * parent channel does not make a private thread visible to @everyone.
 */
export function validateTapMirrorChannel(
  channel: { id: string; type: ChannelType } | GuildChannel,
): string | null {
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.PrivateThread) {
    return 'Wiretap mirror channel must be a text channel or private thread (no public threads or announcement channels).';
  }

  if (channel.type === ChannelType.PrivateThread) {
    return null;
  }

  const guildChannel = channel as GuildChannel;
  if (!('permissionsFor' in guildChannel) || typeof guildChannel.permissionsFor !== 'function') {
    return 'Cannot resolve permissions for the chosen channel.';
  }
  const everyone = guildChannel.guild.roles.everyone;
  const everyonePerms = guildChannel.permissionsFor(everyone);
  if (!everyonePerms) {
    return 'Cannot resolve @everyone permissions for the chosen channel.';
  }
  if (everyonePerms.has('ViewChannel')) {
    return 'Wiretap mirror channel must be private — @everyone must not have View Channel permission. Pick a staff channel or omit `mirror-channel` to use the default tap channel.';
  }
  return null;
}
