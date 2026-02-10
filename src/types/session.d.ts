import 'fastify';
import type { User } from '../db/users.js';

declare module 'fastify' {
  interface Session {
    userId?: string;
  }
  interface FastifyRequest {
    dashboardUser?: User;
  }
}
