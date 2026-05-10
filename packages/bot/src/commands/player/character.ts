import {
  SlashCommandBuilder,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type MessageComponentInteraction,
  type Message,
} from 'discord.js';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db.js';
import {
  players,
  factions,
  parties,
  offices,
  officeHolders,
  favourBalances,
  favourCategories,
  playerEventLog,
  simulationClock,
} from '@hansard/db';
import { birthDateForAge } from '@hansard/shared';
import { calculateStartingAgeFavourBonus } from '@hansard/api/services/playerService';
import {
  grantStartingFactionFavours,
  type StartingFactionFavourGrant,
} from '@hansard/api/services/favourService';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

// ─── Age Config (will load from simulation config later) ───────────────────

const MIN_STARTING_AGE = 18;
const MAX_STARTING_AGE = 70;
const DEFAULT_STARTING_AGE = 30;
const CHARACTER_ALREADY_EXISTS_ERROR = 'CHARACTER_ALREADY_EXISTS';

// ─── Health display ────────────────────────────────────────────────────────

const HEALTH_DISPLAY: Record<string, string> = {
  healthy: '\u{1F7E2} Healthy',
  minor: '\u{1F7E1} Minor Ailment',
  major: '\u{1F7E0} Major Ailment',
  critical: '\u{1F534} Critical',
  deceased: '\u{26B0}\u{FE0F} Deceased',
};

// ─── /character create ─────────────────────────────────────────────────────

