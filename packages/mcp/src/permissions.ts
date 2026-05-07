import type { McpSession } from './auth/session.js';

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

export function requirePermission(session: McpSession, permission: string): void {
  if (session.isStaff) return; // staff shortcut
  if (!session.permissions.includes(permission)) {
    throw new PermissionError(
      `This tool requires the "${permission}" permission, which you don't currently hold.`,
    );
  }
}

export function requireStaff(session: McpSession): void {
  if (!session.isStaff) {
    throw new PermissionError('This tool is staff-only.');
  }
}
