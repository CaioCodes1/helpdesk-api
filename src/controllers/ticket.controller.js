import * as ticketService from '../services/ticket.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { created, noContent, ok } from '../utils/httpResponse.js';

/**
 * Repare que `req.user` e passado para o service em quase todas as chamadas.
 *
 * Isso e proposital: as regras de "quem pode o que" dependem de QUEM esta
 * pedindo, e essa informacao precisa atravessar a fronteira HTTP -> dominio.
 * O service recebe um objeto simples `{ id, name, email, role }`, e nao o
 * `req` inteiro, porque assim ele continua sem conhecer nada de Express.
 */

export const list = asyncHandler(async (req, res) => {
  const { data, meta } = await ticketService.list(req.validatedQuery ?? req.query, req.user);
  return ok(res, data, null, meta);
});

export const getById = asyncHandler(async (req, res) => {
  const ticket = await ticketService.getById(req.params.id, req.user);
  return ok(res, ticket);
});

export const create = asyncHandler(async (req, res) => {
  const ticket = await ticketService.create(req.body, req.user);
  return created(res, ticket, 'Ticket aberto com sucesso');
});

export const update = asyncHandler(async (req, res) => {
  const ticket = await ticketService.update(req.params.id, req.body, req.user);
  return ok(res, ticket, 'Ticket atualizado com sucesso');
});

export const updateStatus = asyncHandler(async (req, res) => {
  const ticket = await ticketService.updateStatus(req.params.id, req.body.status, req.user);
  return ok(res, ticket, `Status alterado para ${ticket.status}`);
});

export const updatePriority = asyncHandler(async (req, res) => {
  const ticket = await ticketService.updatePriority(req.params.id, req.body.priority, req.user);
  return ok(res, ticket, `Prioridade alterada para ${ticket.priority}`);
});

export const assign = asyncHandler(async (req, res) => {
  const ticket = await ticketService.assign(req.params.id, req.body.agentId, req.user);
  return ok(res, ticket, 'Atribuicao atualizada com sucesso');
});

export const claim = asyncHandler(async (req, res) => {
  const ticket = await ticketService.claim(req.params.id, req.user);
  return ok(res, ticket, 'Ticket assumido com sucesso');
});

export const remove = asyncHandler(async (req, res) => {
  await ticketService.remove(req.params.id, req.user);
  return noContent(res);
});
