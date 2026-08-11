import { z } from 'zod';

/**
 * Schemas reutilizaveis.
 *
 * `params` e `query` chegam SEMPRE como string (fazem parte da URL, e URL e
 * texto). Por isso todo numero aqui passa por `coerce`, que converte antes de
 * validar. Sem isso, `z.number()` rejeitaria a string "42".
 */

export const idParamSchema = z.object({
  id: z.coerce
    .number({ invalid_type_error: 'O id deve ser um numero' })
    .int('O id deve ser um numero inteiro')
    .positive('O id deve ser positivo'),
});

/**
 * Note que `limit` NAO e rejeitado quando passa de 100 - ele e CAPADO.
 *
 * Rejeitar com 422 seria defensavel, mas quebraria o cliente por um detalhe
 * que o servidor sabe resolver sozinho. E a mesma decisao que a API do GitHub
 * toma (`per_page` maior que 100 e silenciosamente reduzido). O importante e
 * que o teto exista: sem ele, `?limit=999999` derrubaria o banco.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .transform((value) => Math.min(value, 100))
    .optional(),
});

/** Aparar espacos evita cadastrar "  Joao  " e depois nao achar em busca. */
export const nonEmptyString = (field, { min = 1, max = 255 } = {}) =>
  z
    .string({ required_error: `${field} e obrigatorio` })
    .trim()
    .min(min, `${field} deve ter no minimo ${min} caracteres`)
    .max(max, `${field} deve ter no maximo ${max} caracteres`);

export const emailSchema = z
  .string({ required_error: 'email e obrigatorio' })
  .trim()
  .toLowerCase() // normaliza: Joao@X.com e joao@x.com sao a mesma conta
  .email('Formato de email invalido')
  .max(160, 'email deve ter no maximo 160 caracteres');

/**
 * Politica de senha.
 * Exigir tamanho minimo e variedade de caracteres nao e burocracia: e o que
 * torna inviavel um ataque de dicionario mesmo que o hash vaze.
 */
export const passwordSchema = z
  .string({ required_error: 'password e obrigatorio' })
  .min(8, 'A senha deve ter no minimo 8 caracteres')
  .max(72, 'A senha deve ter no maximo 72 caracteres') // limite do bcrypt
  .regex(/[a-z]/, 'A senha deve conter ao menos uma letra minuscula')
  .regex(/[A-Z]/, 'A senha deve conter ao menos uma letra maiuscula')
  .regex(/\d/, 'A senha deve conter ao menos um numero');
