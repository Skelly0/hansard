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
} from '../api/hooks/useTickets';
import { useAuth } from '../api/hooks/useAuth';
import { Tag, statusToTagColor } from '../components/shared/Tag';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { Modal } from '../components/shared/Modal';

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

  if (isLoading) return <PageSkeleton />;
  if (isError || !ticket) {
    return (
      <div className="p-8 max-w-4xl">
        <div className="flex items-center gap-2 text-body-sm text-text-tertiary mb-4">
          <Link to="/tickets" className="hover:text-accent-primary transition-colors">Tickets</Link>
          <span>/</span>
          <span className="font-mono">{id}</span>
        </div>
        <div className="card border-l-status-rejected">
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
    if (!newMessage.trim()) return;
    addMessage.mutate(
      { ticketId: ticket.id, content: newMessage, isInternal },
      { onSuccess: () => setNewMessage('') },
    );
  };

  const handleClose = () => {
    closeTicket.mutate({ ticketId: ticket.id });
  };

  return (
    <div className="p-8 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-body-sm text-text-tertiary mb-4">
        <Link to="/tickets" className="hover:text-accent-primary transition-colors">
          Tickets
        </Link>
        <span>/</span>
        <span className="font-mono">#{String(ticket.number).padStart(3, '0')}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <span className="font-mono text-text-tertiary text-sm">
              #{String(ticket.number).padStart(3, '0')}
            </span>
            <Tag color={statusToTagColor(ticket.status)}>
              {ticket.status.replace(/_/g, ' ')}
            </Tag>
            <Tag color={
              ticket.priority === 'urgent' ? 'rejected' :
              ticket.priority === 'high' ? 'primary' :
              'closed'
            }>
              {ticket.priority}
            </Tag>
          </div>
          <h1 className="text-display">{ticket.title}</h1>
        </div>

        <div className="flex flex-col gap-2 items-end shrink-0">
          {isStaff && ticket.status !== 'closed' && (
            <PriorityChanger ticketId={ticket.id} current={ticket.priority} />
          )}
          {ticket.status !== 'closed' && canClose && (
            <button
              onClick={handleClose}
              className="btn-secondary text-sm whitespace-nowrap"
              disabled={closeTicket.isPending}
            >
              Close Ticket
            </button>
          )}
        </div>
      </div>

      {/* Metadata */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-body-sm text-text-secondary mb-6 pb-6 border-b border-border-subtle">
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
          <span className="font-mono text-xs">
            {new Date(ticket.createdAt).toLocaleDateString('en-GB', {
              day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
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

      {/* Linked tickets */}
      <LinkedTickets ticketId={ticket.id} linkedIds={ticket.linkedTicketIds ?? []} canManage={isStaff} />

      {/* Description */}
      <div className="mb-8">
        <h2 className="text-heading-2 text-text-secondary mb-3">Description</h2>
        <div className="card border-l-accent-tickets">
          <p className="text-body text-text-primary whitespace-pre-wrap">{ticket.description}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="mb-8">
        <h2 className="text-heading-2 text-text-secondary mb-3">
          Messages ({ticket.messages.length})
        </h2>

        <div className="space-y-3">
          {ticket.messages.length === 0 ? (
            <div className="card border-l-border-subtle">
              <p className="text-body text-text-tertiary italic">No messages yet.</p>
            </div>
          ) : (
            ticket.messages.map((msg) => (
              (isStaff || !msg.isInternal) && (
                <div
                  key={msg.id}
                  className={`card ${msg.isInternal ? 'border-l-accent-moderation bg-accent-primary-light/30' : 'border-l-accent-tickets'}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-body-sm font-medium text-text-primary">
                      {msg.author?.characterName || msg.author?.discordUsername || 'Unknown'}
                    </span>
                    {msg.isInternal && (
                      <Tag color="moderation">Internal</Tag>
                    )}
                    <span className="font-mono text-xs text-text-tertiary ml-auto">
                      {new Date(msg.createdAt).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
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
            <textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type a reply..."
              rows={3}
              className="w-full bg-card border border-border-subtle rounded-card px-4 py-3 text-body font-body text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary resize-y"
            />
            <div className="flex items-center justify-between mt-2">
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
              <button
                onClick={handleSendMessage}
                disabled={!newMessage.trim() || addMessage.isPending}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {addMessage.isPending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Audit Log */}
      <div>
        <h2 className="text-heading-2 text-text-secondary mb-3">
          Audit Log ({ticket.auditLog.length})
        </h2>

        {ticket.auditLog.length === 0 ? (
          <div className="card border-l-border-subtle">
            <p className="text-body text-text-tertiary italic">No audit entries.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {ticket.auditLog.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-3 py-2 border-b border-border-subtle last:border-0"
              >
                <span className="font-mono text-xs text-text-tertiary w-36 flex-shrink-0">
                  {new Date(entry.createdAt).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
                <span className="text-body-sm text-text-secondary">
                  <span className="font-medium text-text-primary">
                    {entry.actor?.characterName || entry.actor?.discordUsername || 'System'}
                  </span>
                  {' '}{entry.action.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
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
        className="bg-card border border-border-subtle rounded-card px-2 py-1 text-body-sm focus:outline-none focus:border-accent-primary transition-colors duration-150"
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

  // Fetch a generous slice of recent tickets to enable id→ticket lookup +
  // the picker. Real-world setups may want a dedicated /by-ids endpoint.
  const { data } = useTickets({ limit: 100 });
  const allTickets = data?.data ?? [];
  const linked = allTickets.filter((t) => linkedIds.includes(t.id));

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-heading-2 text-text-secondary">
          Linked Tickets {linkedIds.length > 0 && `(${linkedIds.length})`}
        </h2>
        {canManage && (
          <button
            onClick={() => setPickerOpen(true)}
            className="text-body-sm text-accent-primary hover:underline"
          >
            + Link Ticket
          </button>
        )}
      </div>
      {linkedIds.length === 0 ? (
        <div className="card border-l-border-subtle">
          <p className="text-body-sm text-text-tertiary italic">No linked tickets.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {linked.map((t) => (
            <div key={t.id} className="card border-l-accent-tickets flex items-center gap-3">
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
            <div key={id} className="card border-l-border-subtle flex items-center gap-3">
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
          className="w-full bg-card border border-border-default rounded-card px-3 py-2 text-body-sm focus:outline-none focus:border-accent-primary transition-colors duration-150"
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
