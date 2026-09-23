import { useMemo, useState } from 'react';
import {
  useCastBallot,
  useElectionEligibility,
  type BallotVote,
  type Election,
} from '../../api/hooks/useVoting';
import { ConfirmModal } from '../shared/Modal';
import { PlayerAvatar } from '../shared/PlayerAvatar';
import { Icon } from '../shared/Icon';

type CandidateOption = { id: string; name: string; partyLabel?: string | null; player: { id: string; characterName?: string | null; discordUsername: string } };

/** Methods where the voter picks exactly one candidate, and the ballot `type` each uses. */
const SINGLE_CHOICE_TYPES: Record<string, 'fptp' | 'two_round' | 'exhaustive'> = {
  fptp: 'fptp',
  proportional: 'fptp',
  two_round_runoff: 'two_round',
  exhaustive_ballot: 'exhaustive',
};

const RANKED_METHODS = new Set(['ranked_choice', 'stv']);

/**
 * Build the ballot payload for an election method. Mirrors the bot's
 * `vote-confirm` builder so web and Discord ballots are identical and both
 * go through `VoteService.castBallot` validation.
 */
export function buildBallot(
  method: string,
  selection: { choice?: 'yea' | 'nay' | 'abstain'; candidateId?: string; ranking?: string[]; approved?: string[] },
): BallotVote | null {
  if (method === 'yea_nay_abstain') {
    return selection.choice ? { type: 'yea_nay_abstain', choice: selection.choice } : null;
  }
  const singleType = SINGLE_CHOICE_TYPES[method];
  if (singleType) {
    return selection.candidateId ? { type: singleType, candidateId: selection.candidateId } : null;
  }
  if (RANKED_METHODS.has(method)) {
    return selection.ranking && selection.ranking.length > 0 ? { type: 'ranked', ranking: selection.ranking } : null;
  }
  if (method === 'approval') {
    return selection.approved && selection.approved.length > 0 ? { type: 'approval', approved: selection.approved } : null;
  }
  return null;
}

const YEA_NAY_OPTIONS = [
  { value: 'yea', label: 'Yea', hint: 'In favour', tone: 'border-status-passed bg-status-passed/10 text-status-passed' },
  { value: 'nay', label: 'Nay', hint: 'Against', tone: 'border-status-rejected bg-status-rejected/10 text-status-rejected' },
  { value: 'abstain', label: 'Abstain', hint: 'Present, not voting', tone: 'border-accent-graveyard bg-accent-graveyard/10 text-text-secondary' },
] as const;

