/**
 * Log de acesso: uma linha por requisicao, com metodo, rota, status e duracao.
 *
 * Como um middleware mede algo que so termina DEPOIS dele?
 * Ele nao espera a resposta - ele se INSCREVE no evento 'finish' do objeto
 * `res`, que o Node dispara quando a resposta termina de ser enviada. Enquanto
 * isso, `next()` deixa a cadeia seguir normalmente.
 *
 * A duracao (`durationMs`) e o que permite descobrir endpoints lentos sem
 * precisar de nenhuma ferramenta externa.
 */
import { logger } from '../utils/logger.js';

export function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const line = `${req.method} ${req.originalUrl} ${res.statusCode} - ${durationMs.toFixed(1)}ms`;

    if (res.statusCode >= 500) logger.error(line);
    else if (res.statusCode >= 400) logger.warn(line);
    else logger.info(line);
  });

  next();
}
