import { z } from 'zod';
import { emailSchema, nonEmptyString, passwordSchema } from './common.validator.js';

/**
 * Repare no que NAO esta aqui: `role`.
 *
 * O cadastro publico cria SEMPRE um CLIENTE. Se aceitassemos `role` no body,
 * qualquer pessoa se cadastraria como ADMIN e teria controle total do sistema.
 * Essa falha se chama MASS ASSIGNMENT e e uma das mais exploradas do mundo
 * real. A promocao a ATENDENTE/ADMIN so acontece via PATCH /api/users/:id/role,
 * que exige um ADMIN autenticado.
 */
export const registerSchema = {
  body: z.object({
    name: nonEmptyString('name', { min: 3, max: 120 }),
    email: emailSchema,
    password: passwordSchema,
  }),
};

export const loginSchema = {
  body: z.object({
    email: emailSchema,
    // No login NAO aplicamos a politica de senha forte. Se aplicassemos, a
    // resposta de erro revelaria a regra e ajudaria quem tenta adivinhar.
    // Aqui basta "veio alguma coisa".
    password: z.string({ required_error: 'password e obrigatorio' }).min(1, 'password e obrigatorio'),
  }),
};

export const changePasswordSchema = {
  body: z.object({
    currentPassword: z.string({ required_error: 'currentPassword e obrigatorio' }).min(1),
    newPassword: passwordSchema,
  }),
};
