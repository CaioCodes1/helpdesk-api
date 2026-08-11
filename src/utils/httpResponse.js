/**
 * Formato UNICO de resposta da API.
 *
 * Por que padronizar? Porque o frontend precisa de uma regra so para saber se
 * deu certo. Se um endpoint devolve `{ user }`, outro devolve o objeto cru e um
 * terceiro devolve `{ data: [...] }`, o cliente vira um emaranhado de casos
 * especiais. Contrato consistente e o que separa uma API profissional.
 *
 * Sucesso:
 *   { "success": true, "message": "...", "data": {...}, "meta": {...} }
 *
 * Erro (montado pelo errorHandler):
 *   { "success": false, "error": { "message": "...", "details": [...] } }
 */

export function ok(res, data, message = null, meta = null) {
  return send(res, 200, data, message, meta);
}

export function created(res, data, message = 'Recurso criado com sucesso') {
  return send(res, 201, data, message);
}

/** 204: sucesso sem corpo. Usado em DELETE - nao ha o que devolver. */
export function noContent(res) {
  return res.status(204).send();
}

function send(res, statusCode, data, message, meta) {
  const body = { success: true };
  if (message) body.message = message;
  if (data !== undefined) body.data = data;
  if (meta) body.meta = meta;
  return res.status(statusCode).json(body);
}
