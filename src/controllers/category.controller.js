import * as categoryService from '../services/category.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { created, noContent, ok } from '../utils/httpResponse.js';

export const list = asyncHandler(async (req, res) => {
  const query = req.validatedQuery ?? req.query;
  // Categorias inativas so aparecem para o ADMIN - o cliente nao precisa ver
  // opcoes que nao pode escolher.
  const includeInactive = query.includeInactive === true && req.user?.role === 'ADMIN';
  const categories = await categoryService.list({ includeInactive });
  return ok(res, categories);
});

export const getById = asyncHandler(async (req, res) => {
  const category = await categoryService.getById(req.params.id);
  return ok(res, category);
});

export const create = asyncHandler(async (req, res) => {
  const category = await categoryService.create(req.body);
  return created(res, category, 'Categoria criada com sucesso');
});

export const update = asyncHandler(async (req, res) => {
  const category = await categoryService.update(req.params.id, req.body);
  return ok(res, category, 'Categoria atualizada com sucesso');
});

export const remove = asyncHandler(async (req, res) => {
  const result = await categoryService.remove(req.params.id);
  if (result.deleted) return noContent(res);
  return ok(res, null, result.message);
});
