import { useState } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import {
  useBill,
  useBillVoters,
  useBillAmendments,
  useUpdateBillEffects,
  useEnterNpcVote,
} from '../api/hooks/useBills';
import { useAuth } from '../api/hooks/useAuth';
import { useDocumentDiff } from '../api/hooks/useDocuments';
import { Tag, statusToTagColor } from '../components/shared/Tag';
import { StatusTimeline } from '../components/shared/StatusTimeline';
import { ResultsBars } from '../components/shared/ResultsBars';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { RedlineDiff, type DiffHunk } from '../components/shared/RedlineDiff';
import { Modal } from '../components/shared/Modal';
import type { BillVoter, BillDetail as BillDetailType } from '../api/hooks/useBills';

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
  const { isStaff } = useAuth();
  const { data: bill, isLoading, isError } = useBill(slug);
  const { data: voters } = useBillVoters(slug);
  const [voteExpanded, setVoteExpanded] = useState(false);
  const [redlineOpen, setRedlineOpen] = useState(false);
  const [effectsOpen, setEffectsOpen] = useState(false);
  const [npcOpen, setNpcOpen] = useState(false);

  // Fetch child amendments (bills that amend this one)
  const { data: amendmentsData } = useBillAmendments(bill?.id);
  const amendments = amendmentsData?.data ?? [];

  // Fetch diff when the redline viewer is opened and this bill amends a document.
  // `to` omitted -> server returns latest version.
  const { data: diffData } = useDocumentDiff(
    redlineOpen && bill?.amendsDocumentSlug ? bill.amendsDocumentSlug : undefined,
    redlineOpen ? 1 : undefined,
    undefined,
  );

  if (isLoading) return <PageSkeleton />;
  if (isError || !bill) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2 text-body-sm text-text-tertiary mb-4">
          <Link to="/bills" className="hover:text-accent-primary transition-colors">Bills</Link>
          <span>/</span>
          <span className="font-mono">{slug}</span>
        </div>
        <div className="card border-l-status-rejected">
          <h1 className="text-heading-1 text-text-primary mb-2">Bill not found</h1>
          <p className="text-body text-text-secondary">
            We couldn&rsquo;t load this bill. It may have been removed, or the link may be wrong.
          </p>
        </div>
      </div>
    );
  }

  const redlineHunks: DiffHunk[] = diffData?.hunks ?? [];

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
                  {cs.characterName || cs.discordUsername}
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
            {bill.amendsBillSlug ? (
              <Link
                to="/bills/$slug"
                params={{ slug: bill.amendsBillSlug }}
                className="hover:text-accent-primary transition-colors font-mono text-xs"
              >
                Parent Bill
              </Link>
            ) : (
              <span className="font-mono text-xs text-text-secondary" title={bill.amendsBillId}>
                Parent Bill
              </span>
            )}
          </div>
        )}
        {bill.amendsDocumentId && (
          <div>
            <span className="text-label-ui text-text-tertiary mr-1">Amends Doc</span>
            <Link
              to="/documents"
              className="hover:text-accent-primary transition-colors font-mono text-xs"
              title={bill.amendsDocumentSlug ?? undefined}
            >
              {bill.amendsDocumentSlug ?? 'View Document'}
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
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-heading-2 text-text-secondary">NPC House</h3>
                {isStaff && (
                  <button
                    onClick={() => setNpcOpen(true)}
                    className="text-body-sm text-accent-primary hover:underline"
                  >
                    Record vote
                  </button>
                )}
              </div>
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
          {(bill.estimatedEffects || isStaff) && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-heading-2 text-text-secondary">Estimated Effects</h3>
                {isStaff && (
                  <button
                    onClick={() => setEffectsOpen(true)}
                    className="text-body-sm text-accent-primary hover:underline"
                  >
                    {bill.estimatedEffects ? 'Edit' : 'Set'}
                  </button>
                )}
              </div>
              {!bill.estimatedEffects && isStaff && (
                <div className="card border-l-accent-simulation">
                  <p className="text-body-sm text-text-tertiary italic">
                    No effects recorded yet.
                  </p>
                </div>
              )}
              {bill.estimatedEffects && (
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
              )}
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

      {isStaff && (
        <>
          <EffectsModal open={effectsOpen} onClose={() => setEffectsOpen(false)} bill={bill} />
          <NpcVoteModal open={npcOpen} onClose={() => setNpcOpen(false)} slug={bill.slug} />
        </>
      )}
    </div>
  );
}

// ============================================================
// Staff modals — amend effects + record NPC vote
// ============================================================

function EffectsModal({ open, onClose, bill }: { open: boolean; onClose: () => void; bill: BillDetailType }) {
  const update = useUpdateBillEffects();
  const e = bill.estimatedEffects ?? {};
  const [econDesc, setEconDesc] = useState(e.economy?.description ?? '');
  const [econSectors, setEconSectors] = useState((e.economy?.affectedSectors ?? []).join(', '));
  const [econGdp, setEconGdp] = useState(e.economy?.estimatedGdpImpact ?? '');
  const [popDesc, setPopDesc] = useState(e.popsim?.description ?? '');
  const [popGroups, setPopGroups] = useState((e.popsim?.affectedGroups ?? []).join(', '));
  const [popImpact, setPopImpact] = useState(e.popsim?.estimatedApprovalImpact ?? '');
  const [notes, setNotes] = useState(e.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const fc = 'w-full bg-card border border-border-default rounded-card px-3 py-2 text-body-sm focus:outline-none focus:border-accent-primary transition-colors duration-150';

  const submit = async () => {
    setError(null);
    try {
      const economy = econDesc.trim()
        ? {
            description: econDesc.trim(),
            affectedSectors: econSectors.split(',').map((s) => s.trim()).filter(Boolean),
            estimatedGdpImpact: econGdp.trim() || undefined,
          }
        : undefined;
      const popsim = popDesc.trim()
        ? {
            description: popDesc.trim(),
            affectedGroups: popGroups.split(',').map((s) => s.trim()).filter(Boolean),
            estimatedApprovalImpact: popImpact.trim() || undefined,
          }
        : undefined;
      await update.mutateAsync({ slug: bill.slug, economy, popsim, notes: notes.trim() || undefined });
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Save failed.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Estimated Effects"
      railClass="bg-accent-simulation"
      maxWidth="max-w-xl"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={submit} disabled={update.isPending} className="btn-primary disabled:opacity-50">
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-label-ui text-text-tertiary">Economy</legend>
          <textarea value={econDesc} onChange={(ev) => setEconDesc(ev.target.value)} rows={2} placeholder="Description" className={`${fc} resize-y`} />
          <input value={econSectors} onChange={(ev) => setEconSectors(ev.target.value)} placeholder="Affected sectors (comma-separated)" className={fc} />
          <input value={econGdp} onChange={(ev) => setEconGdp(ev.target.value)} placeholder="Estimated GDP impact" className={fc} />
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-label-ui text-text-tertiary">Population</legend>
          <textarea value={popDesc} onChange={(ev) => setPopDesc(ev.target.value)} rows={2} placeholder="Description" className={`${fc} resize-y`} />
          <input value={popGroups} onChange={(ev) => setPopGroups(ev.target.value)} placeholder="Affected groups (comma-separated)" className={fc} />
          <input value={popImpact} onChange={(ev) => setPopImpact(ev.target.value)} placeholder="Estimated approval impact" className={fc} />
        </fieldset>
        <label className="block">
          <span className="text-label-ui text-text-tertiary block mb-1">Notes</span>
          <textarea value={notes} onChange={(ev) => setNotes(ev.target.value)} rows={2} className={`${fc} resize-y`} />
        </label>
        {error && <p className="text-body-sm text-status-rejected">{error}</p>}
      </div>
    </Modal>
  );
}

function NpcVoteModal({ open, onClose, slug }: { open: boolean; onClose: () => void; slug: string }) {
  const enter = useEnterNpcVote();
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
      await enter.mutateAsync({ slug, yea, nay, abstain, notes: notes || undefined });
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Could not submit.');
    }
  };

  const fc = 'w-full bg-card border border-border-default rounded-card px-3 py-2 font-mono text-sm focus:outline-none focus:border-accent-primary transition-colors duration-150';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record NPC House Vote"
      railClass="bg-accent-voting"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={submit} disabled={enter.isPending} className="btn-primary disabled:opacity-50">
            {enter.isPending ? 'Saving…' : 'Record'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-body-sm text-text-secondary">
          Tally entered by staff for the NPC bloc. Yea &gt; Nay passes; otherwise rejected.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <label>
            <span className="text-label-ui text-text-tertiary block mb-1">Yea</span>
            <input type="number" min={0} value={yea} onChange={(ev) => setYea(parseInt(ev.target.value) || 0)} className={fc} />
          </label>
          <label>
            <span className="text-label-ui text-text-tertiary block mb-1">Nay</span>
            <input type="number" min={0} value={nay} onChange={(ev) => setNay(parseInt(ev.target.value) || 0)} className={fc} />
          </label>
          <label>
            <span className="text-label-ui text-text-tertiary block mb-1">Abstain</span>
            <input type="number" min={0} value={abstain} onChange={(ev) => setAbstain(parseInt(ev.target.value) || 0)} className={fc} />
          </label>
        </div>
        <label className="block">
          <span className="text-label-ui text-text-tertiary block mb-1">Notes</span>
          <textarea value={notes} onChange={(ev) => setNotes(ev.target.value)} rows={2} className={`${fc} font-body resize-y`} />
        </label>
        {error && <p className="text-body-sm text-status-rejected">{error}</p>}
      </div>
    </Modal>
  );
}
