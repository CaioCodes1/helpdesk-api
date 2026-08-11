import { z } from 'zod';
import { TICKET_PRIORITY_VALUES, TICKET_STATUS_VALUES } from '../constants/index.js';
import { nonEmptyString, paginationQuerySchema } from './common.validator.js';

const SORTABLE_FIELDS = ['createdAt', 'updatedAt', 'priority', 'status'];

export const listTicketsSchema = {
  query: paginationQuerySchema.extend({
    // Aceita "ABERTO" ou "ABERTO,EM_ATENDIMENTO" e devolve sempre um array.
    // Normalizar a forma AQUI evita que o repository precise lidar com os dois
    // formatos - a camada de baixo recebe um contrato unico.
    status: z
      .string()
      .transform((value) => value.split(',').map((s) => s.trim().toUpperCase()))
      .pipe(z.array(z.enum(TICKET_STATUS_VALUES)))
      .optional(),
    priority: z
      .string()
      .transform((value) => value.split(',').map((s) => s.trim().toUpperCase()))
      .pipe(z.array(z.enum(TICKET_PRIORITY_VALUES)))
      .optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    clientId: z.coerce.number().int().positive().optional(),
    agentId: z.coerce.number().int().positive().optional(),
    /** `?unassigned=true` = fila de tickets sem dono. */
    unassigned: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    /** `?assignedToMe=true` = atalho para a tela do atendente. */
    assignedToMe: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    search: z.string().trim().max(150).optional(),
    createdFrom: z.string().date('Use o formato YYYY-MM-DD').optional(),
    createdTo: z.string().date('Use o formato YYYY-MM-DD').optional(),
    /**
     * Whitelist de ordenacao. NUNCA interpole `req.query.sortBy` direto no
     * ORDER BY: nomes de coluna nao podem ser parametrizados com `?`, entao
     * seria uma porta aberta para SQL injection. O enum e a defesa.
     */
    sortBy: z.enum(SORTABLE_FIELDS).optional(),
    sortOrder: z.enum(['asc', 'desc', 'ASC', 'DESC']).transform((v) => v.toUpperCase()).optional(),
  }),
};

export const createTicketSchema = {
  body: z.object({
    title: nonEmptyString('title', { min: 5, max: 150 }),
    description: nonEmptyString('description', { min: 10, max: 5000 }),
    categoryId: z.coerce.number({ required_error: 'categoryId e obrigatorio' }).int().positive(),
    priority: z.enum(TICKET_PRIORITY_VALUES).optional(),
    /**
     * Somente o ADMIN pode preencher isto (abrir chamado em nome de alguem).
     * Quem verifica NAO e o validador - e o service. O validador so garante o
     * FORMATO; a PERMISSAO e regra de negocio.
     */
    clientId: z.coerce.number().int().positive().optional(),
  }),
};

export const updateTicketSchema = {
  body: z
    .object({
      title: nonEmptyString('title', { min: 5, max: 150 }).optional(),
      description: nonEmptyString('description', { min: 10, max: 5000 }).optional(),
      categoryId: z.coerce.number().int().positive().optional(),
      priority: z.enum(TICKET_PRIORITY_VALUES).optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'Informe ao menos um campo para atualizar',
    }),
};

export const updateStatusSchema = {
  body: z.object({
    status: z.enum(TICKET_STATUS_VALUES, {
      errorMap: () => ({ message: `status deve ser um de: ${TICKET_STATUS_VALUES.join(', ')}` }),
    }),
  }),
};

export const updatePrioritySchema = {
  body: z.object({
    priority: z.enum(TICKET_PRIORITY_VALUES, {
      errorMap: () => ({ message: `priority deve ser um de: ${TICKET_PRIORITY_VALUES.join(', ')}` }),
    }),
  }),
};

export const assignTicketSchema = {
  body: z.object({
    // null = desatribuir (devolver o ticket para a fila).
    agentId: z.coerce.number().int().positive().nullable(),
  }),
};
