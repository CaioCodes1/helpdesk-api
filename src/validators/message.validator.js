import { z } from 'zod';
import { nonEmptyString, paginationQuerySchema } from './common.validator.js';

export const createMessageSchema = {
  body: z.object({
    content: nonEmptyString('content', { min: 1, max: 5000 }),
    /**
     * Nota interna: visivel apenas para ATENDENTE/ADMIN.
     * Se um CLIENTE mandar `isInternal: true`, quem barra e o service - o
     * validador nao tem acesso a `req.user`.
     */
    isInternal: z.boolean().optional().default(false),
  }),
};

export const listMessagesSchema = {
  query: paginationQuerySchema,
};
