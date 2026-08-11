import { z } from 'zod';
import { ROLE_VALUES } from '../constants/index.js';
import {
  emailSchema,
  nonEmptyString,
  paginationQuerySchema,
  passwordSchema,
} from './common.validator.js';

export const listUsersSchema = {
  query: paginationQuerySchema.extend({
    role: z.enum(ROLE_VALUES).optional(),
    // "true"/"false" da query string viram boolean de verdade.
    isActive: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    search: z.string().trim().max(120).optional(),
  }),
};

/** Criacao feita pelo ADMIN: aqui `role` E permitido (o painel precisa disso). */
export const createUserSchema = {
  body: z.object({
    name: nonEmptyString('name', { min: 3, max: 120 }),
    email: emailSchema,
    password: passwordSchema,
    role: z.enum(ROLE_VALUES).default('CLIENTE'),
  }),
};

export const updateUserSchema = {
  body: z
    .object({
      name: nonEmptyString('name', { min: 3, max: 120 }).optional(),
      email: emailSchema.optional(),
      role: z.enum(ROLE_VALUES).optional(),
      isActive: z.boolean().optional(),
    })
    // Sem isto, um PUT com body vazio passaria e geraria um UPDATE sem colunas,
    // que e erro de sintaxe SQL. Melhor barrar na validacao.
    .refine((data) => Object.keys(data).length > 0, {
      message: 'Informe ao menos um campo para atualizar',
    }),
};

export const updateRoleSchema = {
  body: z.object({
    role: z.enum(ROLE_VALUES, {
      errorMap: () => ({ message: `role deve ser um de: ${ROLE_VALUES.join(', ')}` }),
    }),
  }),
};

export const resetPasswordSchema = {
  body: z.object({ newPassword: passwordSchema }),
};
