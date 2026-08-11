/**
 * Envolve um controller assincrono e encaminha qualquer rejeicao para o
 * middleware de erro do Express.
 *
 * O PROBLEMA que resolve:
 * O Express 4 NAO captura excecoes de funcoes `async`. Este codigo trava a
 * requisicao para sempre (o cliente fica esperando ate dar timeout):
 *
 *   app.get('/x', async (req, res) => { throw new Error('boom'); });
 *
 * A alternativa seria escrever try/catch em TODOS os controllers:
 *
 *   async (req, res, next) => {
 *     try { ... } catch (error) { next(error); }
 *   }
 *
 * Isso e ruido repetido em 30 lugares. Com o asyncHandler, o `.catch(next)`
 * fica escrito uma vez so e cada controller volta a ter apenas sua logica.
 *
 * (No Express 5 isso passa a ser nativo - mas entender o porque continua
 * valendo, e e uma otima resposta de entrevista sobre middlewares.)
 */
export function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
