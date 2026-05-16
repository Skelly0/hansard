import type { EmbedField } from '../../utils/embeds.js';

export interface TicketCategoryInput {
  name: string;
  description?: string | null;
  emoji?: string | null;
  colour?: string | null;
  assignableRoles?: string | null;
  sortOrder?: number | null;
}

export interface NormalizedTicketCategory {
  name: string;
  description: string | null;
  emoji: string | null;
  colour: string | null;
  assignableRoles: string[];
  sortOrder: number;
  isActive: true;
}

export interface TicketCategoryDisplay {
  id: string;
  name: string;
  description: string | null;
  emoji: string | null;
  colour: string | null;
  assignableRoles: string[] | null;
  sortOrder: number;
}

const HEX_COLOUR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function cleanOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function parseAssignableRoles(value: string | null | undefined): string[] {
  if (!value) return [];

  const seen = new Set<string>();
  const roles: string[] = [];

  for (const role of value.split(',').map((item) => item.trim()).filter(Boolean)) {
    const key = role.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    roles.push(role);
  }

  return roles;
}

export function normalizeTicketCategoryInput(input: TicketCategoryInput): NormalizedTicketCategory {
  const name = input.name.trim();
  if (!name) {
    throw new Error('Name is required.');
  }

  const colour = cleanOptionalText(input.colour);
  if (colour && !HEX_COLOUR_PATTERN.test(colour)) {
    throw new Error('Colour must be a 6-digit hex code like `#7B8BA8`.');
  }

  return {
    name,
    description: cleanOptionalText(input.description),
    emoji: cleanOptionalText(input.emoji),
    colour,
    assignableRoles: parseAssignableRoles(input.assignableRoles),
    sortOrder: input.sortOrder ?? 0,
    isActive: true,
  };
}

export function buildTicketCategoryFields(categories: TicketCategoryDisplay[]): EmbedField[] {
  return categories.map((category) => {
    const assignableRoles = category.assignableRoles ?? [];
    const roleLine = assignableRoles.length > 0
      ? `\n*Assignable roles:* ${assignableRoles.join(', ')}`
      : '';
    return {
      name: `${category.emoji ? `${category.emoji} ` : ''}${category.name}`,
      value: [
        category.description ?? 'No description',
        roleLine,
        `\n*Sort order:* ${category.sortOrder}`,
      ].join(''),
    };
  });
}

export function buildTicketCategoryCreatedDescription(category: TicketCategoryDisplay): string {
  const roles = category.assignableRoles ?? [];

  return [
    `${category.emoji ? `${category.emoji} ` : ''}**${category.name}**`,
    category.description ? `*${category.description}*` : '',
    category.colour ? `**Colour:** \`${category.colour}\`` : '',
    roles.length > 0 ? `**Assignable roles:** ${roles.join(', ')}` : '',
    `**Sort order:** ${category.sortOrder}`,
    `\nID: \`${category.id}\``,
  ].filter(Boolean).join('\n');
}
