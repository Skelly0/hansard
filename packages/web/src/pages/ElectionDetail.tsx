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
} from '../api/hooks/useVoting';
import { useAuth } from '../api/hooks/useAuth';
import { useSearchPlayers } from '../api/hooks/usePlayers';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { Tag, statusToTagColor } from '../components/shared/Tag';
import { StatusTimeline } from '../components/shared/StatusTimeline';
import { ResultsBars, MultiRoundBars } from '../components/shared/ResultsBars';
import { MetricCard } from '../components/shared/MetricCard';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { Modal, ConfirmModal } from '../components/shared/Modal';
import { PlayerAvatar } from '../components/shared/PlayerAvatar';

const ELECTION_STAGES = [
  { key: 'draft', label: 'Draft' },
  { key: 'nominations', label: 'Nominations' },
  { key: 'voting', label: 'Voting' },
  { key: 'tallied', label: 'Tallied' },
  { key: 'certified', label: 'Certified' },
];

function getElectionStageIndex(status: string): number {
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
  return map[status] ?? 0;
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
  const { isStaff } = useAuth();
  const { data: election, isLoading, isError } = useElection(id);
  const { data: results } = useElectionResults(id);
  const { data: rounds } = useElectionRounds(id);
  const { data: turnout } = useElectionTurnout(id);

  if (isLoading) return <PageSkeleton />;
  if (isError || !election) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2 text-body-sm text-text-tertiary mb-4">
          <Link to="/voting" className="hover:text-accent-primary transition-colors">Voting</Link>
          <span>/</span>
          <span className="font-mono">{id}</span>
        </div>
        <div className="card border-l-status-rejected">
          <h1 className="text-heading-1 text-text-primary mb-2">Election not found</h1>
          <p className="text-body text-text-secondary">
            We couldn&rsquo;t load this election. It may have been removed, or the link may be wrong.
          </p>
        </div>
      </div>
    );
  }

  const stageIndex = getElectionStageIndex(election.status);
  const isYeaNay = election.method === 'yea_nay_abstain';
  const hasMultipleRounds = results?.rounds && results.rounds.length > 1;

  // Build candidate name map
  const candidateNames: Record<string, string> = {};
  election.candidates?.forEach((c) => {
    candidateNames[c.playerId] = c.player?.characterName || 'Unknown';
  });

  return (
    <div className="p-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-body-sm text-text-tertiary mb-4">
        <Link to="/voting" className="hover:text-accent-primary transition-colors">
          Voting
        </Link>
        <span>/</span>
        <span>{election.title}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Tag color="voting">{typeLabel[election.type] || election.type}</Tag>
            <Tag color={statusToTagColor(election.status)}>
              {election.status.replace(/_/g, ' ')}
            </Tag>
            {election.roundNumber > 1 && (
              <Tag color="pending">Round {election.roundNumber}</Tag>
            )}
          </div>
          <h1 className="text-display">{election.title}</h1>
          {election.description && (
            <p className="text-body text-text-secondary mt-2">{election.description}</p>
          )}
        </div>
      </div>

      {/* Metadata */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-body-sm text-text-secondary mb-6">
        <div>
          <span className="text-label-ui text-text-tertiary mr-1">Method</span>
          <span className="font-mono text-xs">{methodLabel[election.method] || election.method}</span>
        </div>
        {election.forOffice && (
          <div>
            <span className="text-label-ui text-text-tertiary mr-1">For Office</span>
            <span>{election.forOffice.name}</span>
          </div>
        )}
        <div>
          <span className="text-label-ui text-text-tertiary mr-1">Opens</span>
          <span className="font-mono text-xs">
            {new Date(election.votingOpensAt).toLocaleDateString('en-GB', {
              day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </span>
        </div>
        <div>
          <span className="text-label-ui text-text-tertiary mr-1">Closes</span>
          <span className="font-mono text-xs">
            {new Date(election.votingClosesAt).toLocaleDateString('en-GB', {
              day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </span>
        </div>
        <div>
          <span className="text-label-ui text-text-tertiary mr-1">Created by</span>
          {election.createdBy ? (
            <Link
              to="/players/$id"
              params={{ id: election.createdById }}
              className="hover:text-accent-primary transition-colors"
            >
              {election.createdBy.characterName}
            </Link>
          ) : <span>—</span>}
        </div>
      </div>

      {/* Timeline */}
      <div className="mb-8 pb-6 border-b border-border-subtle">
        <StatusTimeline
          stages={ELECTION_STAGES}
          currentIndex={stageIndex}
          horizontal
        />
      </div>

      {/* Staff controls */}
      {isStaff && <StaffControls electionId={election.id} status={election.status} method={election.method} />}

      {/* Metrics row */}
      {turnout && (
        <div className="grid grid-cols-3 gap-4 mb-8">
          <MetricCard
            label="Eligible Voters"
            value={turnout.eligible}
            color="text-accent-voting"
            borderColor="border-l-accent-voting"
          />
          <MetricCard
            label="Votes Cast"
            value={turnout.voted}
            color="text-accent-voting"
            borderColor="border-l-accent-voting"
          />
          <MetricCard
            label="Turnout"
            value={`${Math.round(turnout.turnoutPct)}%`}
            color="text-accent-voting"
            borderColor="border-l-accent-voting"
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Results area */}
        <div className="lg:col-span-2">
          {/* Results visualization */}
          {results && (
            <div className="mb-6">
              <h2 className="text-heading-1 mb-4">Results</h2>

              {/* Winner announcement */}
              {results.winners && results.winners.length > 0 && (
                <div className="card border-l-accent-primary mb-4">
                  <p className="text-label-ui text-text-tertiary mb-1">
                    {results.winners.length > 1 ? 'Winners' : 'Winner'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {results.winners.map((winnerId) => (
                      <span key={winnerId} className="text-display text-accent-primary">
                        {isYeaNay
                          ? winnerId.charAt(0).toUpperCase() + winnerId.slice(1)
                          : candidateNames[winnerId] || winnerId}
                      </span>
                    ))}
                  </div>
                  {results.passed !== undefined && (
                    <Tag color={results.passed ? 'passed' : 'rejected'} className="mt-2">
                      {results.passed ? 'Motion Passed' : 'Motion Failed'}
                    </Tag>
                  )}
                </div>
              )}

              {/* Yea/Nay bars */}
              {isYeaNay && results.finalTallies && (
                <div className="card border-l-accent-voting">
                  <ResultsBars
                    yea={results.finalTallies['yea'] || 0}
                    nay={results.finalTallies['nay'] || 0}
                    abstain={results.finalTallies['abstain'] || 0}
                  />
                  {/* Margin */}
                  <div className="mt-3 text-center">
                    <span className="font-mono text-lg text-text-primary">
                      Margin: {Math.abs((results.finalTallies['yea'] || 0) - (results.finalTallies['nay'] || 0))}
                    </span>
                  </div>
                </div>
              )}

              {/* Multi-round results */}
              {hasMultipleRounds && !isYeaNay && (
                <div className="card border-l-accent-voting">
                  <MultiRoundBars
                    rounds={results.rounds!}
                    candidateNames={candidateNames}
                  />
                </div>
              )}

              {/* Single-round candidate results (bar per candidate) */}
              {!isYeaNay && !hasMultipleRounds && results.finalTallies && (
                <div className="card border-l-accent-voting space-y-3">
                  {Object.entries(results.finalTallies)
                    .sort(([, a], [, b]) => b - a)
                    .map(([candidateId, votes]) => {
                      const maxVotes = Math.max(...Object.values(results.finalTallies));
                      const pct = maxVotes > 0 ? (votes / maxVotes) * 100 : 0;
                      const isWinner = results.winners?.includes(candidateId);

                      return (
                        <div key={candidateId}>
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-body-sm ${isWinner ? 'font-medium text-text-primary' : 'text-text-secondary'}`}>
                              {candidateNames[candidateId] || candidateId}
                              {isWinner && <span className="text-accent-primary ml-1">&bull;</span>}
                            </span>
                            <span className="font-mono text-sm text-text-primary">{votes}</span>
                          </div>
                          <div className="h-5 bg-inset rounded overflow-hidden">
                            <div
                              className={`h-full rounded transition-all duration-400 ease-out ${
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
              <h2 className="text-heading-2 text-text-secondary mb-3">All Rounds</h2>
              <div className="space-y-2">
                {rounds.map((round) => (
                  <Link
                    key={round.id}
                    to="/voting/$id"
                    params={{ id: round.id }}
                    className="card border-l-accent-voting flex items-center justify-between hover:border-border transition-colors"
                  >
                    <div>
                      <span className="text-body-sm font-medium text-text-primary">
                        Round {round.roundNumber}
                      </span>
                      <Tag color={statusToTagColor(round.status)} className="ml-2">
                        {round.status.replace(/_/g, ' ')}
                      </Tag>
                    </div>
                    <span className="font-mono text-xs text-text-tertiary">
                      {new Date(round.votingOpensAt).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short',
                      })}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: Candidates & NPC confirmation */}
        <div className="space-y-6">
          {/* Candidates */}
          {election.candidates && election.candidates.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-heading-2 text-text-secondary">
                  Candidates ({election.candidates.length})
                </h3>
                {isStaff && (
                  <AddCandidateButton electionId={election.id} />
                )}
              </div>
              <div className="space-y-2">
                {election.candidates.map((candidate) => (
                  <div
                    key={candidate.id}
                    className={`card border-l-accent-players ${
                      candidate.isWithdrawn ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Link
                        to="/players/$id"
                        params={{ id: candidate.playerId }}
                        className="text-body-sm font-medium text-text-primary hover:text-accent-primary transition-colors"
                      >
                        {candidate.player?.characterName || 'Unknown'}
                      </Link>
                      {candidate.party && (
                        <Tag color="players">{candidate.party.shortName || candidate.party.name}</Tag>
                      )}
                      {candidate.isWithdrawn && (
                        <Tag color="closed">Withdrawn</Tag>
                      )}
                      {isStaff && !candidate.isWithdrawn && (
                        <WithdrawCandidateButton
                          electionId={election.id}
                          playerId={candidate.playerId}
                          name={candidate.player?.characterName ?? 'Unknown'}
                        />
                      )}
                    </div>
                    {candidate.statement && (
                      <p className="text-body-sm text-text-secondary line-clamp-3 italic">
                        {candidate.statement}
                      </p>
                    )}
                    {results?.finalTallies && results.finalTallies[candidate.playerId] !== undefined && (
                      <div className="mt-2 font-mono text-sm text-text-primary">
                        {results.finalTallies[candidate.playerId]} votes
                        {results.winners?.includes(candidate.playerId) && (
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
              <h3 className="text-heading-2 text-text-secondary mb-3">NPC Confirmation</h3>
              <div className="card border-l-accent-voting">
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

          {/* Related bill — relatedBillId is a UUID, not a slug; until the API
              returns a slug we can't link reliably, so show the id as text. */}
          {election.relatedBillId && (
            <div>
              <h3 className="text-heading-2 text-text-secondary mb-3">Related Bill</h3>
              <div className="card border-l-accent-bills">
                <p className="text-body-sm text-text-secondary">Linked bill</p>
                <p className="font-mono text-xs text-text-tertiary mt-1 break-all">
                  {election.relatedBillId}
                </p>
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

function StaffControls({
  electionId,
  status,
  method,
}: {
  electionId: string;
  status: string;
  method: string;
}) {
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

  const canOpen = ['draft', 'nominations_closed', 'nominations_open'].includes(status);
  const canClose = status === 'voting_open';
  const canTally = ['voting_open', 'voting_closed'].includes(status);
  const canCertify = ['tallied', 'npc_pending'].includes(status);
  const canRunoff = status === 'runoff_needed';
  const canNpc = ['tallied', 'npc_pending'].includes(status);
  const isYeaNay = method === 'yea_nay_abstain';

  return (
    <div className="card border-l-accent-voting mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-heading-2 text-text-secondary">Staff Controls</h2>
        <Tag color="moderation">staff</Tag>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setConfirmAction('open')} disabled={!canOpen} className="btn-secondary text-sm disabled:opacity-40">
          Open Voting
        </button>
        <button onClick={() => setConfirmAction('close')} disabled={!canClose} className="btn-secondary text-sm disabled:opacity-40">
          Close Voting
        </button>
        <button onClick={() => setConfirmAction('tally')} disabled={!canTally} className="btn-secondary text-sm disabled:opacity-40">
          Tally Votes
        </button>
        <button onClick={() => setConfirmAction('runoff')} disabled={!canRunoff} className="btn-secondary text-sm disabled:opacity-40">
          Create Runoff
        </button>
        <button onClick={() => setNpcOpen(true)} disabled={!canNpc} className="btn-secondary text-sm disabled:opacity-40">
          Enter NPC Confirmation
        </button>
        <button onClick={() => setConfirmAction('certify')} disabled={!canCertify} className="btn-primary text-sm disabled:opacity-40">
          Certify Results
        </button>
      </div>
      {error && <p className="text-body-sm text-status-rejected mt-3">{error}</p>}

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
    </div>
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

  const fc = 'w-full bg-card border border-border-default rounded-card px-3 py-2 font-mono text-sm focus:outline-none focus:border-accent-primary transition-colors duration-150';

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
}: {
  electionId: string;
  playerId: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const withdraw = useWithdrawCandidate();
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-body-sm text-status-rejected hover:underline ml-auto"
      >
        Withdraw
      </button>
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={async () => {
          await withdraw.mutateAsync({ electionId, playerId });
          setOpen(false);
        }}
        variant="danger"
        title={`Withdraw ${name}?`}
        message="This marks the candidate as withdrawn. They will no longer appear on the ballot."
        confirmLabel="Withdraw"
        pending={withdraw.isPending}
      />
    </>
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
            <div className="flex items-center gap-2 bg-card border border-border-default rounded-card px-3 py-2">
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
                className="w-full bg-card border border-border-default rounded-card px-3 py-2 text-body-sm focus:outline-none focus:border-accent-primary"
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
              className="w-full bg-card border border-border-default rounded-card px-3 py-2 text-body-sm focus:outline-none focus:border-accent-primary resize-y"
            />
          </label>
          {error && <p className="text-body-sm text-status-rejected">{error}</p>}
        </div>
      </Modal>
    </>
  );
}
