import { usePlayers, type Player } from '../api/hooks/usePlayers';
import { Tag } from '../components/shared/Tag';
import { PageSkeleton } from '../components/shared/SkeletonLoader';

// ---- Helpers ----

function extractYear(dateStr?: string): string {
  if (!dateStr) return '?';
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? dateStr : String(d.getFullYear());
}

function ageAtDeath(player: Player): string {
  if (player.currentAge) return `${player.currentAge}`;
  if (player.birthDate && player.deathDate) {
    const birth = new Date(player.birthDate);
    const death = new Date(player.deathDate);
    const age = death.getFullYear() - birth.getFullYear();
    return `${age}`;
  }
  if (player.startingAge) return `${player.startingAge}`;
  return '?';
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
  if (player.characterPortraitUrl) {
    return (
      <div className="w-20 h-20 rounded-full overflow-hidden flex-shrink-0 border border-border-subtle">
        <img
          src={player.characterPortraitUrl}
          alt={player.characterName || 'Portrait'}
          className="w-full h-full object-cover grayscale"
        />
      </div>
    );
  }

  // Serif initials circle
  return (
    <div className="w-20 h-20 rounded-full flex-shrink-0 bg-inset border border-border-subtle flex items-center justify-center">
      <span className="font-display text-xl text-text-tertiary select-none">
        {initials(player.characterName)}
      </span>
    </div>
  );
}

// ---- Obituary Card ----

function ObituaryCard({ player }: { player: Player }) {
  const birthYear = extractYear(player.birthDate);
  const deathYear = extractYear(player.deathDate);
  const age = ageAtDeath(player);

  // Build party history from current party (full history would come from events/dossier)
  const parties: { name: string; colour?: string }[] = [];
  if (player.party) {
    parties.push({ name: player.party.name, colour: player.party.colour });
  }

  // Auto-generated obituary text
  const obituary = buildObituary(player, birthYear, deathYear, age);

  return (
    <article className="card border-l-accent-graveyard">
      <div className="flex gap-5">
        {/* Portrait */}
        <ObituaryPortrait player={player} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Name */}
          <h2 className="text-heading-1 text-text-primary mb-1">
            {player.characterName || player.discordUsername}
          </h2>

          {/* Dates */}
          <p className="text-mono text-text-tertiary mb-3">
            {birthYear} &mdash; {deathYear}
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
                          {extractYear(office.startDate)}
                          {office.endDate ? `\u2013${extractYear(office.endDate)}` : ''}
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
  const { data, isLoading } = usePlayers({ alive: false, limit: 100 });

  if (isLoading) return <PageSkeleton />;

  // Sort by death date, most recent first
  const deceased = [...(data?.data ?? [])].sort((a, b) => {
    const da = a.deathDate ? new Date(a.deathDate).getTime() : 0;
    const db = b.deathDate ? new Date(b.deathDate).getTime() : 0;
    return db - da;
  });

  return (
    <div className="p-8 max-w-3xl mx-auto">
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
        <div className="card border-l-accent-graveyard text-center py-12">
          <p className="text-body text-text-tertiary italic">
            No members have yet departed. Long may it last.
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
