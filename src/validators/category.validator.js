import { z } from 'zod';
import { nonEmptyString } from './common.validator.js';

export const listCategoriesSchema = {
  query: z.object({
    includeInactive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  }),
};

export const createCategorySchema = {
  body: z.object({
    name: nonEmptyString('name', { min: 3, max: 80 }),
    description: z.string().trim().max(255).optional().nullable(),
  }),
};

export const updateCategorySchema = {
  body: z
    .object({
      name: nonEmptyString('name', { min: 3, max: 80 }).optional(),
      description: z.string().trim().max(255).optional().nullable(),
      isActive: z.boolean().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'Informe ao menos um campo para atualizar',
    }),
};
