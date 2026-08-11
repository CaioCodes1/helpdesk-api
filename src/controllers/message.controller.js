import * as messageService from '../services/message.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { created, ok } from '../utils/httpResponse.js';

export const listByTicket = asyncHandler(async (req, res) => {
  const { data, meta } = await messageService.listByTicket(
    req.params.id,
    req.validatedQuery ?? req.query,
    req.user,
  );
  return ok(res, data, null, meta);
});

export const create = asyncHandler(async (req, res) => {
  const message = await messageService.create(req.params.id, req.body, req.user);
  return created(res, message, 'Mensagem enviada com sucesso');
});