async function handleCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  // Check if player already has a character
  const existing = await db
    .select({ id: players.id, characterName: players.characterName })
    .from(players)
    .where(eq(players.discordId, interaction.user.id))
    .limit(1);

  if (existing.length > 0 && existing[0].characterName) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          `You already have a character: **${existing[0].characterName}**.\nUse \`/character edit\` to update your bio or portrait.`,
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  // Step 1: Name / Bio / Age modal
  const modal = new ModalBuilder()
    .setCustomId(`char_create_${interaction.user.id}`)
    .setTitle('Create Your Character');

  const nameInput = new TextInputBuilder()
    .setCustomId('character_name')
    .setLabel('Character Name')
    .setPlaceholder('e.g. Lord Edmund Blackwood')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(128);

  const bioInput = new TextInputBuilder()
    .setCustomId('character_bio')
    .setLabel('Biography (optional)')
    .setPlaceholder('Backstory, personality, goals...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(2000);

  const ageInput = new TextInputBuilder()
    .setCustomId('character_age')
    .setLabel(`Starting Age (${MIN_STARTING_AGE}\u2013${MAX_STARTING_AGE})`)
    .setPlaceholder(String(DEFAULT_STARTING_AGE))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(3);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(bioInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(ageInput),
  );

  await interaction.showModal(modal);

  // Await modal submit
  let modalSubmit: ModalSubmitInteraction;
  try {
    modalSubmit = await interaction.awaitModalSubmit({
      filter: (i) => i.customId === `char_create_${interaction.user.id}`,
      time: 300_000,
    });
  } catch {
    return; // timed out
  }

  await modalSubmit.deferReply({ ephemeral: true });

  const characterName = modalSubmit.fields.getTextInputValue('character_name').trim();
  const characterBio = modalSubmit.fields.getTextInputValue('character_bio').trim() || null;
  const ageRaw = modalSubmit.fields.getTextInputValue('character_age').trim();
  const startingAge = parseInt(ageRaw, 10);

  // Validate age
  if (isNaN(startingAge) || startingAge < MIN_STARTING_AGE || startingAge > MAX_STARTING_AGE) {
    await modalSubmit.editReply({
      embeds: [
        errorEmbed(
          `Starting age must be a number between ${MIN_STARTING_AGE} and ${MAX_STARTING_AGE}. You entered: \`${ageRaw}\``,
        ),
      ],
    });
    return;
  }

  // Validate name uniqueness
  const nameTaken = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.characterName, characterName))
    .limit(1);

  if (nameTaken.length > 0) {
    await modalSubmit.editReply({
      embeds: [
        errorEmbed(
          `The character name **${characterName}** is already taken. Please try again with a different name.`,
        ),
      ],
    });
    return;
  }

  // Step 2: Portrait prompt
  const skipButton = new ButtonBuilder()
    .setCustomId(`portrait_skip_${interaction.user.id}`)
    .setLabel('Skip Portrait')
    .setStyle(ButtonStyle.Secondary);

  const portraitMsg = await modalSubmit.editReply({
    embeds: [
      createEmbed({
        title: 'Character Portrait',
        description:
          'Reply in this channel with an image attachment or an image URL for your portrait, or click **Skip** to continue without one.',
        system: 'players',
      }),
    ],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(skipButton)],
  });

  // Wait for portrait or skip
  const portraitUrl = await new Promise<string | null>((resolve) => {
    let resolved = false;

    const buttonCollector = portraitMsg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id,
      time: 120_000,
      max: 1,
    });

    // Only create message collector in guild text channels (not DMs or partial channels)
    const channel = interaction.channel;
    const canCollectMessages = channel && 'createMessageCollector' in channel;

    const messageCollector = canCollectMessages
      ? channel.createMessageCollector({
          filter: (m: Message) => m.author.id === interaction.user.id,
          time: 120_000,
          max: 1,
        })
      : null;

    buttonCollector.on('collect', async (btn) => {
      if (!resolved) {
        resolved = true;
        messageCollector?.stop();
        await btn.deferUpdate();
        resolve(null);
      }
    });

    messageCollector?.on('collect', async (msg: Message) => {
      if (!resolved) {
        resolved = true;
        buttonCollector.stop();

        const attachment = msg.attachments.first();
        if (attachment?.contentType?.startsWith('image/')) {
          resolve(attachment.url);
        } else if (msg.content.match(/^https?:\/\/.+\.(png|jpg|jpeg|gif|webp)/i)) {
          resolve(msg.content.trim());
        } else {
          resolve(null);
        }

        try { await msg.delete(); } catch { /* may lack perms */ }
      }
    });

    buttonCollector.on('end', () => {
      if (!resolved) {
        resolved = true;
        messageCollector?.stop();
        resolve(null);
      }
    });
  });

  // Step 3: Faction select
  const allFactions = await db
    .select({ id: factions.id, name: factions.name, shortName: factions.shortName })
    .from(factions)
    .where(eq(factions.isActive, true));

  if (allFactions.length === 0) {
    await modalSubmit.editReply({
      embeds: [
        errorEmbed('No factions are available yet. Please ask staff to create factions first.'),
      ],
      components: [],
    });
    return;
  }

  const factionSelect = new StringSelectMenuBuilder()
    .setCustomId(`faction_sel_${interaction.user.id}`)
    .setPlaceholder('Choose your faction')
    .addOptions(
      allFactions.map((f) => ({
        label: f.name,
        description: f.shortName ?? undefined,
        value: f.id,
      })),
    );

  await modalSubmit.editReply({
    embeds: [
      createEmbed({
        title: 'Choose Your Faction',
        description: 'Select a faction to align with.',
        system: 'players',
      }),
    ],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(factionSelect)],
  });

  let selectedFactionId: string;
  let selectedFactionName: string;

  try {
    const factionInt = (await portraitMsg.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      filter: (i) => i.user.id === interaction.user.id,
      time: 120_000,
    })) as StringSelectMenuInteraction;

    selectedFactionId = factionInt.values[0];
    selectedFactionName = allFactions.find((f) => f.id === selectedFactionId)?.name ?? 'Unknown';
    await factionInt.deferUpdate();
  } catch {
    await modalSubmit.editReply({
      embeds: [errorEmbed('Faction selection timed out. Run `/character create` again.')],
      components: [],
    });
    return;
  }

  // Step 4: Party select (optional)
  const factionParties = await db
    .select({ id: parties.id, name: parties.name, shortName: parties.shortName })
    .from(parties)
    .where(eq(parties.factionId, selectedFactionId));

  const allActiveParties = await db
    .select({ id: parties.id, name: parties.name, shortName: parties.shortName })
    .from(parties)
    .where(eq(parties.isActive, true));

  const partyOptions = factionParties.length > 0 ? factionParties : allActiveParties;

  let selectedPartyId: string | null = null;
  let selectedPartyName: string | null = null;

  if (partyOptions.length > 0) {
    const partySelect = new StringSelectMenuBuilder()
      .setCustomId(`party_sel_${interaction.user.id}`)
      .setPlaceholder('Choose a party (optional)')
      .addOptions([
        { label: 'Independent (No Party)', value: 'none', description: 'Remain unaffiliated' },
        ...partyOptions.map((p) => ({
          label: p.name,
          description: p.shortName ?? undefined,
          value: p.id,
        })),
      ]);

    await modalSubmit.editReply({
      embeds: [
        createEmbed({
          title: 'Choose Your Party',
          description: 'Optionally join a political party, or remain independent.',
          system: 'players',
        }),
      ],
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(partySelect)],
    });

    try {
      const partyInt = (await portraitMsg.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        filter: (i) => i.user.id === interaction.user.id,
        time: 120_000,
      })) as StringSelectMenuInteraction;

      if (partyInt.values[0] !== 'none') {
        selectedPartyId = partyInt.values[0];
        selectedPartyName = partyOptions.find((p) => p.id === selectedPartyId)?.name ?? 'Unknown';
      }
      await partyInt.deferUpdate();
    } catch {
      // timed out — continue without party
    }
  }

  // Step 5: Confirmation
  const favourBonus = calculateStartingAgeFavourBonus(startingAge);

  const confirmEmbed = createEmbed({
    title: 'Character Summary',
    description: '> Review your character and confirm to create.',
    system: 'players',
    thumbnail: portraitUrl ?? undefined,
    fields: [
      { name: 'Name', value: characterName, inline: true },
      { name: 'Age', value: String(startingAge), inline: true },
      { name: 'Faction', value: selectedFactionName, inline: true },
      { name: 'Party', value: selectedPartyName ?? 'Independent', inline: true },
      {
        name: 'Biography',
        value: characterBio
          ? characterBio.length > 300 ? characterBio.slice(0, 297) + '...' : characterBio
          : '*No biography provided.*',
      },
      {
        name: 'Portrait',
        value: portraitUrl ? `[View Image](${portraitUrl})` : '*None*',
        inline: true,
      },
      ...(favourBonus > 0
        ? [{
            name: 'Starting Favour Bonus',
            value: `**${favourBonus}** bonus favours for starting at age ${startingAge}.\n*Applied automatically to the matching favour category for your faction.*`,
          }]
        : []),
    ],
  });

  const confirmBtn = new ButtonBuilder()
    .setCustomId(`char_confirm_${interaction.user.id}`)
    .setLabel('Confirm & Create')
    .setStyle(ButtonStyle.Success);

  const cancelBtn = new ButtonBuilder()
    .setCustomId(`char_cancel_${interaction.user.id}`)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Danger);

  await modalSubmit.editReply({
    embeds: [confirmEmbed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn)],
  });

  let confirmInt: MessageComponentInteraction;
  try {
    confirmInt = await portraitMsg.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id,
      time: 120_000,
    });
  } catch {
    await modalSubmit.editReply({
      embeds: [errorEmbed('Character creation timed out.')],
      components: [],
    });
    return;
  }

  if (confirmInt.customId === `char_cancel_${interaction.user.id}`) {
    await confirmInt.update({
      embeds: [errorEmbed('Character creation cancelled.')],
      components: [],
    });
    return;
  }

  await confirmInt.deferUpdate();

  // ─── Persist to database ───────────────────────────────────────────────

  try {
    // Re-check uniqueness immediately before insert (early check minutes ago is stale).
    const stillUnique = await db
      .select({ id: players.id, discordId: players.discordId })
      .from(players)
      .where(eq(players.characterName, characterName))
      .limit(1);

    if (stillUnique.length > 0 && stillUnique[0].discordId !== interaction.user.id) {
      await modalSubmit.editReply({
        embeds: [errorEmbed(
          `The character name **${characterName}** was just taken by another player. Run \`/character create\` again with a different name.`,
        )],
        components: [],
      });
      return;
    }

    const existingPlayer = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);

    const [clock] = await db.select().from(simulationClock).limit(1);
    const simNow = clock?.currentDate ?? `${new Date().getUTCFullYear()}-01-01`;
    const birthDate = birthDateForAge(simNow, startingAge);

    const creationResult = await db.transaction(async (tx) => {
      let playerId = '';
      let startingFavourGrant: StartingFactionFavourGrant | null = null;

      if (existingPlayer.length > 0) {
        playerId = existingPlayer[0].id;
        const [updatedPlayer] = await tx
          .update(players)
          .set({
            discordUsername: interaction.user.username,
            characterName,
            characterBio,
            characterPortraitUrl: portraitUrl,
            startingAge,
            currentAge: startingAge,
            birthDate,
            factionId: selectedFactionId,
            partyId: selectedPartyId,
            startingFavoursGranted: false,
            isActive: true,
            lastActiveAt: new Date(),
          })
          .where(and(eq(players.id, playerId), isNull(players.characterName)))
          .returning({ id: players.id });

        if (!updatedPlayer) {
          throw new Error(CHARACTER_ALREADY_EXISTS_ERROR);
        }
      } else {
        const [newPlayer] = await tx
          .insert(players)
          .values({
            discordId: interaction.user.id,
            discordUsername: interaction.user.username,
            characterName,
            characterBio,
            characterPortraitUrl: portraitUrl,
            startingAge,
            currentAge: startingAge,
            birthDate,
            factionId: selectedFactionId,
            partyId: selectedPartyId,
            startingFavoursGranted: false,
          })
          .returning({ id: players.id });
        playerId = newPlayer.id;
      }

      // Log registration event
      await tx.insert(playerEventLog).values({
        playerId,
        eventType: 'registration',
        description: `${characterName} registered (age ${startingAge}, faction: ${selectedFactionName}${selectedPartyName ? `, party: ${selectedPartyName}` : ''}).`,
        newValue: { characterName, startingAge, factionName: selectedFactionName, partyName: selectedPartyName },
      });

      if (favourBonus > 0) {
        startingFavourGrant = await grantStartingFactionFavours(tx, playerId, selectedFactionId, favourBonus);
        if (startingFavourGrant) {
          await tx
            .update(players)
            .set({ startingFavoursGranted: true })
            .where(eq(players.id, playerId));
        }
      }

      return { playerId, startingFavourGrant };
    });
    const { playerId, startingFavourGrant } = creationResult;

    try {
      // Assign Discord roles
      const member = interaction.guild?.members.cache.get(interaction.user.id)
        ?? await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);

      if (member) {
        // Faction role
        const factionFull = await db
          .select({ discordRoleId: factions.discordRoleId })
          .from(factions)
          .where(eq(factions.id, selectedFactionId))
          .limit(1);

        if (factionFull[0]?.discordRoleId) {
          try { await member.roles.add(factionFull[0].discordRoleId); }
          catch (err) { console.warn(`Failed to assign faction role: ${err}`); }
        }

        // Party role
        if (selectedPartyId) {
          const partyFull = await db
            .select({ discordRoleId: parties.discordRoleId })
            .from(parties)
            .where(eq(parties.id, selectedPartyId))
            .limit(1);

          if (partyFull[0]?.discordRoleId) {
            try { await member.roles.add(partyFull[0].discordRoleId); }
            catch (err) { console.warn(`Failed to assign party role: ${err}`); }
          }
        }
      }
    } catch (err) {
      console.warn('Character created, but failed to sync Discord roles:', err);
    }

    // Success embed
    const result = successEmbed(
      'Character Created!',
      [
        `**${characterName}** has entered the political arena.`,
        '',
        `**Age:** ${startingAge}`,
        `**Faction:** ${selectedFactionName}`,
        `**Party:** ${selectedPartyName ?? 'Independent'}`,
        ...(favourBonus > 0
          ? [
              startingFavourGrant
                ? `\n*${favourBonus} starting favour bonus applied to ${startingFavourGrant.categoryName}.*`
                : `\n*${favourBonus} starting favour bonus recorded, but no active favour category matched ${selectedFactionName}.*`,
            ]
          : []),
      ].join('\n'),
    );

    if (portraitUrl) result.setThumbnail(portraitUrl);

    try {
      await modalSubmit.editReply({ embeds: [result], components: [] });
    } catch (err) {
      console.error('Character created, but failed to send success response:', err);
    }
  } catch (error) {
    console.error('Failed to create character:', error);
    const code = (error as { code?: string } | null)?.code;
    const message = error instanceof Error ? error.message : '';
    const detail = (error as { detail?: string } | null)?.detail ?? '';
    const constraint = (error as { constraint?: string } | null)?.constraint ?? '';
    const duplicateContext = `${message} ${detail} ${constraint}`;

    if (message === CHARACTER_ALREADY_EXISTS_ERROR || (code === '23505' && /discord/i.test(duplicateContext))) {
      await modalSubmit.editReply({
        embeds: [errorEmbed(
          'This Discord account already has a character. Use `/character edit` to update it.',
        )],
        components: [],
      });
      return;
    }

    if (code === '23505' || /unique|duplicate/i.test(duplicateContext)) {
      await modalSubmit.editReply({
        embeds: [errorEmbed(
          `The character name **${characterName}** is already taken. Run \`/character create\` again with a different name.`,
        )],
        components: [],
      });
      return;
    }
    await modalSubmit.editReply({
      embeds: [errorEmbed('Failed to create character due to a database error. Please try again or contact staff.')],
      components: [],
    });
  }
}

