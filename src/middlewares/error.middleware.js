/**
 * TRATAMENTO CENTRALIZADO DE ERROS.
 *
 * Este e o unico lugar do sistema que decide o status HTTP e o formato da
 * resposta de erro. Todo o resto apenas faz `throw`.
 *
 * COMO O EXPRESS SABE QUE ISTO E UM TRATADOR DE ERRO?
 * Pela ARIDADE da funcao: quatro parametros (err, req, res, next). Com tres,
 * o Express o trataria como middleware comum. Por isso o `_next` precisa
 * existir mesmo sem ser usado - remove-lo quebra o mecanismo silenciosamente.
 *
 * Ele tambem precisa ser registrado POR ULTIMO no app.js, depois das rotas.
 */
import { AppError } from '../errors/AppError.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/** 404 para qualquer rota que nao casou com nada. */
export function notFoundHandler(req, res) {
  return res.status(404).json({
    success: false,
    error: {
      message: `Rota nao encontrada: ${req.method} ${req.originalUrl}`,
      hint: 'Consulte a documentacao em /api/docs',
    },
  });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Erro interno do servidor';
  let details = err.details || null;

  // --- Traducao de erros de INFRAESTRUTURA para erros de NEGOCIO ------------
  // O mysql2 fala em codigos ('ER_DUP_ENTRY'). O cliente da API nao deveria
  // precisar entende-los - nem descobrir por eles qual banco usamos.
  if (err.code === 'ER_DUP_ENTRY') {
    statusCode = 409;
    message = 'Ja existe um registro com esse valor unico (email ou nome duplicado)';
  } else if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW') {
    statusCode = 400;
    message = 'Referencia invalida: o registro relacionado nao existe';
  } else if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
    statusCode = 409;
    message = 'Nao e possivel remover: existem registros vinculados a este item';
  } else if (err.code === 'ECONNREFUSED' || err.code === 'ER_ACCESS_DENIED_ERROR') {
    statusCode = 503;
    message = 'Banco de dados indisponivel';
  } else if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'JSON malformado no corpo da requisicao';
  }

  const isOperational = err instanceof AppError || statusCode < 500;

  // --- Log -----------------------------------------------------------------
  const context = {
    method: req.method,
    url: req.originalUrl,
    userId: req.user?.id ?? null,
    statusCode,
  };

  if (statusCode >= 500) {
    // 5xx e problema NOSSO: registra o stack completo para investigacao.
    logger.error(`${message}`, { ...context, stack: err.stack });
  } else {
    // 4xx e o cliente errando: registra sem stack, so para observabilidade.
    logger.warn(`${message}`, context);
  }

  // --- Resposta ------------------------------------------------------------
  // Regra de seguranca: mensagens de erro nao operacional NAO vazam para fora.
  // Um stack trace ou "Table 'helpdesk.users' doesn't exist" entrega ao
  // atacante a estrutura interna do sistema.
  const body = {
    success: false,
    error: {
      message: isOperational ? message : 'Erro interno do servidor',
    },
  };

  if (details) body.error.details = details;
  if (!env.isProduction && statusCode >= 500) body.error.stack = err.stack;

  return res.status(statusCode).json(body);
}
