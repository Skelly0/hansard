import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { documents, documentCollections, documentVersions, players } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

async function ensureUniqueSlug(base: string): Promise<string> {
  let slug = base;
  let counter = 1;
  while (true) {
    const [existing] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.slug, slug))
      .limit(1);
    if (!existing) return slug;
    slug = `${base}-${counter++}`;
  }
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('document-create')
    .setDescription('Create a new document (staff only)')
    .addStringOption((opt) =>
      opt.setName('title').setDescription('Document title').setRequired(true).setMaxLength(256),
    )
    .addStringOption((opt) =>
      opt.setName('collection').setDescription('Collection name').setRequired(true).setMaxLength(128),
    )
    .addStringOption((opt) =>
      opt.setName('content').setDescription('Document content (markdown)').setRequired(false).setMaxLength(4000),
    )
    .addStringOption((opt) =>
      opt.setName('google-doc-url').setDescription('Google Doc URL (alternative to content)').setRequired(false).setMaxLength(512),
    )
    .addStringOption((opt) =>
      opt.setName('slug').setDescription('Custom slug (auto-generated if omitted)').setRequired(false).setMaxLength(200),
    )
    .addStringOption((opt) =>
      opt.setName('access-level').setDescription('Access level').setRequired(false).addChoices(
        { name: 'public', value: 'public' },
        { name: 'staff', value: 'staff' },
        { name: 'restricted', value: 'restricted' },
      ),
    )
    .addStringOption((opt) =>
      opt.setName('tags').setDescription('Comma-separated tags').setRequired(false).setMaxLength(256),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
      return;
    }
    if (!(await isStaff(member))) {
      await interaction.editReply({ embeds: [errorEmbed('Only staff can create documents.')] });
      return;
    }

    const title = interaction.options.getString('title', true).trim();
    const collectionName = interaction.options.getString('collection', true).trim();
    const content = interaction.options.getString('content')?.trim() || null;
    const googleDocUrl = interaction.options.getString('google-doc-url')?.trim() || null;
    const customSlug = interaction.options.getString('slug')?.trim() || null;
    const accessLevel = interaction.options.getString('access-level') ?? 'public';
    const tagsRaw = interaction.options.getString('tags')?.trim();
    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];

    if (!content && !googleDocUrl) {
      await interaction.editReply({ embeds: [errorEmbed('Must provide either `content` or `google-doc-url`.')] });
      return;
    }

    const allCollections = await db.select().from(documentCollections);
    const collection = allCollections.find(
      (c) => c.name.toLowerCase() === collectionName.toLowerCase(),
    );
    if (!collection) {
      const names = allCollections.map((c) => `\`${c.name}\``).join(', ') || '*none*';
      await interaction.editReply({
        embeds: [errorEmbed(`Collection "${collectionName}" not found. Available: ${names}`)],
      });
      return;
    }

    const [staffPlayer] = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);
    if (!staffPlayer) {
      await interaction.editReply({ embeds: [errorEmbed('You are not registered as a player.')] });
      return;
    }

    const baseSlug = customSlug ? generateSlug(customSlug) : generateSlug(title);
    if (!baseSlug) {
      await interaction.editReply({ embeds: [errorEmbed('Generated slug is empty — provide a different title or slug.')] });
      return;
    }

    try {
      let slug = await ensureUniqueSlug(baseSlug);
      let doc: typeof documents.$inferSelect | undefined;
      const MAX_RETRIES = 5;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          [doc] = await db
            .insert(documents)
            .values({
              collectionId: collection.id,
              title,
              slug,
              content,
              googleDocUrl,
              currentVersion: 1,
              authorId: staffPlayer.id,
              accessLevel,
              tags,
            })
            .returning();
          break;
        } catch (err) {
          lastError = err;
          const code = (err as { code?: string } | null)?.code;
          const msg = err instanceof Error ? err.message : '';
          const isUnique = code === '23505' || /unique|duplicate/i.test(msg);
          if (!isUnique) throw err;
          slug = await ensureUniqueSlug(`${baseSlug}-${attempt + 2}`);
        }
      }
      if (!doc) {
        const m = lastError instanceof Error ? lastError.message : 'slug collision could not be resolved';
        await interaction.editReply({ embeds: [errorEmbed(m)] });
        return;
      }

      if (content) {
        await db.insert(documentVersions).values({
          documentId: doc.id,
          versionNumber: 1,
          content,
          changeDescription: 'Initial version',
          editedById: staffPlayer.id,
        });
      }

      await interaction.editReply({
        embeds: [successEmbed(
          'Document Created',
          [
            `**${title}**`,
            `Slug: \`${doc.slug}\``,
            `Collection: **${collection.name}**`,
            `Access: \`${accessLevel}\``,
            tags.length > 0 ? `Tags: ${tags.map((t) => `\`${t}\``).join(', ')}` : '',
            googleDocUrl ? `[Google Doc](${googleDocUrl})` : '',
          ].filter(Boolean).join('\n'),
        )],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create document';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
    }
  },
};

export default command;
