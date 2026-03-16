import { useState } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { useBill, useBillVoters, useBillAmendments } from '../api/hooks/useBills';
import { useDocumentDiff } from '../api/hooks/useDocuments';
import { Tag, statusToTagColor } from '../components/shared/Tag';
import { StatusTimeline } from '../components/shared/StatusTimeline';
import { ResultsBars } from '../components/shared/ResultsBars';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { RedlineDiff, type DiffHunk } from '../components/shared/RedlineDiff';
import type { BillVoter } from '../api/hooks/useBills';

/** The canonical bill lifecycle stages */
const BILL_STAGES = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'voting', label: 'Player Vote' },
  { key: 'player_result', label: 'Player Result' },
  { key: 'npc_pending', label: 'NPC House' },
  { key: 'npc_result', label: 'NPC Result' },
  { key: 'enacted', label: 'Enacted' },
];

function getStageIndex(status: string): number {
  const map: Record<string, number> = {
    submitted: 0,
    voting: 1,
    player_passed: 2,
    player_rejected: 2,
    npc_pending: 3,
    npc_passed: 4,
    npc_rejected: 4,
    enacted: 5,
    active: 5,
    amended: 5,
    repealed: 5,
  };
  return map[status] ?? 0;
}

export function BillDetail() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { data: bill, isLoading } = useBill(slug);
  const { data: voters } = useBillVoters(slug);
  const [voteExpanded, setVoteExpanded] = useState(false);
  const [redlineOpen, setRedlineOpen] = useState(false);

  // Fetch child amendments (bills that amend this one)
  const { data: amendmentsData } = useBillAmendments(bill?.id);
  const amendments = amendmentsData?.data ?? [];

  // Fetch diff when the redline viewer is opened and this bill amends a document
  const { data: diffData } = useDocumentDiff(
    redlineOpen && bill?.amendsDocumentId ? bill.amendsDocumentId : undefined,
    redlineOpen ? 1 : undefined,
    redlineOpen ? undefined : undefined,
  );

  if (isLoading || !bill) return <PageSkeleton />;

  // Build simple diff hunks from the raw content returned by the API
  const redlineHunks: DiffHunk[] = [];
  if (diffData) {
    const fromLines = diffData.fromContent.split('\n');
    const toLines = diffData.toContent.split('\n');
    const maxLen = Math.max(fromLines.length, toLines.length);
    for (let i = 0; i < maxLen; i++) {
      const fromLine = fromLines[i];
      const toLine = toLines[i];
      if (fromLine === toLine) {
        redlineHunks.push({ type: 'unchanged', value: (fromLine ?? '') + '\n' });
      } else {
        if (fromLine !== undefined) {
          redlineHunks.push({ type: 'removed', value: fromLine + '\n' });
        }
        if (toLine !== undefined) {
          redlineHunks.push({ type: 'added', value: toLine + '\n' });
        }
      }
    }
  }

  const stageIndex = getStageIndex(bill.status);
  const timelineStages = BILL_STAGES.map((stage) => {
    let detail: string | undefined;
    if (stage.key === 'submitted') detail = new Date(bill.submittedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    if (stage.key === 'player_result' && bill.playerVoteAt) detail = bill.playerVoteResult || undefined;
    if (stage.key === 'npc_result' && bill.npcVote?.decidedAt) detail = bill.npcVote.status;
    if (stage.key === 'enacted' && bill.enactedAt) detail = new Date(bill.enactedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return { ...stage, detail };
  });

  // Compute player vote tallies
  const voteTally = voters?.reduce(
    (acc, v) => {
      if (v.choice === 'yea') acc.yea++;
      else if (v.choice === 'nay') acc.nay++;
      else acc.abstain++;
      return acc;
    },
    { yea: 0, nay: 0, abstain: 0 },
  ) ?? { yea: 0, nay: 0, abstain: 0 };

  const groupedVoters = {
    yea: voters?.filter((v) => v.choice === 'yea') ?? [],
    nay: voters?.filter((v) => v.choice === 'nay') ?? [],
    abstain: voters?.filter((v) => v.choice === 'abstain') ?? [],
  };

  return (
    <div className="p-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-body-sm text-text-tertiary mb-4">
        <Link to="/bills" className="hover:text-accent-primary transition-colors">
          Bills
        </Link>
        <span>/</span>
        <span className="font-mono">Bill #{String(bill.billNumber).padStart(3, '0')}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-6 mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <span className="font-mono text-lg text-text-tertiary">
              Bill #{String(bill.billNumber).padStart(3, '0')}
            </span>
            {bill.shortTitle && (
              <span className="font-mono text-sm text-text-tertiary">{bill.shortTitle}</span>
            )}
            <Tag color={statusToTagColor(bill.status)}>
              {bill.status.replace(/_/g, ' ')}
            </Tag>
          </div>
          <h1 className="text-display">{bill.title}</h1>
        </div>

        <a
          href={bill.googleDocUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary whitespace-nowrap flex-shrink-0"
        >
          Open in Google Docs
        </a>
      </div>

      {/* Metadata line */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-body-sm text-text-secondary mb-6">
        <div>
          <span className="text-label-ui text-text-tertiary mr-1">Author</span>
          <Link
            to="/players/$id"
            params={{ id: bill.authorId }}
            className="hover:text-accent-primary transition-colors"
          >
            {bill.author?.characterName || bill.author?.discordUsername || '—'}
          </Link>
        </div>
        {bill.coSponsors && bill.coSponsors.length > 0 && (
          <div>
            <span className="text-label-ui text-text-tertiary mr-1">Co-sponsors</span>
            {bill.coSponsors.map((cs, i) => (
              <span key={cs.id}>
                <Link
                  to="/players/$id"
                  params={{ id: cs.id }}
                  className="hover:text-accent-primary transition-colors"
                >
                  {cs.characterName}
                </Link>
                {i < bill.coSponsors!.length - 1 && ', '}
              </span>
            ))}
          </div>
        )}
        <div>
          <span className="text-label-ui text-text-tertiary mr-1">Submitted</span>
          <span className="font-mono text-xs">
            {new Date(bill.submittedAt).toLocaleDateString('en-GB', {
              day: 'numeric', month: 'short', year: 'numeric',
            })}
          </span>
        </div>
        {bill.policyAreas.length > 0 && (
          <div className="flex items-center gap-1.5">
            {bill.policyAreas.map((area) => (
              <Tag key={area} color="bills">{area}</Tag>
            ))}
          </div>
        )}
        {bill.amendsBillId && (
          <div>
            <span className="text-label-ui text-text-tertiary mr-1">Amends</span>
            <Link
              to="/bills/$slug"
              params={{ slug: bill.amendsBillId }}
              className="hover:text-accent-primary transition-colors font-mono text-xs"
            >
              Parent Bill
            </Link>
          </div>
        )}
        {bill.amendsDocumentId && (
          <div>
            <span className="text-label-ui text-text-tertiary mr-1">Amends Doc</span>
            <Link
              to="/documents"
              className="hover:text-accent-primary transition-colors font-mono text-xs"
            >
              View Document
            </Link>
          </div>
        )}
        {amendments.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-label-ui text-text-tertiary mr-1">Amended by</span>
            {amendments.map((a, i) => (
              <span key={a.id}>
                <Link
                  to="/bills/$slug"
                  params={{ slug: a.slug }}
                  className="hover:text-accent-primary transition-colors font-mono text-xs"
                >
                  Bill #{String(a.billNumber).padStart(3, '0')}
                </Link>
                {i < amendments.length - 1 && ', '}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Status Timeline (horizontal) */}
      <div className="mb-8 pb-6 border-b border-border-subtle">
        <StatusTimeline
          stages={timelineStages}
          currentIndex={stageIndex}
          horizontal
        />
      </div>

      {/* Redline diff viewer (for amendment bills) */}
      {(bill.amendsBillId || bill.amendsDocumentId) && (
        <div className="mb-8 pb-6 border-b border-border-subtle">
          <button
            onClick={() => setRedlineOpen(!redlineOpen)}
            className="btn-secondary text-body-sm"
          >
            {redlineOpen ? 'Hide Redline' : 'View Redline'}
          </button>
          {redlineOpen && (
            <div className="mt-4">
              {redlineHunks.length > 0 ? (
                <RedlineDiff
                  hunks={redlineHunks}
                  fromLabel="Original"
                  toLabel="Amended"
                />
              ) : (
                <p className="text-body-sm text-text-tertiary italic">
                  Loading diff or no changes detected...
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Two-column layout: content + sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: cached content */}
        <div className="lg:col-span-2">
          {bill.summary && (
            <div className="mb-6">
              <h2 className="text-heading-2 text-text-secondary mb-2">Summary</h2>
              <div className="card border-l-accent-bills">
                <p className="text-body text-text-primary">{bill.summary}</p>
              </div>
            </div>
          )}

          {bill.cachedContent ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-heading-2 text-text-secondary">Bill Content</h2>
                {bill.cachedAt && (
                  <span className="font-mono text-xs text-text-tertiary">
                    Cached {new Date(bill.cachedAt).toLocaleDateString('en-GB', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                )}
              </div>
              <div className="card border-l-accent-bills">
                <div className="text-body text-text-primary whitespace-pre-wrap leading-relaxed">
                  {bill.cachedContent}
                </div>
              </div>
            </div>
          ) : (
            <div className="card border-l-accent-bills">
              <p className="text-body text-text-tertiary italic">
                Bill content not yet cached. Open the Google Doc to read the full text.
              </p>
            </div>
          )}

          {/* Status History */}
          {bill.statusLog && bill.statusLog.length > 0 && (
            <div className="mt-6">
              <h2 className="text-heading-2 text-text-secondary mb-3">Status History</h2>
              <div className="space-y-1">
                {bill.statusLog.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 py-2 border-b border-border-subtle last:border-0"
                  >
                    <span className="font-mono text-xs text-text-tertiary w-28 flex-shrink-0">
                      {new Date(entry.createdAt).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short',
                      })}
                    </span>
                    {entry.fromStatus && (
                      <>
                        <Tag color={statusToTagColor(entry.fromStatus)}>
                          {entry.fromStatus.replace(/_/g, ' ')}
                        </Tag>
                        <span className="text-text-tertiary">&rarr;</span>
                      </>
                    )}
                    <Tag color={statusToTagColor(entry.toStatus)}>
                      {entry.toStatus.replace(/_/g, ' ')}
                    </Tag>
                    {entry.changedBy && (
                      <span className="text-body-sm text-text-tertiary">
                        by {entry.changedBy.characterName}
                      </span>
                    )}
                    {entry.notes && (
                      <span className="text-body-sm text-text-tertiary italic ml-auto">
                        {entry.notes}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Player House Vote */}
          <div>
            <h3 className="text-heading-2 text-text-secondary mb-3">Player House Vote</h3>
            {voters && voters.length > 0 ? (
              <div className="card border-l-accent-voting">
                <ResultsBars
                  yea={voteTally.yea}
                  nay={voteTally.nay}
                  abstain={voteTally.abstain}
                  className="mb-4"
                />

                {/* Expandable voter list */}
                <button
                  onClick={() => setVoteExpanded(!voteExpanded)}
                  className="text-body-sm text-accent-primary hover:underline font-medium"
                >
                  {voteExpanded ? 'Hide voter list' : `Show all ${voters.length} voters`}
                </button>

                {voteExpanded && (
                  <div className="mt-3 space-y-3">
                    {(['yea', 'nay', 'abstain'] as const).map((choice) => (
                      groupedVoters[choice].length > 0 && (
                        <div key={choice}>
                          <p className="text-label-ui text-text-tertiary mb-1">
                            {choice} ({groupedVoters[choice].length})
                          </p>
                          <div className="space-y-1">
                            {groupedVoters[choice].map((voter: BillVoter) => (
                              <Link
                                key={voter.playerId}
                                to="/players/$id"
                                params={{ id: voter.playerId }}
                                className="block text-body-sm text-text-secondary hover:text-accent-primary transition-colors"
                              >
                                {voter.characterName}
                              </Link>
                            ))}
                          </div>
                        </div>
                      )
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="card border-l-accent-voting">
                <p className="text-body-sm text-text-tertiary italic">No player vote recorded yet.</p>
              </div>
            )}
          </div>

          {/* NPC House Result */}
          {bill.npcVoteRequired && (
            <div>
              <h3 className="text-heading-2 text-text-secondary mb-3">NPC House</h3>
              <div className="card border-l-accent-voting">
                {bill.npcVote ? (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <Tag color={statusToTagColor(bill.npcVote.status)}>
                        {bill.npcVote.status}
                      </Tag>
                    </div>
                    {bill.npcVote.tally && (
                      <ResultsBars
                        yea={bill.npcVote.tally.yea}
                        nay={bill.npcVote.tally.nay}
                        abstain={bill.npcVote.tally.abstain}
                      />
                    )}
                    {bill.npcVote.notes && (
                      <p className="text-body-sm text-text-tertiary mt-2 italic">
                        {bill.npcVote.notes}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-body-sm text-text-tertiary italic">
                    NPC house vote pending.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Estimated Effects */}
          {bill.estimatedEffects && (
            <div>
              <h3 className="text-heading-2 text-text-secondary mb-3">Estimated Effects</h3>
              <div className="card border-l-accent-simulation space-y-3">
                {bill.estimatedEffects.economy && (
                  <div>
                    <p className="text-label-ui text-text-tertiary mb-1">Economy</p>
                    <p className="text-body-sm text-text-primary">
                      {bill.estimatedEffects.economy.description}
                    </p>
                    {bill.estimatedEffects.economy.affectedSectors && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {bill.estimatedEffects.economy.affectedSectors.map((s) => (
                          <Tag key={s} color="simulation">{s}</Tag>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {bill.estimatedEffects.popsim && (
                  <div>
                    <p className="text-label-ui text-text-tertiary mb-1">Population</p>
                    <p className="text-body-sm text-text-primary">
                      {bill.estimatedEffects.popsim.description}
                    </p>
                    {bill.estimatedEffects.popsim.affectedGroups && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {bill.estimatedEffects.popsim.affectedGroups.map((g) => (
                          <Tag key={g} color="players">{g}</Tag>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {bill.estimatedEffects.notes && (
                  <p className="text-body-sm text-text-tertiary italic">
                    {bill.estimatedEffects.notes}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Tags */}
          {bill.tags.length > 0 && (
            <div>
              <h3 className="text-heading-2 text-text-secondary mb-3">Tags</h3>
              <div className="flex flex-wrap gap-1.5">
                {bill.tags.map((tag) => (
                  <Tag key={tag} color="bills">{tag}</Tag>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
