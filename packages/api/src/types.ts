import '@fastify/session';

export interface SessionUser {
  id: string;
  username: string;
  avatar: string | null;
  isStaff: boolean;
  permissions: string[];
}

declare module '@fastify/session' {
  interface FastifySessionObject {
    user?: SessionUser;
  }
}
