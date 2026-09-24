import { useState } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import {
  useElection,
  useElectionResults,
  useElectionRounds,
  useElectionTurnout,
  useOpenVoting,
  useCloseVoting,
  useTallyVotes,
  useCertifyElection,
  useCreateRunoff,
  useNpcConfirm,
  useWithdrawCandidate,
  useRegisterCandidate,
  hasTalliedResults,
  isSealedOpenResults,
  type Election,
} from '../api/hooks/useVoting';
import { useAuth } from '../api/hooks/useAuth';
import { useSearchPlayers } from '../api/hooks/usePlayers';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { Tag, statusToTagColor } from '../components/shared/Tag';
import { StatusTimeline } from '../components/shared/StatusTimeline';
import { ResultsBars, MultiRoundBars } from '../components/shared/ResultsBars';
import { MetricStrip } from '../components/shared/MetricCard';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { Modal, ConfirmModal } from '../components/shared/Modal';
import { PlayerAvatar } from '../components/shared/PlayerAvatar';
import { PageHeader, Breadcrumbs, SectionHeading } from '../components/shared/PageHeader';
import { BallotPanel } from '../components/voting/BallotPanel';
import { Countdown } from '../components/shared/Countdown';
import { formatDate, formatDateTime, humanizeToken, relativeTime } from '../lib/format';

/** Mirrors the API: after these statuses only staff may change who stood. */
const CANDIDATE_LIST_LOCKED = new Set(['voting_closed', 'tallied', 'runoff_needed', 'npc_pending', 'certified', 'cancelled']);
/** Mirrors CANDIDATE_STATEMENT_MAX in the API (fits a Discord embed field). */
const CANDIDATE_STATEMENT_MAX = 1000;

const ELECTION_STAGES = [
  { key: 'draft', label: 'Draft' },
  { key: 'nominations', label: 'Nominations' },
  { key: 'voting', label: 'Voting' },
  { key: 'tallied', label: 'Tallied' },
  { key: 'certified', label: 'Certified' },
];

/** Candidate-less votes (motions, referenda) skip the nominations stage. */
function stagesFor(method: string) {
  return method === 'yea_nay_abstain'
    ? ELECTION_STAGES.filter((stage) => stage.key !== 'nominations')
    : ELECTION_STAGES;
}

function getElectionStageIndex(status: string, method: string): number {
  const skipNominations = method === 'yea_nay_abstain';
  const map: Record<string, number> = {
    draft: 0,
    nominations_open: 1,
    nominations_closed: 1,
    voting_open: 2,
    voting_closed: 2,
    tallied: 3,
    runoff_needed: 3,
    npc_pending: 3,
    certified: 4,
    cancelled: -1,
  };
  const index = map[status] ?? 0;
  return skipNominations && index >= 1 ? index - 1 : index;
}

const typeLabel: Record<string, string> = {
  legislative_vote: 'Legislative Vote',
  position_election: 'Position Election',
  appointment_confirmation: 'Appointment Confirmation',
  general_election: 'General Election',
  referendum: 'Referendum',
  confidence_vote: 'Confidence Vote',
  constitutional_amendment: 'Constitutional Amendment',
  party_primary: 'Party Primary',
  custom: 'Custom',
};

const methodLabel: Record<string, string> = {
  fptp: 'First Past the Post',
  ranked_choice: 'Ranked Choice (IRV)',
  stv: 'Single Transferable Vote',
  approval: 'Approval Voting',
  proportional: 'Proportional Representation',
  yea_nay_abstain: 'Yea / Nay / Abstain',
  two_round_runoff: 'Two-Round Runoff',
  exhaustive_ballot: 'Exhaustive Ballot',
};

