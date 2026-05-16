import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PlayerAvatar, colorForId } from './PlayerAvatar';

describe('colorForId', () => {
  it('is deterministic — same id yields same color', () => {
    expect(colorForId('abc')).toBe(colorForId('abc'));
  });

  it('different ids land in the palette', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const seen = new Set(ids.map(colorForId));
    expect(seen.size).toBeGreaterThan(1); // not always the same color
  });
});

describe('PlayerAvatar', () => {
  it('renders the first character of characterName uppercased', () => {
    const { getByText } = render(
      <PlayerAvatar player={{ id: '1', characterName: 'aldrick vance', discordUsername: 'aldrick.v' }} size="sm" />,
    );
    expect(getByText('A')).toBeInTheDocument();
  });

  it('falls back to discordUsername when characterName is null', () => {
    const { getByText } = render(
      <PlayerAvatar player={{ id: '1', characterName: null, discordUsername: 'bob' }} size="sm" />,
    );
    expect(getByText('B')).toBeInTheDocument();
  });

  it('renders ? when both names are missing', () => {
    const { getByText } = render(
      <PlayerAvatar player={{ id: '1', characterName: null, discordUsername: '' }} size="sm" />,
    );
    expect(getByText('?')).toBeInTheDocument();
  });
});
