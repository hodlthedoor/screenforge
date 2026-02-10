import 'fastify';
import type { User } from '../db/users.js';

declare module 'fastify' {
  interface Session {
    userId?: string;
    flash?: Record<string, string>;
    csrfToken?: string;
  }
  interface FastifyRequest {
    dashboardUser?: User;
  }
}
