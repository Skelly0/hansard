import { describe, expect, it } from 'vitest';
import {
  buildTicketCategoryFields,
  normalizeTicketCategoryInput,
  parseAssignableRoles,
} from './categoryHelpers.js';

describe('parseAssignableRoles', () => {
  it('trims empty entries and preserves first-seen role order', () => {
    expect(parseAssignableRoles('Staff, Appeals Team, Staff, , Moderators')).toEqual([
      'Staff',
      'Appeals Team',
      'Moderators',
    ]);
  });

  it('returns an empty array when no roles are provided', () => {
    expect(parseAssignableRoles(null)).toEqual([]);
  });
});

describe('normalizeTicketCategoryInput', () => {
  it('normalizes command options into a ticket_categories insert payload', () => {
    expect(normalizeTicketCategoryInput({
      name: '  Appeals  ',
      description: '  Appeals and review requests  ',
      emoji: '⚖️',
      colour: '#7B8BA8',
      assignableRoles: 'Appeals Team, Staff',
      sortOrder: 10,
    })).toEqual({
      name: 'Appeals',
      description: 'Appeals and review requests',
      emoji: '⚖️',
      colour: '#7B8BA8',
      assignableRoles: ['Appeals Team', 'Staff'],
      sortOrder: 10,
      isActive: true,
    });
  });

  it('rejects invalid hex colours', () => {
    expect(() => normalizeTicketCategoryInput({
      name: 'Bug Reports',
      colour: 'blue',
    })).toThrow('Colour must be a 6-digit hex code like `#7B8BA8`.');
  });
});

describe('buildTicketCategoryFields', () => {
  it('renders active category fields with descriptions and assignable roles', () => {
    expect(buildTicketCategoryFields([
      {
        id: 'cat-1',
        name: 'Appeals',
        description: 'Appeals and review requests',
        emoji: '⚖️',
        colour: '#7B8BA8',
        assignableRoles: ['Appeals Team', 'Staff'],
        sortOrder: 10,
      },
    ])).toEqual([
      {
        name: '⚖️ Appeals',
        value: 'Appeals and review requests\n*Assignable roles:* Appeals Team, Staff\n*Sort order:* 10',
      },
    ]);
  });
});
