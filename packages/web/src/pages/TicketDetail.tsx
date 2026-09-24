import { useState } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import {
  useTicket,
  useAddTicketMessage,
  useUpdateTicket,
  useCloseTicket,
  useLinkTicket,
  useUnlinkTicket,
  useTickets,
  useTicketsByIds,
} from '../api/hooks/useTickets';
import { useAuth } from '../api/hooks/useAuth';
import { Tag, statusToTagColor } from '../components/shared/Tag';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { Modal, ConfirmModal } from '../components/shared/Modal';
import { PageHeader, Breadcrumbs, SectionHeading } from '../components/shared/PageHeader';
import { PlayerAvatar } from '../components/shared/PlayerAvatar';
import { formatDateTime, humanizeToken, recordNumber, relativeTime } from '../lib/format';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
type Priority = (typeof PRIORITIES)[number];

export function TicketDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { user, isStaff } = useAuth();
  const { data: ticket, isLoading, isError } = useTicket(id);
  const addMessage = useAddTicketMessage();
  const updateTicket = useUpdateTicket();
  const closeTicket = useCloseTicket();

  const [newMessage, setNewMessage] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  if (isLoading) return <PageSkeleton />;
  if (isError || !ticket) {
    return (
      <div className="page max-w-4xl">
        <Breadcrumbs items={[{ label: 'Tickets', to: '/tickets' }, { label: 'Not found' }]} />
        <div className="notice notice-danger">
          <h1 className="text-heading-1 text-text-primary mb-2">Ticket not found</h1>
          <p className="text-body text-text-secondary">
            We couldn&rsquo;t load this ticket. It may have been removed, closed to you, or the link may be wrong.
          </p>
        </div>
      </div>
    );
  }

  const isCreator = ticket.createdById === user?.id;
  const canClose = isStaff || isCreator;

  const handleSendMessage = () => {
    if (!newMessage.trim() || addMessage.isPending) return;
    setSendError(null);
    addMessage.mutate(
      { ticketId: ticket.id, content: newMessage, isInternal },
      {
        onSuccess: () => setNewMessage(''),
        onError: (err: any) => setSendError(err?.message ?? 'Your reply could not be sent.'),
      },
    );
  };

  const handleClose = () => {
    closeTicket.mutate({ ticketId: ticket.id }, { onSettled: () => setConfirmClose(false) });
  };

  return (
    <div className="page max-w-4xl">
      <PageHeader
        breadcrumbs={[{ label: 'Tickets', to: '/tickets' }, { label: recordNumber(ticket.number) }]}
        documentTitle={`${recordNumber(ticket.number)} ${ticket.title}`}
        eyebrow={
          <>
            <span className="font-mono text-text-tertiary text-sm">{recordNumber(ticket.number)}</span>
            <Tag color={statusToTagColor(ticket.status)}>{humanizeToken(ticket.status)}</Tag>
            <Tag color={
              ticket.priority === 'urgent' ? 'rejected' :
              ticket.priority === 'high' ? 'primary' :
              'closed'
            }>
              {ticket.priority}
            </Tag>
          </>
        }
        title={ticket.title}
        rule={false}
        className="mb-4"
        actions={
          <>
            {isStaff && ticket.status !== 'closed' && (
              <PriorityChanger ticketId={ticket.id} current={ticket.priority} />
            )}
            {ticket.status !== 'closed' && canClose && (
              <button
                onClick={() => setConfirmClose(true)}
                className="btn-secondary whitespace-nowrap"
                disabled={closeTicket.isPending}
              >
                Close ticket
              </button>
            )}
          </>
        }
      />

      <ConfirmModal
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={handleClose}
        pending={closeTicket.isPending}
        title={`Close ticket ${recordNumber(ticket.number)}?`}
        message="Closing marks the matter resolved. It can be reopened later from Discord with /ticket reopen."
        confirmLabel="Close ticket"
      />

      {/* Metadata */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-body-sm text-text-secondary mb-5">
        <div>
          <span className="text-label-ui text-text-tertiary mr-2">Created by</span>
          {ticket.createdBy ? (
            <Link
              to="/players/$id"
              params={{ id: ticket.createdById }}
              className="hover:text-accent-primary transition-colors"
            >
              {ticket.createdBy.characterName || ticket.createdBy.discordUsername}
            </Link>
          ) : (
            <span>Unknown</span>
          )}
        </div>
        <div>
          <span className="text-label-ui text-text-tertiary mr-2">Assigned to</span>
          {ticket.assignedTo ? (
            <span>{ticket.assignedTo.characterName || ticket.assignedTo.discordUsername}</span>
          ) : (
            <span className="italic text-text-tertiary">Unassigned</span>
          )}
        </div>
        <div>
          <span className="text-label-ui text-text-tertiary mr-2">Category</span>
          <span>{ticket.category?.emoji} {ticket.category?.name || '—'}</span>
        </div>
        <div>
          <span className="text-label-ui text-text-tertiary mr-2">Created</span>
          <span className="font-mono text-xs" title={formatDateTime(ticket.createdAt)}>
            {formatDateTime(ticket.createdAt)}
          </span>
        </div>
        {ticket.tags.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-label-ui text-text-tertiary mr-1">Tags</span>
            {ticket.tags.map((tag) => (
              <Tag key={tag} color="tickets">{tag}</Tag>
            ))}
          </div>
        )}
      </div>

      <div className="rule-masthead mb-8" aria-hidden="true" />

      {/* Linked tickets */}
      <LinkedTickets ticketId={ticket.id} linkedIds={ticket.linkedTicketIds ?? []} canManage={isStaff} />

      {/* Description */}
      <div className="mb-8">
        <SectionHeading>Description</SectionHeading>
        <div className="card">
          <p className="text-body text-text-primary whitespace-pre-wrap">{ticket.description}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="mb-8">
        <SectionHeading>Messages ({ticket.messages.length})</SectionHeading>

        <div className="space-y-3">
          {ticket.messages.length === 0 ? (
            <div className="card">
              <p className="text-body text-text-tertiary italic">No messages yet.</p>
            </div>
          ) : (
            ticket.messages.map((msg) => (
              (isStaff || !msg.isInternal) && (
                <div
                  key={msg.id}
                  className={`card ${msg.isInternal ? 'border-dashed border-accent-moderation/50 bg-accent-moderation/[0.04] shadow-none' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <PlayerAvatar
                      player={{ id: msg.authorId, characterName: msg.author?.characterName, discordUsername: msg.author?.discordUsername ?? '?' }}
                      size="sm"
                    />
                    <span className="text-body-sm font-medium text-text-primary">
                      {msg.author?.characterName || msg.author?.discordUsername || 'Unknown'}
                    </span>
                    {msg.isInternal && (
                      <Tag color="moderation">Internal</Tag>
                    )}
                    <time
                      dateTime={msg.createdAt}
                      title={formatDateTime(msg.createdAt)}
                      className="font-mono text-xs text-text-tertiary ml-auto"
                    >
                      {relativeTime(msg.createdAt)}
                    </time>
                  </div>
                  <p className="text-body text-text-primary whitespace-pre-wrap">{msg.content}</p>
                </div>
              )
            ))
          )}
        </div>

        {/* New message form */}
        {ticket.status !== 'closed' && (
          <div className="mt-4">
            <label htmlFor="ticket-reply" className="sr-only">Reply</label>
            <textarea
              id="ticket-reply"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder={isInternal ? 'Internal note — only staff will see this…' : 'Type a reply…'}
              rows={3}
              className={`field w-full px-4 py-3 text-body resize-y ${isInternal ? 'border-accent-moderation bg-accent-moderation/5' : ''}`}
            />
            {sendError && <p role="alert" className="text-body-sm text-status-rejected mt-2">{sendError}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
              {isStaff ? (
                <label className="flex items-center gap-2 text-body-sm text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isInternal}
                    onChange={(e) => setIsInternal(e.target.checked)}
                    className="rounded border-border accent-accent-primary"
                  />
                  Internal note (staff only)
                </label>
              ) : <span />}
              <div className="flex items-center gap-3">
                <span className="hidden sm:inline text-xs text-text-tertiary">Ctrl + Enter to send</span>
                <button
                  onClick={handleSendMessage}
                  disabled={!newMessage.trim() || addMessage.isPending}
                  className="btn-primary"
                >
                  {addMessage.isPending ? 'Sending…' : isInternal ? 'Add note' : 'Send reply'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Audit Log — staff only; the API never returns audit rows to players. */}
      {isStaff && <div>
        <SectionHeading>Audit Log ({ticket.auditLog.length})</SectionHeading>

        {ticket.auditLog.length === 0 ? (
          <div className="card">
            <p className="text-body text-text-tertiary italic">No audit entries.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {ticket.auditLog.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-3 py-2 border-b border-border-subtle last:border-0"
              >
                <span className="font-mono text-xs text-text-tertiary w-40 flex-shrink-0">
                  {formatDateTime(entry.createdAt)}
                </span>
                <span className="text-body-sm text-text-secondary">
                  <span className="font-medium text-text-primary">
                    {entry.actor?.characterName || entry.actor?.discordUsername || 'System'}
                  </span>
                  {' '}{humanizeToken(entry.action)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>}
    </div>
  );
}

// ============================================================
// Priority changer (staff)
// ============================================================

function PriorityChanger({ ticketId, current }: { ticketId: string; current: Priority }) {
  const update = useUpdateTicket();
  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as Priority;
    if (next === current) return;
    update.mutate({ id: ticketId, priority: next });
  };
  return (
    <label className="flex items-center gap-2 text-body-sm text-text-secondary">
      <span className="text-label-ui text-text-tertiary">Priority</span>
      <select
        value={current}
        onChange={onChange}
        disabled={update.isPending}
        className="field px-2 py-1"
      >
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
    </label>
  );
}

// ============================================================
// Linked tickets section
// ============================================================

function LinkedTickets({
  ticketId,
  linkedIds,
  canManage,
}: {
  ticketId: string;
  linkedIds: string[];
  canManage: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const link = useLinkTicket();
  const unlink = useUnlinkTicket();

  const { data } = useTicketsByIds(linkedIds);
  const linked = data?.tickets ?? [];

  return (
    <div className="mb-8">
      <SectionHeading
        action={canManage ? (
          <button onClick={() => setPickerOpen(true)} className="link text-body-sm">
            + Link ticket
          </button>
        ) : undefined}
      >
        Linked Tickets {linkedIds.length > 0 && `(${linkedIds.length})`}
      </SectionHeading>
      {linkedIds.length === 0 ? (
        <div className="card">
          <p className="text-body-sm text-text-tertiary italic">No linked tickets.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {linked.map((t) => (
            <div key={t.id} className="card flex items-center gap-3">
              <Link
                to="/tickets/$id"
                params={{ id: t.id }}
                className="font-mono text-sm text-accent-primary hover:underline"
              >
                #{String(t.number).padStart(3, '0')}
              </Link>
              <Link
                to="/tickets/$id"
                params={{ id: t.id }}
                className="text-body-sm text-text-primary hover:text-accent-primary transition-colors duration-150 flex-1 truncate"
              >
                {t.title}
              </Link>
              <Tag color={statusToTagColor(t.status)}>{t.status.replace(/_/g, ' ')}</Tag>
              {canManage && (
                <button
                  onClick={() => unlink.mutate({ ticketId, otherTicketId: t.id })}
                  className="text-body-sm text-status-rejected hover:underline"
                  disabled={unlink.isPending}
                >
                  Unlink
                </button>
              )}
            </div>
          ))}
          {/* Show stale ids that we couldn't resolve from the recent slice */}
          {linkedIds.filter((id) => !linked.find((t) => t.id === id)).map((id) => (
            <div key={id} className="card flex items-center gap-3">
              <Link to="/tickets/$id" params={{ id }} className="text-body-sm text-accent-primary hover:underline">
                View ticket →
              </Link>
              {canManage && (
                <button
                  onClick={() => unlink.mutate({ ticketId, otherTicketId: id })}
                  className="ml-auto text-body-sm text-status-rejected hover:underline"
                >
                  Unlink
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <LinkPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        currentTicketId={ticketId}
        existingLinks={linkedIds}
        onPick={async (otherId) => {
          await link.mutateAsync({ ticketId, otherTicketId: otherId });
          setPickerOpen(false);
        }}
        pending={link.isPending}
      />
    </div>
  );
}

function LinkPicker({
  open,
  onClose,
  currentTicketId,
  existingLinks,
  onPick,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  currentTicketId: string;
  existingLinks: string[];
  onPick: (id: string) => void | Promise<void>;
  pending: boolean;
}) {
  const [query, setQuery] = useState('');
  const { data } = useTickets({ search: query || undefined, limit: 25 });
  const candidates = (data?.data ?? []).filter(
    (t) => t.id !== currentTicketId && !existingLinks.includes(t.id),
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Link a Ticket"
      railClass="bg-accent-tickets"
      maxWidth="max-w-lg"
    >
      <div className="space-y-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tickets…"
          autoFocus
          className="field w-full"
        />
        <div className="max-h-72 overflow-y-auto border border-border-subtle rounded-card divide-y divide-border-subtle">
          {candidates.length === 0 ? (
            <div className="px-3 py-4 text-body-sm text-text-tertiary italic">
              No tickets match.
            </div>
          ) : (
            candidates.map((t) => (
              <button
                key={t.id}
                onClick={() => onPick(t.id)}
                disabled={pending}
                className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-hover transition-colors duration-150 disabled:opacity-50"
              >
                <span className="font-mono text-xs text-text-tertiary">#{String(t.number).padStart(3, '0')}</span>
                <span className="text-body-sm text-text-primary truncate flex-1">{t.title}</span>
                <Tag color={statusToTagColor(t.status)}>{t.status.replace(/_/g, ' ')}</Tag>
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
