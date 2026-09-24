import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { usePlayers, type Player } from '../api/hooks/usePlayers';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { isHttpsUrl } from '../lib/url';
import { compareSimDates, formatSimDate, simYear, simYearsBetween } from '../lib/format';
import { Tag } from '../components/shared/Tag';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { QueryErrorState } from '../components/shared/QueryErrorState';

// ---- Helpers ----

function ageAtDeath(player: Player): string {
  if (player.currentAge) return `${player.currentAge}`;
  const years = simYearsBetween(player.birthDate, player.deathDate);
  if (years !== null) return `${years}`;
  if (player.startingAge) return `${player.startingAge}`;
  return '?';
}

/** Year of a real timestamp (office terms), not a simulation date. */
function timestampYear(value?: string): string {
  if (!value) return '?';
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : String(d.getFullYear());
}

/** Generate initials from a character name */
function initials(name?: string): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// ---- Portrait ----

function ObituaryPortrait({ player }: { player: Player }) {
  // Discord attachment URLs expire, so fall back to initials on a load error.
  const [failed, setFailed] = useState(false);
  if (player.characterPortraitUrl && !failed && isHttpsUrl(player.characterPortraitUrl)) {
    return (
      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden flex-shrink-0 border border-border-subtle">
        <img
          src={player.characterPortraitUrl}
          alt={player.characterName || 'Portrait'}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover grayscale"
        />
      </div>
    );
  }

  // Serif initials circle
  return (
    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full flex-shrink-0 bg-inset border border-border-subtle flex items-center justify-center" aria-hidden="true">
      <span className="font-display text-xl text-text-tertiary select-none">
        {initials(player.characterName)}
      </span>
    </div>
  );
}

// ---- Obituary Card ----

function ObituaryCard({ player }: { player: Player }) {
  const birthYear = simYear(player.birthDate);
  const deathYear = simYear(player.deathDate);
  const age = ageAtDeath(player);

  // Build party history from current party (full history would come from events/dossier)
  const parties: { name: string; colour?: string }[] = [];
  if (player.party) {
    parties.push({ name: player.party.name, colour: player.party.colour });
  }

  // Auto-generated obituary text
  const obituary = buildObituary(player, birthYear, deathYear, age);

  return (
    <article className="card">
      <div className="flex gap-4 sm:gap-5">
        {/* Portrait */}
        <ObituaryPortrait player={player} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Name */}
          <h2 className="text-heading-1 text-text-primary mb-1">
            <Link to="/players/$id" params={{ id: player.id }} className="hover:text-accent-primary transition-colors">
              {player.characterName || player.discordUsername}
            </Link>
          </h2>

          {/* Dates */}
          <p className="text-mono text-text-tertiary mb-3">
            {birthYear} &mdash; {deathYear}
            {player.deathDate && (
              <span className="block sm:inline sm:ml-3 text-xs">died {formatSimDate(player.deathDate)}</span>
            )}
          </p>

          {/* Cause of death & age */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-body-sm text-text-secondary mb-3">
            {player.causeOfDeath && (
              <span>
                <span className="text-text-tertiary">Cause: </span>
                {player.causeOfDeath}
              </span>
            )}
            <span>
              <span className="text-text-tertiary">Age: </span>
              {age}
            </span>
          </div>

          {/* Party history tags */}
          {parties.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {parties.map((p, i) => (
                <Tag key={i} color="graveyard">
                  {p.name}
                </Tag>
              ))}
            </div>
          )}

          {/* Offices held */}
          {(() => {
            const raw = player.profileData?.offices;
            if (!Array.isArray(raw) || raw.length === 0) return null;
            const offices = raw as { name: string; startDate?: string; endDate?: string }[];
            return (
              <div className="mb-3">
                <p className="text-label-ui text-text-tertiary mb-1">Offices Held</p>
                <ul className="text-body-sm text-text-secondary space-y-0.5">
                  {offices.map((office, i) => (
                    <li key={i}>
                      {office.name}
                      {office.startDate && (
                        <span className="text-mono text-text-tertiary ml-2">
                          {timestampYear(office.startDate)}
                          {office.endDate ? `\u2013${timestampYear(office.endDate)}` : ''}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          {/* Obituary narrative */}
          <p className="text-body italic text-text-secondary mt-4 leading-relaxed">
            {obituary}
          </p>

          {/* Footer */}
          <p className="text-mono text-text-tertiary mt-4">
            Rest in peace.
          </p>
        </div>
      </div>
    </article>
  );
}

// ---- Obituary generator ----

function buildObituary(
  player: Player,
  birthYear: string,
  deathYear: string,
  age: string,
): string {
  const name = player.characterName || player.discordUsername;
  const party = player.party?.name;
  const cause = player.causeOfDeath;

  // Use bio if available as the obituary text
  if (player.characterBio) return player.characterBio;

  // Otherwise generate something minimal but warm
  const parts: string[] = [];
  parts.push(`${name} served the chamber`);
  if (party) parts.push(`as a member of the ${party}`);
  parts.push(`from ${birthYear} until their passing in ${deathYear} at the age of ${age}.`);
  if (cause) {
    parts.push(`Their departure was attributed to ${cause.toLowerCase()}.`);
  }
  parts.push('They will be remembered by those who sat beside them.');

  return parts.join(' ');
}

// ---- Main Page ----

export function Graveyard() {
  useDocumentTitle('Graveyard');
  const { data, isLoading, isError, error } = usePlayers({ alive: false, limit: 100 });

  if (isLoading) return <PageSkeleton />;
  if (isError) {
    return (
      <div className="page max-w-3xl mx-auto">
        <QueryErrorState title="Could not load graveyard" error={error} />
      </div>
    );
  }

  // Sort by death date, most recent first
  const deceased = [...(data?.data ?? [])].sort((a, b) => compareSimDates(b.deathDate, a.deathDate));

  return (
    <div className="page max-w-3xl mx-auto">
      {/* Header */}
      <header className="text-center mb-10">
        <h1 className="text-display text-text-primary mb-2">In Memoriam</h1>
        <p className="font-body text-body italic text-text-secondary">
          Those who served, and have since departed the chamber.
        </p>
        <div className="mt-4 mx-auto w-16 border-t border-border" />
      </header>

      {/* Obituary list */}
      {deceased.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-body text-text-tertiary italic">
            None have been laid to rest.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {deceased.map((player) => (
            <ObituaryCard key={player.id} player={player} />
          ))}
        </div>
      )}

      {/* Page footer */}
      <footer className="text-center mt-12 mb-4">
        <div className="mx-auto w-16 border-t border-border mb-4" />
        <p className="text-mono text-text-tertiary text-xs">
          {deceased.length} {deceased.length === 1 ? 'soul' : 'souls'} at rest
        </p>
      </footer>
    </div>
  );
}