// ─── /character view ───────────────────────────────────────────────────────

async function handleView(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser('user') ?? interaction.user;
  const actorIsStaff = !!interaction.member && (await isStaff(interaction.member as any));
  const canViewPrivate = actorIsStaff || targetUser.id === interaction.user.id;

  const playerRows = await db
    .select()
    .from(players)
    .where(eq(players.discordId, targetUser.id))
    .limit(1);

  if (playerRows.length === 0 || !playerRows[0].characterName) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          targetUser.id === interaction.user.id
            ? 'You haven\'t created a character yet. Use `/character create` to get started.'
            : `**${targetUser.displayName}** hasn't created a character yet.`,
        ),
      ],
    });
    return;
  }

  const player = playerRows[0];

  // Fetch faction
  let factionName = 'None';
  if (player.factionId) {
    const rows = await db.select({ name: factions.name }).from(factions).where(eq(factions.id, player.factionId)).limit(1);
    if (rows.length > 0) factionName = rows[0].name;
  }

  // Fetch party
  let partyName = 'Independent';
  if (player.partyId) {
    const rows = await db.select({ name: parties.name }).from(parties).where(eq(parties.id, player.partyId)).limit(1);
    if (rows.length > 0) partyName = rows[0].name;
  }

  // Active offices
  const activeOffices = await db
    .select({ officeName: offices.name, officeTier: offices.tier })
    .from(officeHolders)
    .innerJoin(offices, eq(officeHolders.officeId, offices.id))
    .where(eq(officeHolders.playerId, player.id));
  // TODO: filter where endDate IS NULL once Drizzle isNull is wired

  // Favour balances and health details are private to the player and staff.
  const balances = canViewPrivate
    ? await db
        .select({
          categoryName: favourCategories.name,
          categoryEmoji: favourCategories.emoji,
          balance: favourBalances.balance,
        })
        .from(favourBalances)
        .innerJoin(favourCategories, eq(favourBalances.categoryId, favourCategories.id))
        .where(eq(favourBalances.playerId, player.id))
    : [];

  const healthDisplay = canViewPrivate
    ? HEALTH_DISPLAY[player.healthStatus] ?? player.healthStatus
    : 'Private';

  const ailments = (player.ailments as { condition: string; severity: string }[] | null) ?? [];
  const ailmentText = canViewPrivate
    ? ailments.length > 0
      ? ailments.map((a) => `${a.condition} (${a.severity})`).join(', ')
      : 'None'
    : 'Private';

  const officeText = activeOffices.length > 0
    ? activeOffices.map((o) => `**${o.officeName}** (${o.officeTier})`).join('\n')
    : '*No offices held*';

  const favourText = balances.length > 0
    ? balances.map((b) => `${b.categoryEmoji ?? ''} ${b.categoryName}: **${b.balance}**`).join('\n')
    : '*No favours recorded*';

  const bio = player.characterBio
    ? player.characterBio.length > 400 ? player.characterBio.slice(0, 397) + '...' : player.characterBio
    : '*No biography provided.*';

  const fields = [
    { name: 'Player', value: `<@${targetUser.id}>`, inline: true },
    { name: 'Age', value: String(player.currentAge ?? player.startingAge ?? '?'), inline: true },
    { name: 'Health', value: healthDisplay, inline: true },
    { name: 'Faction', value: factionName, inline: true },
    { name: 'Party', value: partyName, inline: true },
    { name: 'Status', value: player.isAlive ? '\u{1F7E2} Alive' : '\u{26B0}\u{FE0F} Deceased', inline: true },
    { name: 'Offices', value: officeText },
  ];

  if (canViewPrivate) {
    fields.push(
      { name: 'Ailments', value: ailmentText, inline: true },
      { name: 'Favours', value: favourText },
    );
  }

  const embed = createEmbed({
    title: player.characterName ?? 'Unknown Character',
    description: `> ${bio}`,
    system: 'players',
    thumbnail: player.characterPortraitUrl ?? undefined,
    fields,
  });

  if (!player.isAlive) {
    embed.addFields({ name: 'Cause of Death', value: player.causeOfDeath ?? 'Unknown', inline: true });
  }

  await interaction.editReply({ embeds: [embed] });
}

