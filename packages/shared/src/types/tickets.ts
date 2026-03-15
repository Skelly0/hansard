import type { TicketStatus, TicketPriority } from '../constants/statuses.js';

// ============================================================
// Form Template (JSONB on ticket_categories table)
// ============================================================

export interface FormField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'date';
  required: boolean;
  options?: string[];
  placeholder?: string;
}

export interface FormTemplate {
  fields: FormField[];
}

// ============================================================
// Custom Pipeline (JSONB on ticket_categories table)
// ============================================================

export interface PipelineStatus {
  key: string;
  label: string;
  colour: string;
}

export interface CustomPipeline {
  statuses: PipelineStatus[];
  transitions: Record<string, string[]>;
}

// ============================================================
// Ticket Category
// ============================================================

export interface TicketCategory {
  id: string;
  name: string;
  description: string | null;
  emoji: string | null;
  colour: string | null;
  assignableRoles: string[];
  customPipeline: CustomPipeline | null;
  formTemplate: FormTemplate | null;
  sortOrder: number;
  isActive: boolean;
}

// ============================================================
// Ticket
// ============================================================

export interface Ticket {
  id: string;
  number: number;
  categoryId: string;
  createdById: string;
  assignedToId: string | null;
  title: string;
  description: string;
  formData: Record<string, unknown> | null;
  status: TicketStatus;
  priority: TicketPriority;
  parentTicketId: string | null;
  linkedTicketIds: string[];
  discordChannelId: string | null;
  discordThreadId: string | null;
  createdAt: string;
  updatedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  tags: string[];
}

// ============================================================
// Ticket Message
// ============================================================

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorId: string;
  content: string;
  isInternal: boolean;
  discordMessageId: string | null;
  createdAt: string;
  editedAt: string | null;
}

// ============================================================
// Ticket Audit Log Entry
// ============================================================

export interface TicketAuditLogEntry {
  id: string;
  ticketId: string;
  actorId: string;
  action: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}