export function ElectionDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { user, isStaff } = useAuth();
  const { data: election, isLoading, isError } = useElection(id);
  const isLive = election?.status === 'voting_open';
  const { data: results } = useElectionResults(id, isLive);
  const { data: rounds } = useElectionRounds(id);
  const { data: turnout } = useElectionTurnout(id, isLive);

  if (isLoading) return <PageSkeleton />;
  if (isError || !election) {
    return (
      <div className="page">
        <Breadcrumbs items={[{ label: 'Voting', to: '/voting' }, { label: 'Not found' }]} />
        <div className="notice notice-danger">
          <h1 className="text-heading-1 text-text-primary mb-2">Election not found</h1>
          <p className="text-body text-text-secondary">
            We couldn&rsquo;t load this election. It may have been removed, or the link may be wrong.
          </p>
        </div>
      </div>
    );
  }

  const stageIndex = getElectionStageIndex(election.status, election.method);
  const isYeaNay = election.method === 'yea_nay_abstain';
  // Narrow the API response: only the "tallied" shape carries finalTallies /
  // winners / passed / rounds. Sealed-open and unsealed-pending shapes have
  // `results: null` and must NOT be treated as tallied output.
  const tally = hasTalliedResults(results) ? results : null;
  const sealedOpen = isSealedOpenResults(results);
  const hasMultipleRounds = !!tally?.rounds && tally.rounds.length > 1;

  // Build candidate name map
  const candidateNames: Record<string, string> = {};
  election.candidates?.forEach((c) => {
    candidateNames[c.playerId] = c.player?.characterName || c.player?.discordUsername || 'Unknown';
  });

  const isOpen = election.status === 'voting_open';

  // Candidacy rules mirror DELETE/POST /api/elections/:id/candidates.
  const candidateBased = election.method !== 'yea_nay_abstain';
  const candidates = election.candidates ?? [];
  const myCandidacy = user ? candidates.find((c) => c.playerId === user.id) : undefined;
  const acceptsNominations = election.status === 'nominations_open' || election.status === 'draft';
  const beforeVoting = acceptsNominations || election.status === 'nominations_closed';
  const listLocked = CANDIDATE_LIST_LOCKED.has(election.status);
  const canWithdraw = (playerId: string) =>
    isStaff || (!listLocked && (playerId === user?.id || (election.createdById === user?.id && beforeVoting)));

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: 'Voting', to: '/voting' }, { label: election.title }]}
        eyebrow={
          <>
            <Tag color="voting">{typeLabel[election.type] || election.type}</Tag>
            <Tag color={statusToTagColor(election.status)}>{humanizeToken(election.status)}</Tag>
            {election.roundNumber > 1 && <Tag color="pending">Round {election.roundNumber}</Tag>}
          </>
        }
        title={election.title}
        subtitle={election.description || undefined}
        rule={false}
        className="mb-4"
      />

      {/* Metadata */}
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-body-sm text-text-secondary mb-5">
        <div className="flex items-baseline gap-1.5">
          <dt className="text-label-ui text-text-tertiary">Method</dt>
          <dd className="font-mono text-xs">{methodLabel[election.method] || election.method}</dd>
        </div>
        {election.forOffice && (
          <div className="flex items-baseline gap-1.5">
            <dt className="text-label-ui text-text-tertiary">For office</dt>
            <dd>{election.forOffice.name}</dd>
          </div>
        )}
        <div className="flex items-baseline gap-1.5">
          <dt className="text-label-ui text-text-tertiary">Opens</dt>
          <dd className="font-mono text-xs">{formatDateTime(election.votingOpensAt)}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-label-ui text-text-tertiary">Closes</dt>
          <dd className="font-mono text-xs">
            {formatDateTime(election.votingClosesAt)}
            {isOpen && <> · <Countdown to={election.votingClosesAt} className="text-accent-voting" /></>}
          </dd>
        </div>
        {election.createdBy && (
          <div className="flex items-baseline gap-1.5">
            <dt className="text-label-ui text-text-tertiary">Called by</dt>
            <dd>
              <Link
                to="/players/$id"
                params={{ id: election.createdById }}
                className="hover:text-accent-primary transition-colors"
              >
                {election.createdBy.characterName || election.createdBy.discordUsername}
              </Link>
            </dd>
          </div>
        )}
      </dl>

      <div className="rule-masthead mb-6" aria-hidden="true" />

      {/* Timeline */}
      <section aria-label="Stages of the vote" className="card mb-8 py-5 sm:py-6">
        <StatusTimeline
          stages={stagesFor(election.method)}
          currentIndex={stageIndex}
          horizontal
        />
      </section>

      {/* Staff controls */}
      {isStaff && <StaffControls election={election} />}

      {/* Metrics row: turnout only means something once ballots can be cast. */}
      {turnout && !beforeVoting && (
        <MetricStrip
          className="grid-cols-3 mb-8"
          metrics={[
            { label: 'Eligible voters', value: turnout.eligible, color: 'text-accent-voting' },
            { label: 'Votes cast', value: turnout.voted, color: 'text-accent-voting' },
            { label: 'Turnout', value: `${Math.round(turnout.turnoutPct)}%`, color: 'text-accent-voting' },
          ]}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-10">
        {/* Results area */}
        <div className="lg:col-span-2 min-w-0">
          <BallotPanel election={election} />

          {beforeVoting && (
            <div className="card mb-4">
              <p className="text-label-ui text-text-tertiary mb-1">Voting has not opened</p>
              <p className="text-body-sm text-text-secondary">
                Ballots open {formatDateTime(election.votingOpensAt)}
                {' '}(<Countdown to={election.votingOpensAt} prefix="in" endedLabel="once staff open it" />).
                {candidateBased && election.status !== 'draft' && ' The candidate list is settled before then.'}
              </p>
            </div>
          )}

          {/* Cancelled note even if no results were ever tallied */}
          {!tally && election.status === 'cancelled' && (
            <div className="notice notice-danger mb-4">
              <p className="text-label-ui text-text-tertiary mb-1">Vote Cancelled</p>
              <p className="text-body-sm text-text-secondary">
                This vote was cancelled before completion. No final tally was recorded.
              </p>
            </div>
          )}

          {/* Sealed-open notice: voting is still live and results are hidden
              until close, so we cannot render tallies yet. */}
          {sealedOpen && (
            <div className="card mb-4">
              <p className="text-label-ui text-text-tertiary mb-1">Results Sealed</p>
              <p className="text-body-sm text-text-secondary">
                Results are sealed until close. Tallies will appear here once
                voting ends.
              </p>
            </div>
          )}

          {/* Results visualization — only when the API actually returned an
              inline ElectionResults payload. */}
          {tally && (
            <div className="mb-6">
              <SectionHeading size="lg" className="mb-4">Results</SectionHeading>

              {/* The declaration: a motion's division, or who was elected. */}
              {isYeaNay && tally.passed !== undefined ? (
                <div className="card mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-label-ui text-text-tertiary mb-1">The division</p>
                    <p className={`text-display ${tally.passed ? 'text-status-passed' : 'text-status-rejected'}`}>
                      {tally.passed ? 'The Ayes have it.' : 'The Noes have it.'}
                    </p>
                  </div>
                  <Tag color={tally.passed ? 'passed' : 'rejected'}>
                    {tally.passed ? 'Motion passed' : 'Motion failed'}
                  </Tag>
                </div>
              ) : tally.winners && tally.winners.length > 0 ? (
                <div className="card mb-4">
                  <p className="text-label-ui text-text-tertiary mb-1">Declared elected</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {tally.winners.map((winnerId) => (
                      <span key={winnerId} className="text-display text-accent-primary">
                        {candidateNames[winnerId] || winnerId}
                      </span>
                    ))}
                  </div>
                  {tally.passed !== undefined && (
                    <Tag color={tally.passed ? 'passed' : 'rejected'} className="mt-3">
                      {tally.passed ? 'Motion passed' : 'Motion failed'}
                    </Tag>
                  )}
                </div>
              ) : tally.passed !== undefined ? (
                <div className="card mb-4">
                  <p className="text-label-ui text-text-tertiary mb-1">Final outcome</p>
                  <Tag color={tally.passed ? 'passed' : 'rejected'}>
                    {tally.passed ? 'Motion passed' : 'Motion failed'}
                  </Tag>
                </div>
              ) : null}

              {/* Cancelled state — show a clear note instead of empty bars */}
              {election.status === 'cancelled' && (
                <div className="notice notice-danger mb-4">
                  <p className="text-label-ui text-text-tertiary mb-1">Vote Cancelled</p>
                  <p className="text-body-sm text-text-secondary">
                    This vote was cancelled before completion. No final tally was recorded.
                  </p>
                </div>
              )}

              {/* Yea/Nay bars */}
              {isYeaNay && tally.finalTallies && (
                <div className="card">
                  <ResultsBars
                    yea={tally.finalTallies['yea'] || 0}
                    nay={tally.finalTallies['nay'] || 0}
                    abstain={tally.finalTallies['abstain'] || 0}
                  />
                  {/* Majority */}
                  <p className="mt-4 pt-3 border-t border-border-subtle flex items-baseline justify-between">
                    <span className="text-label-ui text-text-tertiary">Majority</span>
                    <span className="figure text-2xl text-text-primary">
                      {Math.abs((tally.finalTallies['yea'] || 0) - (tally.finalTallies['nay'] || 0))}
                    </span>
                  </p>
                </div>
              )}

              {/* Multi-round results */}
              {hasMultipleRounds && !isYeaNay && (
                <div className="card">
                  <MultiRoundBars
                    rounds={tally.rounds!}
                    candidateNames={candidateNames}
                  />
                </div>
              )}

              {/* Single-round candidate results (bar per candidate) */}
              {!isYeaNay && !hasMultipleRounds && tally.finalTallies && (
                <div className="card space-y-4">
                  {Object.entries(tally.finalTallies)
                    .sort(([, a], [, b]) => b - a)
                    .map(([candidateId, votes]) => {
                      const tallyValues = Object.values(tally.finalTallies);
                      const maxVotes = tallyValues.length > 0 ? Math.max(...tallyValues) : 0;
                      const pct = maxVotes > 0 ? (votes / maxVotes) * 100 : 0;
                      const isWinner = tally.winners?.includes(candidateId);

                      return (
                        <div key={candidateId}>
                          <div className="flex items-baseline justify-between mb-1.5">
                            <span className={`text-body-sm ${isWinner ? 'font-medium text-text-primary' : 'text-text-secondary'}`}>
                              {candidateNames[candidateId] || candidateId}
                              {isWinner && <span className="text-label-ui text-[0.6875rem] text-accent-primary ml-2">Elected</span>}
                            </span>
                            <span className="figure text-xl text-text-primary">{votes}</span>
                          </div>
                          <div className="h-2.5 bg-inset rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-400 ease-out ${
                                isWinner ? 'bg-accent-primary' : 'bg-accent-voting'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {/* Rounds navigation */}
          {rounds && rounds.length > 1 && (
            <div className="mb-6">
              <SectionHeading>All Rounds</SectionHeading>
              <div className="space-y-2">
                {rounds.map((round) => (
                  <Link
                    key={round.id}
                    to="/voting/$id"
                    params={{ id: round.id }}
                    className="card flex items-center justify-between hover:border-border transition-colors"
                  >
                    <div>
                      <span className="text-body-sm font-medium text-text-primary">
                        Round {round.roundNumber}
                      </span>
                      <Tag color={statusToTagColor(round.status)} className="ml-2">
                        {humanizeToken(round.status)}
                      </Tag>
                    </div>
                    <span className="font-mono text-xs text-text-tertiary">
                      {formatDate(round.votingOpensAt, { withYear: false })}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: Candidates & NPC confirmation */}
        <div className="space-y-8">
          {/* Candidates */}
          {candidateBased && (candidates.length > 0 || acceptsNominations) && (
            <div>
              <SectionHeading
                size="sm"
                action={isStaff && acceptsNominations ? <AddCandidateButton electionId={election.id} /> : undefined}
              >
                Candidates ({candidates.filter((c) => !c.isWithdrawn).length})
              </SectionHeading>
              {user && !myCandidacy && election.status === 'nominations_open' && (
                <StandForElection electionId={election.id} closesAt={election.nominationsCloseAt} />
              )}
              {candidates.length === 0 && (
                <p className="text-body-sm italic text-text-tertiary">No one has stood yet.</p>
              )}
              <div className="space-y-2">
                {candidates.map((candidate) => (
                  <div
                    key={candidate.id}
                    className={`card ${
                      candidate.isWithdrawn ? 'bg-page border-dashed' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Link
                        to="/players/$id"
                        params={{ id: candidate.playerId }}
                        className="text-body-sm font-medium text-text-primary hover:text-accent-primary transition-colors"
                      >
                        <span className="inline-flex items-center gap-2">
                          <PlayerAvatar player={{ id: candidate.playerId, characterName: candidate.player?.characterName, discordUsername: candidate.player?.discordUsername ?? '' }} size="sm" />
                          {candidate.player?.characterName || candidate.player?.discordUsername || 'Unknown'}
                        </span>
                      </Link>
                      {candidate.party && (
                        <Tag color="players">{candidate.party.shortName || candidate.party.name}</Tag>
                      )}
                      {candidate.isWithdrawn && (
                        <Tag color="closed">Withdrawn</Tag>
                      )}
                      {candidate.playerId === user?.id && !candidate.isWithdrawn && (
                        <Tag color="primary">You</Tag>
                      )}
                      {!candidate.isWithdrawn && canWithdraw(candidate.playerId) && (
                        <WithdrawCandidateButton
                          electionId={election.id}
                          playerId={candidate.playerId}
                          name={candidate.player?.characterName ?? 'Unknown'}
                          self={candidate.playerId === user?.id}
                        />
                      )}
                    </div>
                    {candidate.statement && <CandidateStatement text={candidate.statement} />}
                    {tally?.finalTallies && tally.finalTallies[candidate.playerId] !== undefined && (
                      <div className="mt-2 font-mono text-sm text-text-primary">
                        {tally.finalTallies[candidate.playerId]} votes
                        {tally.winners?.includes(candidate.playerId) && (
                          <span className="text-accent-primary ml-1">&bull; elected</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* NPC Confirmation */}
          {election.npcConfirmation && (
            <div>
              <SectionHeading size="sm">NPC Confirmation</SectionHeading>
              <div className="card">
                <Tag color={
                  election.npcConfirmation.status === 'confirmed' ? 'passed' :
                  election.npcConfirmation.status === 'rejected' ? 'rejected' : 'pending'
                }>
                  {election.npcConfirmation.status}
                </Tag>
                {election.npcConfirmation.tally && (
                  <ResultsBars
                    yea={election.npcConfirmation.tally.yea}
                    nay={election.npcConfirmation.tally.nay}
                    abstain={election.npcConfirmation.tally.abstain}
                    className="mt-3"
                  />
                )}
                {election.npcConfirmation.notes && (
                  <p className="text-body-sm text-text-tertiary mt-2 italic">
                    {election.npcConfirmation.notes}
                  </p>
                )}
              </div>
            </div>
          )}

          {election.relatedBillId && (
            <div>
              <SectionHeading size="sm">Related Bill</SectionHeading>
              <div className="card">
                {election.relatedBillSlug ? (
                  <Link
                    to="/bills/$slug"
                    params={{ slug: election.relatedBillSlug }}
                    className="text-body-sm text-accent-primary hover:underline"
                  >
                    View linked bill →
                  </Link>
                ) : (
                  <>
                    <p className="text-body-sm text-text-secondary">Linked bill</p>
                    <p className="font-mono text-xs text-text-tertiary mt-1 break-all">
                      {election.relatedBillId}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Staff control panel
// ============================================================

function StaffControls({ election }: { election: Election }) {
  const { id: electionId, status, type } = election;
  const openVoting = useOpenVoting();
  const closeVoting = useCloseVoting();
  const tally = useTallyVotes();
  const certify = useCertifyElection();
  const createRunoff = useCreateRunoff();

  const [confirmAction, setConfirmAction] = useState<null | 'open' | 'close' | 'tally' | 'certify' | 'runoff'>(null);
  const [npcOpen, setNpcOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: NonNullable<typeof confirmAction>) => {
    setError(null);
    try {
      if (action === 'open') await openVoting.mutateAsync(electionId);
      if (action === 'close') await closeVoting.mutateAsync(electionId);
      if (action === 'tally') await tally.mutateAsync(electionId);
      if (action === 'certify') await certify.mutateAsync(electionId);
      if (action === 'runoff') await createRunoff.mutateAsync(electionId);
      setConfirmAction(null);
    } catch (e: any) {
      setError(e?.message ?? 'Action failed.');
    }
  };

  // Mirror VoteService's guards exactly, so every offered action can succeed:
  // tally needs a closed vote; NPC confirmation is only for position and
  // appointment votes that require it; certification waits for the NPC
  // house to decide when one is required.
  const requiresNpc = !!election.config?.requiresNpcConfirmation;
  const npcDecided = !!election.npcConfirmation && election.npcConfirmation.status !== 'pending';
  const canOpen = ['draft', 'nominations_closed', 'nominations_open'].includes(status);
  const canClose = status === 'voting_open';
  const canTally = status === 'voting_closed';
  const canCertify = status === 'tallied' || (status === 'npc_pending' && (!requiresNpc || npcDecided));
  const canRunoff = status === 'runoff_needed';
  const canNpc =
    status === 'npc_pending' && requiresNpc && ['position_election', 'appointment_confirmation'].includes(type);

  // Only what can be done now; the natural next step is the primary button.
  const actions: { key: string; label: string; primary: boolean; onClick: () => void }[] = [
    canOpen && { key: 'open', label: 'Open voting', primary: true, onClick: () => setConfirmAction('open') },
    canClose && { key: 'close', label: 'Close voting', primary: false, onClick: () => setConfirmAction('close') },
    canTally && { key: 'tally', label: 'Tally votes', primary: status === 'voting_closed', onClick: () => setConfirmAction('tally') },
    canRunoff && { key: 'runoff', label: 'Create runoff', primary: true, onClick: () => setConfirmAction('runoff') },
    canNpc && { key: 'npc', label: 'Enter NPC confirmation', primary: false, onClick: () => setNpcOpen(true) },
    canCertify && { key: 'certify', label: 'Certify results', primary: true, onClick: () => setConfirmAction('certify') },
  ].filter(Boolean) as { key: string; label: string; primary: boolean; onClick: () => void }[];

  return (
    <section aria-labelledby="staff-desk-heading" className="notice notice-muted mb-8 flex flex-wrap items-center gap-x-5 gap-y-3">
      <div className="flex items-center gap-2 mr-auto">
        <Tag color="moderation">Staff</Tag>
        <h2 id="staff-desk-heading" className="text-heading-2 text-text-primary">
          {actions.length ? 'Staff desk' : 'Nothing left to do'}
        </h2>
        {!actions.length && (
          <span className="text-body-sm italic text-text-tertiary">This vote is {humanizeToken(status)}.</span>
        )}
      </div>
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <button key={a.key} onClick={a.onClick} className={`${a.primary ? 'btn-primary' : 'btn-secondary'} btn-sm`}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="basis-full text-body-sm text-status-rejected">{error}</p>}

      <ConfirmModal
        open={confirmAction === 'certify'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => run('certify')}
        title="Certify these results?"
        message="Certification is final. The result is sealed and any linked appointments will follow."
        confirmLabel="Certify"
        pending={certify.isPending}
      />
      <ConfirmModal
        open={confirmAction === 'runoff'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => run('runoff')}
        title="Create runoff round?"
        message="A new round election will be created with the qualifying candidates carried over. You can adjust dates afterwards."
        confirmLabel="Create Runoff"
        pending={createRunoff.isPending}
      />
      <ConfirmModal
        open={confirmAction === 'open'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => run('open')}
        title="Open voting?"
        message="This makes the ballot live. Players will be able to cast votes immediately."
        confirmLabel="Open"
        pending={openVoting.isPending}
      />
      <ConfirmModal
        open={confirmAction === 'close'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => run('close')}
        title="Close voting?"
        message="No further ballots can be cast once closed. You can still tally afterwards."
        confirmLabel="Close"
        pending={closeVoting.isPending}
      />
      <ConfirmModal
        open={confirmAction === 'tally'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => run('tally')}
        title="Tally votes now?"
        message="Tallying writes results to the record. For sealed results this will reveal them."
        confirmLabel="Tally"
        pending={tally.isPending}
      />

      <NpcConfirmModal
        open={npcOpen}
        onClose={() => setNpcOpen(false)}
        electionId={electionId}
      />
    </section>
  );
}

function NpcConfirmModal({
  open,
  onClose,
  electionId,
}: {
  open: boolean;
  onClose: () => void;
  electionId: string;
}) {
  const npc = useNpcConfirm();
  const [yea, setYea] = useState(0);
  const [nay, setNay] = useState(0);
  const [abstain, setAbstain] = useState(0);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (yea + nay + abstain === 0) {
      setError('Enter at least one tally.');
      return;
    }
    try {
      await npc.mutateAsync({ electionId, yea, nay, abstain, notes: notes || undefined });
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Could not submit.');
    }
  };

  const fc = 'field w-full font-mono';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="NPC Confirmation"
      railClass="bg-accent-voting"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={submit} disabled={npc.isPending} className="btn-primary disabled:opacity-50">
            {npc.isPending ? 'Submitting…' : 'Record'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-body-sm text-text-secondary">
          Record the tally from the NPC house. Yea &gt; Nay confirms; otherwise rejected.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="text-label-ui text-text-tertiary block mb-1">Yea</span>
            <input type="number" min={0} value={yea} onChange={(e) => setYea(parseInt(e.target.value) || 0)} className={fc} />
          </label>
          <label className="block">
            <span className="text-label-ui text-text-tertiary block mb-1">Nay</span>
            <input type="number" min={0} value={nay} onChange={(e) => setNay(parseInt(e.target.value) || 0)} className={fc} />
          </label>
          <label className="block">
            <span className="text-label-ui text-text-tertiary block mb-1">Abstain</span>
            <input type="number" min={0} value={abstain} onChange={(e) => setAbstain(parseInt(e.target.value) || 0)} className={fc} />
          </label>
        </div>
        <label className="block">
          <span className="text-label-ui text-text-tertiary block mb-1">Notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${fc} font-body resize-y`} />
        </label>
        {error && <p className="text-body-sm text-status-rejected">{error}</p>}
      </div>
    </Modal>
  );
}

function WithdrawCandidateButton({
  electionId,
  playerId,
  name,
  self = false,
}: {
  electionId: string;
  playerId: string;
  name: string;
  self?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const withdraw = useWithdrawCandidate();
  return (
    <>
      <button
        onClick={() => { setError(null); setOpen(true); }}
        className="text-body-sm text-status-rejected hover:underline ml-auto"
      >
        {self ? 'Withdraw my candidacy' : 'Withdraw'}
      </button>
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={async () => {
          try {
            await withdraw.mutateAsync({ electionId, playerId });
            setOpen(false);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not withdraw the candidate.');
          }
        }}
        variant="danger"
        title={self ? 'Withdraw from this contest?' : `Withdraw ${name}?`}
        message={
          <>
            {self
              ? 'You will be marked as withdrawn and taken off the ballot. You cannot stand again in this election.'
              : 'This marks the candidate as withdrawn. They will no longer appear on the ballot.'}
            {error && <span role="alert" className="block mt-2 text-status-rejected">{error}</span>}
          </>
        }
        confirmLabel="Withdraw"
        pending={withdraw.isPending}
      />
    </>
  );
}

/** A manifesto clamped to three lines, with a toggle when it runs longer. */
function CandidateStatement({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 180 || text.split('\n').length > 3;
  return (
    <div>
      <p className={`text-body-sm text-text-secondary italic whitespace-pre-line ${expanded ? '' : 'line-clamp-3'}`}>
        {text}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="text-xs text-text-tertiary hover:text-accent-primary mt-1"
        >
          {expanded ? 'Show less' : 'Read the full statement'}
        </button>
      )}
    </div>
  );
}

/** Self-nomination during the nominations window. */
function StandForElection({ electionId, closesAt }: { electionId: string; closesAt?: string }) {
  const [open, setOpen] = useState(false);
  const [statement, setStatement] = useState('');
  const [error, setError] = useState<string | null>(null);
  const register = useRegisterCandidate();
  const tooLong = statement.trim().length > CANDIDATE_STATEMENT_MAX;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (tooLong) return;
    try {
      // No playerId/partyId: the API stands you under your own current party.
      await register.mutateAsync({ electionId, statement: statement.trim() || undefined });
      setOpen(false);
      setStatement('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not register your candidacy.');
    }
  };

  return (
    <div className="card mb-3">
      <p className="text-body-sm text-text-primary font-medium">Nominations are open.</p>
      <p className="text-xs text-text-tertiary mt-0.5 mb-3">
        {closesAt ? <>Closes <Countdown to={closesAt} prefix="in" />. </> : null}
        You stand under your current party banner.
      </p>
      <button type="button" onClick={() => { setError(null); setOpen(true); }} className="btn-primary text-body-sm">
        Stand as a candidate
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Stand as a candidate"
        railClass="bg-accent-voting"
        footer={
          <>
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" form="stand-form" disabled={register.isPending || tooLong} className="btn-primary disabled:opacity-50">
              {register.isPending ? 'Registering…' : 'Register candidacy'}
            </button>
          </>
        }
      >
        <form id="stand-form" onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="flex items-baseline justify-between mb-1">
              <span className="text-label-ui text-text-tertiary">Statement (optional)</span>
              <span className={`font-mono text-xs ${tooLong ? 'text-status-rejected' : 'text-text-tertiary'}`}>
                {statement.trim().length} / {CANDIDATE_STATEMENT_MAX}
              </span>
            </span>
            <textarea
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              rows={5}
              autoFocus
              placeholder="Why should they vote for you?"
              className="field w-full font-body resize-y"
              aria-invalid={tooLong}
            />
          </label>
          {error && <p role="alert" className="text-body-sm text-status-rejected">{error}</p>}
        </form>
      </Modal>
    </div>
  );
}

function AddCandidateButton({ electionId }: { electionId: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{ id: string; characterName: string | null; discordUsername: string } | null>(null);
  const [statement, setStatement] = useState('');
  const [error, setError] = useState<string | null>(null);
  const register = useRegisterCandidate();
  const debouncedSearch = useDebouncedValue(search, 300);
  const { data: searchResults } = useSearchPlayers(debouncedSearch);

  const submit = async () => {
    setError(null);
    if (!selected) { setError('Select a player first.'); return; }
    try {
      await register.mutateAsync({
        electionId,
        playerId: selected.id,
        statement: statement.trim() || undefined,
      });
      setOpen(false);
      setSelected(null);
      setStatement('');
      setSearch('');
    } catch (e: any) {
      setError(e?.message ?? 'Could not add candidate.');
    }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="text-body-sm text-accent-primary hover:underline">
        + Add
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nominate Candidate"
        railClass="bg-accent-voting"
        footer={
          <>
            <button onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={submit} disabled={register.isPending} className="btn-primary disabled:opacity-50">
              {register.isPending ? 'Adding…' : 'Add Candidate'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {selected ? (
            <div className="flex items-center gap-2 bg-card border border-border rounded-card px-3 py-2">
              <PlayerAvatar player={selected} size="sm" />
              <span className="text-body-sm">{selected.characterName ?? selected.discordUsername}</span>
              <button onClick={() => setSelected(null)} className="ml-auto text-xs text-text-tertiary hover:text-status-rejected">change</button>
            </div>
          ) : (
            <>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search players…"
                autoFocus
                className="field w-full"
              />
              {searchResults?.data && searchResults.data.length > 0 && (
                <div className="border border-border-subtle rounded-card overflow-hidden">
                  {searchResults.data.map((p: any) => (
                    <button
                      key={p.id}
                      onClick={() => setSelected({ id: p.id, characterName: p.characterName, discordUsername: p.discordUsername })}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-hover text-left transition-colors duration-150"
                    >
                      <PlayerAvatar player={p} size="sm" />
                      <span className="text-body-sm">{p.characterName ?? p.discordUsername}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <label className="block">
            <span className="text-label-ui text-text-tertiary block mb-1">Statement (optional)</span>
            <textarea
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              rows={3}
              maxLength={CANDIDATE_STATEMENT_MAX}
              className="field w-full resize-y"
            />
          </label>
          {error && <p className="text-body-sm text-status-rejected">{error}</p>}
        </div>
      </Modal>
    </>
  );
}
