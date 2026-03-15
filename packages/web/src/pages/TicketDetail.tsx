import { useState } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { useTicket, useAddTicketMessage, useUpdateTicket, useCloseTicket } from '../api/hooks/useTickets';
import { Tag, statusToTagColor } from '../components/shared/Tag';
import { PageSkeleton } from '../components/shared/SkeletonLoader';

export function TicketDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: ticket, isLoading } = useTicket(id);
  const addMessage = useAddTicketMessage();
  const updateTicket = useUpdateTicket();
  const closeTicket = useCloseTicket();

  const [newMessage, setNewMessage] = useState('');
  const [isInternal, setIsInternal] = useState(false);

  if (isLoading || !ticket) return <PageSkeleton />;

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

        {ticket.status !== 'closed' && (
          <button
            onClick={handleClose}
            className="btn-secondary text-sm whitespace-nowrap"
            disabled={closeTicket.isPending}
          >
            Close Ticket
          </button>
        )}
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
              <label className="flex items-center gap-2 text-body-sm text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={isInternal}
                  onChange={(e) => setIsInternal(e.target.checked)}
                  className="rounded border-border accent-accent-primary"
                />
                Internal note (staff only)
              </label>
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
