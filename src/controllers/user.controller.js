import * as userService from '../services/user.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { created, noContent, ok } from '../utils/httpResponse.js';

export const list = asyncHandler(async (req, res) => {
  const { data, meta } = await userService.list(req.validatedQuery ?? req.query);
  return ok(res, data, null, meta);
});

export const getById = asyncHandler(async (req, res) => {
  const user = await userService.getById(req.params.id);
  return ok(res, user);
});

export const create = asyncHandler(async (req, res) => {
  const user = await userService.create(req.body);
  return created(res, user, 'Usuario criado com sucesso');
});

export const update = asyncHandler(async (req, res) => {
  const user = await userService.update(req.params.id, req.body, req.user);
  return ok(res, user, 'Usuario atualizado com sucesso');
});

export const updateRole = asyncHandler(async (req, res) => {
  const user = await userService.updateRole(req.params.id, req.body.role, req.user);
  return ok(res, user, 'Permissao atualizada com sucesso');
});

export const resetPassword = asyncHandler(async (req, res) => {
  const result = await userService.resetPassword(req.params.id, req.body.newPassword);
  return ok(res, null, result.message);
});

/**
 * Note a diferenca de status:
 *   204 (No Content) quando o registro foi realmente apagado - nao ha corpo.
 *   200 (OK) quando o usuario foi apenas DESATIVADO - o cliente precisa saber
 *   que a acao teve um efeito diferente do pedido.
 * Responder 204 nos dois casos seria mentir sobre o que aconteceu.
 */
export const remove = asyncHandler(async (req, res) => {
  const result = await userService.remove(req.params.id, req.user);
  if (result.deleted) return noContent(res);
  return ok(res, null, result.message);
});

export const listAgents = asyncHandler(async (_req, res) => {
  const agents = await userService.listAgents();
  return ok(res, agents);
});
