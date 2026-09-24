import { useState } from 'react';
import {
  CHARACTER_BIO_MAX,
  CHARACTER_PORTRAIT_URL_MAX,
  useUpdatePlayer,
  type UpdatePlayerInput,
} from '../../api/hooks/usePlayers';
import { Modal } from '../shared/Modal';
import { PlayerAvatar } from '../shared/PlayerAvatar';
import { isHttpsUrl } from '../../lib/url';

interface EditableCharacter {
  id: string;
  characterName?: string | null;
  discordUsername: string;
  characterBio?: string | null;
  characterPortraitUrl?: string | null;
}

/** Discord's signed attachment links expire, so they make poor portraits. */
function isDiscordAttachmentUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'cdn.discordapp.com' || host === 'media.discordapp.net';
  } catch {
    return false;
  }
}

/**
 * Edit a character's biography and portrait. Staff may also rename, since the
 * name is the character's public identity; players rename through staff.
 */
export function EditCharacterModal({
  character,
  canRename,
  onClose,
}: {
  character: EditableCharacter;
  canRename: boolean;
  onClose: () => void;
}) {
  const update = useUpdatePlayer();
  const [name, setName] = useState(character.characterName ?? '');
  const [bio, setBio] = useState(character.characterBio ?? '');
  const [portrait, setPortrait] = useState(character.characterPortraitUrl ?? '');
  const [error, setError] = useState<string | null>(null);

  const portraitTrimmed = portrait.trim();
  const portraitChanged = portraitTrimmed !== (character.characterPortraitUrl ?? '');
  const portraitUnusable = portraitTrimmed !== ''
    && (!isHttpsUrl(portraitTrimmed) || portraitTrimmed.length > CHARACTER_PORTRAIT_URL_MAX);
  // Only a new value is validated: a portrait stored before the https rule (or
  // set from Discord) is never re-sent, so it must not block a bio edit.
  const portraitInvalid = portraitChanged && portraitUnusable;
  const legacyPortrait = !portraitChanged && portraitUnusable;
  const bioTooLong = bio.length > CHARACTER_BIO_MAX;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (bioTooLong || portraitInvalid) return;

    // Only send what changed, so an untouched field is never rewritten.
    const patch: UpdatePlayerInput = { id: character.id };
    if (canRename && name.trim() && name.trim() !== (character.characterName ?? '')) patch.characterName = name.trim();
    if (bio !== (character.characterBio ?? '')) patch.characterBio = bio;
    if (portraitChanged) patch.characterPortraitUrl = portraitTrimmed || null;
    if (Object.keys(patch).length === 1) {
      onClose();
      return;
    }
    try {
      await update.mutateAsync(patch);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the character.');
    }
  };

  const previewName = (canRename && name.trim()) || character.characterName || character.discordUsername;

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit character"
      eyebrow={character.characterName ?? undefined}
      railClass="bg-accent-players"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            type="submit"
            form="edit-character-form"
            disabled={update.isPending || bioTooLong || portraitInvalid}
            className="btn-primary disabled:opacity-50"
          >
            {update.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="edit-character-form" onSubmit={submit} className="space-y-4">
        {canRename && (
          <label className="block">
            <span className="text-label-ui text-text-tertiary block mb-1">Character name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={128}
              className="field w-full"
              autoComplete="off"
            />
          </label>
        )}

        <div className="flex items-start gap-4">
          {/* Remount on URL change so a previously failed image gets a fresh try. */}
          <PlayerAvatar
            key={portraitTrimmed}
            player={{
              id: character.id,
              characterName: previewName,
              discordUsername: character.discordUsername,
              characterPortraitUrl: portraitUnusable ? null : portraitTrimmed || null,
            }}
            size="lg"
          />
          <label className="block flex-1 min-w-0">
            <span className="text-label-ui text-text-tertiary block mb-1">Portrait URL</span>
            <input
              type="url"
              inputMode="url"
              value={portrait}
              onChange={(e) => setPortrait(e.target.value)}
              placeholder="https://…"
              className="field w-full font-mono text-xs"
              aria-invalid={portraitInvalid}
              aria-describedby="portrait-help"
            />
            <span id="portrait-help" className={`block mt-1 text-xs ${portraitInvalid ? 'text-status-rejected' : 'text-text-tertiary'}`}>
              {portraitInvalid
                ? `Use an https link of at most ${CHARACTER_PORTRAIT_URL_MAX} characters.`
                : legacyPortrait
                  ? 'This portrait is not an https link, so the site cannot show it. Replace or clear it.'
                  : isDiscordAttachmentUrl(portraitTrimmed)
                  ? 'Discord attachment links expire after a while; a durable image host lasts longer.'
                  : 'Leave empty to remove the portrait.'}
            </span>
          </label>
        </div>

        <label className="block">
          <span className="flex items-baseline justify-between mb-1">
            <span className="text-label-ui text-text-tertiary">Biography</span>
            <span className={`font-mono text-xs ${bioTooLong ? 'text-status-rejected' : 'text-text-tertiary'}`}>
              {bio.length} / {CHARACTER_BIO_MAX}
            </span>
          </span>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={8}
            className="field w-full font-body resize-y"
            aria-invalid={bioTooLong}
          />
        </label>

        {error && <p role="alert" className="text-body-sm text-status-rejected">{error}</p>}
      </form>
    </Modal>
  );
}
