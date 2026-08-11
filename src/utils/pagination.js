import { PAGINATION } from '../constants/index.js';

/**
 * Normaliza `?page=` e `?limit=` vindos da query string.
 *
 * Detalhe importante: a query string e SEMPRE texto. `?page=abc` chegaria como
 * a string 'abc' e viraria NaN dentro do LIMIT, quebrando a query. Por isso
 * tudo aqui e coagido a inteiro e preso dentro de limites seguros.
 *
 * O MAX_LIMIT existe por seguranca: sem ele, `?limit=999999999` deixaria
 * qualquer visitante derrubar o banco com uma unica requisicao.
 */
export function parsePagination(query = {}) {
  const rawPage = Number.parseInt(query.page, 10);
  const rawLimit = Number.parseInt(query.limit, 10);

  const page = Number.isNaN(rawPage) || rawPage < 1 ? PAGINATION.DEFAULT_PAGE : rawPage;

  let limit = Number.isNaN(rawLimit) || rawLimit < 1 ? PAGINATION.DEFAULT_LIMIT : rawLimit;
  if (limit > PAGINATION.MAX_LIMIT) limit = PAGINATION.MAX_LIMIT;

  return { page, limit, offset: (page - 1) * limit };
}

/** Monta o bloco de metadados que acompanha toda listagem paginada. */
export function buildMeta({ page, limit, total }) {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    total,
    totalPages,
    hasPreviousPage: page > 1,
    hasNextPage: page < totalPages,
  };
}
