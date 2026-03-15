import { useParams, Link } from '@tanstack/react-router';
import { useElection, useElectionResults, useElectionRounds, useElectionTurnout } from '../api/hooks/useVoting';
import { Tag, statusToTagColor } from '../components/shared/Tag';
import { StatusTimeline } from '../components/shared/StatusTimeline';
import { ResultsBars, MultiRoundBars } from '../components/shared/ResultsBars';
import { MetricCard } from '../components/shared/MetricCard';
import { PageSkeleton } from '../components/shared/SkeletonLoader';

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
  const { data: election, isLoading } = useElection(id);
  const { data: results } = useElectionResults(id);
  const { data: rounds } = useElectionRounds(id);
  const { data: turnout } = useElectionTurnout(id);

  if (isLoading || !election) return <PageSkeleton />;

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
              <h3 className="text-heading-2 text-text-secondary mb-3">
                Candidates ({election.candidates.length})
              </h3>
              <div className="space-y-2">
                {election.candidates.map((candidate) => (
                  <div
                    key={candidate.id}
                    className={`card border-l-accent-players ${
                      candidate.isWithdrawn ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
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

          {/* Related bill */}
          {election.relatedBillId && (
            <div>
              <h3 className="text-heading-2 text-text-secondary mb-3">Related Bill</h3>
              <Link
                to="/bills/$slug"
                params={{ slug: election.relatedBillId }}
                className="card border-l-accent-bills block hover:border-border transition-colors"
              >
                <span className="text-body-sm text-accent-primary hover:underline">
                  View related bill &rarr;
                </span>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
