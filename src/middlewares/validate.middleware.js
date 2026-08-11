/**
 * Middleware de validacao de entrada usando Zod.
 *
 * POR QUE VALIDAR NA BORDA?
 * Regra de ouro de backend: NUNCA confie no cliente. O frontend pode ter
 * validacao caprichada, mas qualquer pessoa envia uma requisicao direto com
 * curl ou Postman. Se os dados nao forem checados aqui, chegam sujos no
 * service, no SQL e no banco.
 *
 * POR QUE UM MIDDLEWARE E NAO `if`s DENTRO DO CONTROLLER?
 * Porque validacao e uma preocupacao transversal (cross-cutting). Como
 * middleware, ela roda antes de qualquer controller, falha de forma
 * padronizada e mantem o controller focado em orquestrar.
 *
 * DETALHE: o resultado do parse SUBSTITUI o original (`req.body = parsed`).
 * Assim o service recebe dados ja normalizados - numeros como numero, email em
 * minusculas, espacos aparados - e nunca precisa desconfiar do formato.
 */
import { ZodError } from 'zod';
import { ValidationError } from '../errors/AppError.js';

/**
 * @param {object} schemas - { body?, query?, params? } com schemas Zod
 */
export function validate(schemas) {
  return function validateMiddleware(req, _res, next) {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
      if (schemas.params) req.params = schemas.params.parse(req.params ?? {});
      if (schemas.query) {
        // req.query e somente-leitura no Express 5; guardamos o resultado
        // normalizado em req.validatedQuery para funcionar nas duas versoes.
        req.validatedQuery = schemas.query.parse(req.query ?? {});
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Transformamos o erro do Zod numa lista amigavel: campo + mensagem.
        // O cliente recebe TODOS os problemas de uma vez, e nao um por vez.
        const details = error.issues.map((issue) => ({
          field: issue.path.join('.') || '(raiz)',
          message: issue.message,
        }));
        return next(new ValidationError('Falha na validacao dos dados enviados', details));
      }
      next(error);
    }
  };
}
