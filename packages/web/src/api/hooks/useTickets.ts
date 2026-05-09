import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

// ---- Types ----

export interface TicketCategory {
  id: string;
  name: string;
  description?: string;
  emoji?: string;
  colour?: string;
  sortOrder: number;
  isActive: boolean;
}

export interface Ticket {
  id: string;
  number: number;
  categoryId: string;
  category?: TicketCategory;
  createdById: string;
  createdBy?: { id: string; characterName: string; discordUsername: string };
  assignedToId?: string;
  assignedTo?: { id: string; characterName: string; discordUsername: string };
  title: string;
  description: string;
  formData?: Record<string, unknown>;
  status: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  tags: string[];
  parentTicketId?: string;
  linkedTicketIds: string[];
  createdAt: string;
  updatedAt: string;
  firstResponseAt?: string;
  resolvedAt?: string;
  closedAt?: string;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorId: string;
  author?: { id: string; characterName: string; discordUsername: string };
  content: string;
  isInternal: boolean;
  createdAt: string;
  editedAt?: string;
}

export interface TicketAuditEntry {
  id: string;
  ticketId: string;
  actorId: string;
  actor?: { id: string; characterName: string; discordUsername: string };
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  createdAt: string;
}

export interface TicketDetail extends Ticket {
  messages: TicketMessage[];
  auditLog: TicketAuditEntry[];
}

export interface TicketMetrics {
  openCount: number;
  avgResponseTimeMs: number;
  resolvedThisWeek: number;
  byCategory: { categoryId: string; categoryName: string; count: number }[];
  byPriority: Record<string, number>;
}

interface TicketFilters {
  status?: string;
  category?: string;
  assignee?: string;
  priority?: string;
  tags?: string[];
  search?: string;
  page?: number;
  limit?: number;
}

// ---- Hooks ----

export function useTickets(filters?: TicketFilters) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.category) params.set('categoryId', filters.category);
  if (filters?.assignee) params.set('assignedToId', filters.assignee);
  if (filters?.priority) params.set('priority', filters.priority);
  if (filters?.tags?.length) params.set('tags', filters.tags.join(','));
  if (filters?.search) params.set('search', filters.search);
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.page && filters?.limit) params.set('offset', String((filters.page - 1) * filters.limit));
  const qs = params.toString();
  return useQuery({
    queryKey: ['tickets', filters],
    queryFn: () => api.get<{ data: Ticket[]; total: number }>(`/tickets${qs ? `?${qs}` : ''}`),
  });
}

export function useTicket(id?: string) {
  return useQuery({
    queryKey: ['tickets', id],
    queryFn: () => api.get<TicketDetail>(`/tickets/${id}`),
    enabled: !!id,
  });
}

export function useTicketsByIds(ids: string[]) {
  const sorted = [...ids].sort();
  return useQuery({
    queryKey: ['tickets', 'by-ids', sorted],
    queryFn: () =>
      api.get<{ tickets: Ticket[] }>(`/tickets/by-ids?ids=${encodeURIComponent(sorted.join(','))}`),
    enabled: sorted.length > 0,
  });
}

export function useTicketCategories() {
  return useQuery({
    queryKey: ['ticket-categories'],
    queryFn: () => api.get<TicketCategory[]>('/tickets/categories'),
  });
}

export function useTicketMetrics() {
  return useQuery({
    queryKey: ['ticket-metrics'],
    queryFn: () => api.get<TicketMetrics>('/tickets/metrics'),
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { categoryId: string; title: string; description: string; priority?: string; tags?: string[]; formData?: Record<string, unknown> }) =>
      api.post<Ticket>('/tickets', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tickets'] }); },
  });
}

export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: string; priority?: string; assignedToId?: string; tags?: string[] }) =>
      api.patch<Ticket>(`/tickets/${id}`, body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['tickets', vars.id] });
    },
  });
}

export function useAddTicketMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, ...body }: { ticketId: string; content: string; isInternal?: boolean }) =>
      api.post<TicketMessage>(`/tickets/${ticketId}/messages`, body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['tickets', vars.ticketId] });
    },
  });
}

export function useAssignTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, assignedToId }: { ticketId: string; assignedToId: string }) =>
      api.post(`/tickets/${ticketId}/assign`, { assignedToId }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['tickets', vars.ticketId] });
    },
  });
}

export function useLinkTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, otherTicketId }: { ticketId: string; otherTicketId: string }) =>
      api.post(`/tickets/${ticketId}/link`, { otherTicketId }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['tickets', vars.ticketId] });
      qc.invalidateQueries({ queryKey: ['tickets', vars.otherTicketId] });
    },
  });
}

export function useUnlinkTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, otherTicketId }: { ticketId: string; otherTicketId: string }) =>
      api.delete(`/tickets/${ticketId}/link/${otherTicketId}`),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['tickets', vars.ticketId] });
      qc.invalidateQueries({ queryKey: ['tickets', vars.otherTicketId] });
    },
  });
}

export function useCloseTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, resolution }: { ticketId: string; resolution?: string }) =>
      api.post(`/tickets/${ticketId}/close`, { resolution }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['tickets', vars.ticketId] });
    },
  });
}
