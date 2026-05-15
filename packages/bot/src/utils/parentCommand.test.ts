import { describe, expect, it, vi } from 'vitest';
import { dispatchSubcommand, dispatchAutocomplete } from './parentCommand.js';

type Interaction = {
  commandName: string;
  options: {
    getSubcommand: () => string;
    getSubcommandGroup: (required: boolean) => string | null;
  };
  reply: ReturnType<typeof vi.fn>;
};

type AutocompleteInter = {
  commandName: string;
  options: {
    getSubcommand: () => string;
    getSubcommandGroup: (required: boolean) => string | null;
  };
  respond: ReturnType<typeof vi.fn>;
};

function buildInteraction(sub: string, group: string | null = null): Interaction {
  return {
    commandName: 'parent',
    options: {
      getSubcommand: () => sub,
      getSubcommandGroup: () => group,
    },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

function buildAutocompleteInteraction(
  sub: string,
  group: string | null = null,
): AutocompleteInter {
  return {
    commandName: 'parent',
    options: {
      getSubcommand: () => sub,
      getSubcommandGroup: () => group,
    },
    respond: vi.fn().mockResolvedValue(undefined),
  };
}

describe('dispatchSubcommand', () => {
  it('routes an ungrouped subcommand to the matching handler', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const interaction = buildInteraction('view');

    await dispatchSubcommand(interaction as any, { view: { execute } });

    expect(execute).toHaveBeenCalledWith(interaction);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('routes a grouped subcommand to the matching group handler', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const interaction = buildInteraction('change-party', 'admin');

    await dispatchSubcommand(
      interaction as any,
      {},
      { admin: { 'change-party': { execute } } },
    );

    expect(execute).toHaveBeenCalledWith(interaction);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('replies with an error for an unknown ungrouped subcommand', async () => {
    const interaction = buildInteraction('missing');

    await dispatchSubcommand(interaction as any, { view: { execute: vi.fn() } });

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const payload = interaction.reply.mock.calls[0]?.[0];
    expect(payload?.ephemeral).toBe(true);
    const description =
      payload?.embeds?.[0]?.data?.description ?? payload?.embeds?.[0]?.description;
    expect(description).toContain('/parent missing');
  });

  it('replies with an error for an unknown grouped subcommand', async () => {
    const interaction = buildInteraction('missing', 'admin');

    await dispatchSubcommand(
      interaction as any,
      {},
      { admin: { 'change-party': { execute: vi.fn() } } },
    );

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const payload = interaction.reply.mock.calls[0]?.[0];
    const description =
      payload?.embeds?.[0]?.data?.description ?? payload?.embeds?.[0]?.description;
    expect(description).toContain('/parent admin missing');
  });

  it('does not consult the groups map when no group is present', async () => {
    const ungrouped = vi.fn().mockResolvedValue(undefined);
    const grouped = vi.fn().mockResolvedValue(undefined);
    const interaction = buildInteraction('view');

    await dispatchSubcommand(
      interaction as any,
      { view: { execute: ungrouped } },
      { admin: { view: { execute: grouped } } },
    );

    expect(ungrouped).toHaveBeenCalledOnce();
    expect(grouped).not.toHaveBeenCalled();
  });
});

describe('dispatchAutocomplete', () => {
  it('routes autocomplete to the subcommand handler', async () => {
    const autocomplete = vi.fn().mockResolvedValue(undefined);
    const interaction = buildAutocompleteInteraction('view');

    await dispatchAutocomplete(interaction as any, {
      view: { execute: vi.fn(), autocomplete },
    });

    expect(autocomplete).toHaveBeenCalledWith(interaction);
    expect(interaction.respond).not.toHaveBeenCalled();
  });

  it('routes grouped autocomplete to the group handler', async () => {
    const autocomplete = vi.fn().mockResolvedValue(undefined);
    const interaction = buildAutocompleteInteraction('change-party', 'admin');

    await dispatchAutocomplete(
      interaction as any,
      {},
      { admin: { 'change-party': { execute: vi.fn(), autocomplete } } },
    );

    expect(autocomplete).toHaveBeenCalledWith(interaction);
  });

  it('responds with an empty list when no autocomplete is defined', async () => {
    const interaction = buildAutocompleteInteraction('view');

    await dispatchAutocomplete(interaction as any, {
      view: { execute: vi.fn() },
    });

    expect(interaction.respond).toHaveBeenCalledWith([]);
  });

  it('responds with an empty list when the subcommand is unknown', async () => {
    const interaction = buildAutocompleteInteraction('missing');

    await dispatchAutocomplete(interaction as any, {
      view: { execute: vi.fn(), autocomplete: vi.fn() },
    });

    expect(interaction.respond).toHaveBeenCalledWith([]);
  });
});