export function BallotPanel({ election }: { election: Election }) {
  const isOpen = election.status === 'voting_open';
  const { data: eligibility, isLoading } = useElectionEligibility(election.id, isOpen && !election.useReactions);
  const cast = useCastBallot();
  const [choice, setChoice] = useState<'yea' | 'nay' | 'abstain' | undefined>();
  const [candidateId, setCandidateId] = useState<string | undefined>();
  const [ranking, setRanking] = useState<string[]>([]);
  const [approved, setApproved] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justVoted, setJustVoted] = useState(false);

  const candidates: CandidateOption[] = useMemo(
    () =>
      (election.candidates ?? [])
        .filter((c) => !c.isWithdrawn)
        .map((c) => ({
          id: c.playerId,
          name: c.player?.characterName || c.player?.discordUsername || 'Unknown candidate',
          partyLabel: c.party ? c.party.shortName || c.party.name : null,
          player: { id: c.playerId, characterName: c.player?.characterName, discordUsername: c.player?.discordUsername ?? '' },
        })),
    [election.candidates],
  );
  const nameOf = (id: string) => candidates.find((c) => c.id === id)?.name ?? 'Unknown';

  if (!isOpen) return null;

  if (election.useReactions) {
    return (
      <Panel title="How to vote">
        <p className="text-body-sm text-text-secondary">
          This vote is cast by reacting to the ballot message in Discord. Reactions stay visible as the
          public record, so it can&rsquo;t be cast from the website.
        </p>
      </Panel>
    );
  }

  if (isLoading) {
    return <Panel title="Your ballot"><div className="skeleton h-10" /></Panel>;
  }

  if (justVoted || eligibility?.reason === 'Already voted') {
    return (
      <Panel title="Your ballot" tone="passed">
        <p className="text-body-sm text-text-secondary flex items-center gap-2">
          <span className="text-status-passed text-lg leading-none" aria-hidden="true">✓</span>
          Your ballot has been recorded.
        </p>
      </Panel>
    );
  }

  if (!eligibility?.eligible) {
    return (
      <Panel title="Your ballot">
        <p className="text-body-sm text-text-tertiary italic">
          {eligibility?.reason ? `You can’t vote in this election: ${eligibility.reason.charAt(0).toLowerCase()}${eligibility.reason.slice(1)}.` : 'You can’t vote in this election.'}
        </p>
      </Panel>
    );
  }

  const ballot = buildBallot(election.method, { choice, candidateId, ranking, approved });
  const maxChoices = typeof election.config?.maxChoices === 'number' ? (election.config.maxChoices as number) : null;
  const needsCandidates = election.method !== 'yea_nay_abstain';

  if (needsCandidates && candidates.length === 0) {
    return (
      <Panel title="Your ballot">
        <p className="text-body-sm text-text-tertiary italic">No candidates are standing yet.</p>
      </Panel>
    );
  }

  if (needsCandidates && !SINGLE_CHOICE_TYPES[election.method] && !RANKED_METHODS.has(election.method) && election.method !== 'approval') {
    return (
      <Panel title="Your ballot">
        <p className="text-body-sm text-text-tertiary italic">This voting method can only be cast from Discord.</p>
      </Panel>
    );
  }

  const summary = (() => {
    if (!ballot) return '';
    switch (ballot.type) {
      case 'yea_nay_abstain': return ballot.choice.toUpperCase();
      case 'fptp':
      case 'two_round':
      case 'exhaustive': return nameOf(ballot.candidateId);
      case 'ranked': return ballot.ranking.map((id, i) => `${i + 1}. ${nameOf(id)}`).join('  ');
      case 'approval': return ballot.approved.map(nameOf).join(', ');
    }
  })();

  const submit = async () => {
    if (!ballot) return;
    setError(null);
    try {
      await cast.mutateAsync({ electionId: election.id, vote: ballot });
      setJustVoted(true);
      setConfirming(false);
    } catch (e: any) {
      setConfirming(false);
      setError(e?.message ?? 'Your ballot could not be recorded.');
    }
  };

  return (
    <Panel title="Cast your ballot">
      {election.method === 'yea_nay_abstain' && (
        <div role="radiogroup" aria-label="Your vote" className="grid grid-cols-3 gap-2">
          {YEA_NAY_OPTIONS.map((opt) => {
            const selected = choice === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setChoice(opt.value)}
                className={`rounded-card border px-2 py-3 text-center transition-colors ${
                  selected ? opt.tone : 'border-border hover:border-border-strong text-text-primary'
                }`}
              >
                <span className="block font-display text-lg font-semibold">{opt.label}</span>
                <span className="block text-[0.6875rem] text-text-tertiary">{opt.hint}</span>
              </button>
            );
          })}
        </div>
      )}

      {SINGLE_CHOICE_TYPES[election.method] && (
        <div role="radiogroup" aria-label="Choose a candidate" className="space-y-1.5">
          {candidates.map((c) => {
            const selected = candidateId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setCandidateId(c.id)}
                className={`w-full flex items-center gap-3 rounded-card border px-3 py-2 text-left transition-colors ${
                  selected ? 'border-accent-voting bg-accent-voting/10' : 'border-border hover:border-border-strong'
                }`}
              >
                <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${selected ? 'border-accent-voting bg-accent-voting' : 'border-border-strong'}`} aria-hidden="true" />
                <PlayerAvatar player={c.player} size="sm" />
                <span className="text-body-sm text-text-primary flex-1 min-w-0 truncate">{c.name}</span>
                {c.partyLabel && <span className="font-mono text-xs text-text-tertiary">{c.partyLabel}</span>}
              </button>
            );
          })}
        </div>
      )}

      {election.method === 'approval' && (
        <fieldset>
          <legend className="text-body-sm text-text-tertiary mb-2">
            Tick every candidate you approve of{maxChoices ? ` (up to ${maxChoices})` : ''}.
          </legend>
          <div className="space-y-1.5">
            {candidates.map((c) => {
              const checked = approved.includes(c.id);
              const atLimit = !checked && maxChoices !== null && approved.length >= maxChoices;
              return (
                <label
                  key={c.id}
                  className={`flex items-center gap-3 rounded-card border px-3 py-2 cursor-pointer transition-colors ${
                    checked ? 'border-accent-voting bg-accent-voting/10' : 'border-border hover:border-border-strong'
                  } ${atLimit ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={atLimit}
                    onChange={() =>
                      setApproved((prev) => (checked ? prev.filter((id) => id !== c.id) : [...prev, c.id]))
                    }
                    className="accent-accent-voting"
                  />
                  <PlayerAvatar player={c.player} size="sm" />
                  <span className="text-body-sm text-text-primary flex-1 min-w-0 truncate">{c.name}</span>
                  {c.partyLabel && <span className="font-mono text-xs text-text-tertiary">{c.partyLabel}</span>}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {RANKED_METHODS.has(election.method) && (
        <RankedBallot candidates={candidates} ranking={ranking} onChange={setRanking} />
      )}

      {error && <p role="alert" className="text-body-sm text-status-rejected mt-3">{error}</p>}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-text-tertiary">Ballots are final once cast.</p>
        <button
          type="button"
          className="btn-primary"
          disabled={!ballot || cast.isPending}
          onClick={() => setConfirming(true)}
        >
          Cast ballot
        </button>
      </div>

      <ConfirmModal
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={submit}
        pending={cast.isPending}
        title="Cast your ballot?"
        confirmLabel="Cast ballot"
        message={
          <>
            <p className="mb-2">You are voting:</p>
            <p className="font-display text-heading-1 text-text-primary mb-3 break-words">{summary}</p>
            <p className="text-body-sm text-text-tertiary">This can&rsquo;t be changed afterwards.</p>
          </>
        }
      />
    </Panel>
  );
}

function RankedBallot({
  candidates,
  ranking,
  onChange,
}: {
  candidates: CandidateOption[];
  ranking: string[];
  onChange: (next: string[]) => void;
}) {
  const unranked = candidates.filter((c) => !ranking.includes(c.id));
  const move = (index: number, delta: number) => {
    const next = [...ranking];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const byId = new Map(candidates.map((c) => [c.id, c]));

  return (
    <div className="space-y-3">
      <p className="text-body-sm text-text-tertiary">
        Add candidates in order of preference. You don&rsquo;t have to rank everyone.
      </p>
      {ranking.length > 0 && (
        <ol className="space-y-1.5" aria-label="Your ranking">
          {ranking.map((id, i) => {
            const c = byId.get(id);
            if (!c) return null;
            return (
              <li key={id} className="flex items-center gap-2 rounded-card border border-accent-voting bg-accent-voting/10 px-3 py-2">
                <span className="font-mono text-sm text-accent-voting w-5 text-right">{i + 1}</span>
                <PlayerAvatar player={c.player} size="sm" />
                <span className="text-body-sm text-text-primary flex-1 min-w-0 truncate">{c.name}</span>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1 rounded text-text-tertiary hover:text-text-primary disabled:opacity-30" aria-label={`Move ${c.name} up`}>
                  <Icon name="chevron-down" size={16} className="rotate-180" />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === ranking.length - 1} className="p-1 rounded text-text-tertiary hover:text-text-primary disabled:opacity-30" aria-label={`Move ${c.name} down`}>
                  <Icon name="chevron-down" size={16} />
                </button>
                <button type="button" onClick={() => onChange(ranking.filter((r) => r !== id))} className="p-1 rounded text-text-tertiary hover:text-status-rejected" aria-label={`Remove ${c.name} from ranking`}>
                  <Icon name="close" size={14} />
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {unranked.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {unranked.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange([...ranking, c.id])}
              className="inline-flex items-center gap-2 rounded-full border border-border hover:border-accent-voting px-3 py-1 text-body-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              <span aria-hidden="true">+</span> {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Panel({ title, children, tone }: { title: string; children: React.ReactNode; tone?: 'passed' }) {
  return (
    <section
      aria-label={title}
      className={`card mb-6 ${tone === 'passed' ? 'border-l-status-passed' : 'border-l-accent-voting'}`}
    >
      <h2 className="text-heading-2 text-text-secondary mb-3">{title}</h2>
      {children}
    </section>
  );
}
