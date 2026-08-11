/**
 * CONTROLLER = tradutor entre HTTP e o dominio.
 *
 * Um controller bem escrito faz exatamente tres coisas:
 *   1. extrai os dados de `req` (body, params, query, user)
 *   2. chama UM metodo do service
 *   3. formata a resposta com o status HTTP correto
 *
 * O que ele NUNCA faz: regra de negocio, SQL, `if` de permissao.
 *
 * POR QUE SEPARAR CONTROLLER DE SERVICE?
 * Porque a regra "ticket fechado nao recebe mensagem" nao tem nada a ver com
 * HTTP. Se ela morasse no controller, seria impossivel reutiliza-la num job
 * agendado, num comando de CLI ou num teste - e o teste precisaria simular
 * objetos `req`/`res` falsos so para verificar uma regra de negocio.
 *
 * Se um controller aqui passar de ~10 linhas, e sinal de que logica vazou
 * para dentro dele.
 */
import * as authService from '../services/auth.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { created, ok } from '../utils/httpResponse.js';

export const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body);
  return created(res, result, 'Cadastro realizado com sucesso');
});

export const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  return ok(res, result, 'Login realizado com sucesso');
});

/**
 * `req.user` foi colocado ali pelo middleware `authenticate`. O controller
 * apenas confia nele - a verificacao do token ja aconteceu antes.
 */
export const me = asyncHandler(async (req, res) => {
  const user = await authService.getProfile(req.user.id);
  return ok(res, user);
});

export const changePassword = asyncHandler(async (req, res) => {
  const result = await authService.changePassword(req.user.id, req.body);
  return ok(res, null, result.message);
});