// ─── /character edit ───────────────────────────────────────────────────────

async function handleEdit(interaction: ChatInputCommandInteraction): Promise<void> {
  const playerRows = await db
    .select()
    .from(players)
    .where(eq(players.discordId, interaction.user.id))
    .limit(1);

  if (playerRows.length === 0 || !playerRows[0].characterName) {
    await interaction.reply({
      embeds: [errorEmbed('You haven\'t created a character yet. Use `/character create` first.')],
      ephemeral: true,
    });
    return;
  }

  const player = playerRows[0];

  const modal = new ModalBuilder()
    .setCustomId(`char_edit_${interaction.user.id}`)
    .setTitle('Edit Character');

  const bioInput = new TextInputBuilder()
    .setCustomId('character_bio')
    .setLabel('Biography')
    .setPlaceholder('Update your backstory, personality, goals...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(2000)
    .setValue(player.characterBio ?? '');

  const portraitInput = new TextInputBuilder()
    .setCustomId('character_portrait')
    .setLabel('Portrait URL (leave empty to keep current)')
    .setPlaceholder('https://example.com/portrait.png')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(512)
    .setValue(player.characterPortraitUrl ?? '');

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(bioInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(portraitInput),
  );

  await interaction.showModal(modal);

  let modalSubmit: ModalSubmitInteraction;
  try {
    modalSubmit = await interaction.awaitModalSubmit({
      filter: (i) => i.customId === `char_edit_${interaction.user.id}`,
      time: 300_000,
    });
  } catch {
    return;
  }

  const newBio = modalSubmit.fields.getTextInputValue('character_bio').trim() || null;
  const newPortrait = modalSubmit.fields.getTextInputValue('character_portrait').trim() || null;

  if (newPortrait && !newPortrait.match(/^https?:\/\/.+/i)) {
    await modalSubmit.reply({
      embeds: [errorEmbed('Portrait URL must start with `http://` or `https://`.')],
      ephemeral: true,
    });
    return;
  }

  const changes: string[] = [];
  const updateData: Record<string, unknown> = { lastActiveAt: new Date() };

  if (newBio !== player.characterBio) {
    updateData.characterBio = newBio;
    changes.push('biography');
  }
  if (newPortrait !== player.characterPortraitUrl) {
    updateData.characterPortraitUrl = newPortrait;
    changes.push('portrait');
  }

  if (changes.length === 0) {
    await modalSubmit.reply({
      embeds: [errorEmbed('No changes were made.')],
      ephemeral: true,
    });
    return;
  }

  await db.update(players).set(updateData).where(eq(players.id, player.id));

  await db.insert(playerEventLog).values({
    playerId: player.id,
    eventType: 'profile_edit',
    description: `${player.characterName} updated their ${changes.join(' and ')}.`,
    oldValue: { characterBio: player.characterBio, characterPortraitUrl: player.characterPortraitUrl },
    newValue: { characterBio: newBio, characterPortraitUrl: newPortrait },
    triggeredById: player.id,
  });

  await modalSubmit.reply({
    embeds: [successEmbed('Character Updated', `Updated: ${changes.join(', ')}.`)],
    ephemeral: true,
  });
}

// ─── Command definition ────────────────────────────────────────────────────

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('character')
    .setDescription('Character management')
    .addSubcommand((sub) =>
      sub.setName('create').setDescription('Create your character for this season'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('View a character dossier')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The player to view (defaults to yourself)').setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('edit').setDescription('Edit your character bio and portrait'),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();

    switch (sub) {
      case 'create':
        await handleCreate(interaction);
        break;
      case 'view':
        await handleView(interaction);
        break;
      case 'edit':
        await handleEdit(interaction);
        break;
    }
  },
};

export default command;
