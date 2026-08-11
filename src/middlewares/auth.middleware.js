/**
 * AUTENTICACAO (quem e voce?) e AUTORIZACAO (o que voce pode?).
 *
 * Sao duas responsabilidades distintas e por isso sao dois middlewares.
 * Uma rota os compoe em cadeia:
 *
 *   router.delete('/:id', authenticate, authorize(ROLES.ADMIN), controller);
 *                          └─ 401 se ─┘  └─ 403 se nao for ─┘
 *                             sem token       ADMIN
 *
 * Middleware, na pratica, e so uma funcao (req, res, next) que roda ANTES do
 * controller. Ela pode: enriquecer o `req`, interromper a cadeia respondendo,
 * ou chamar `next(erro)` para pular direto ao tratador de erros.
 */
import { verifyToken } from '../utils/jwt.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ForbiddenError, UnauthorizedError } from '../errors/AppError.js';
import * as userRepository from '../repositories/user.repository.js';

/**
 * Exige um token valido e anexa o usuario a `req.user`.
 *
 * Por que consultar o banco se o token ja traz id, email e role?
 * Porque o token e uma FOTOGRAFIA do momento do login. Se o admin rebaixou o
 * usuario de ADMIN para CLIENTE ha 10 minutos, o token antigo continua dizendo
 * "ADMIN" ate expirar. A consulta garante que role e is_active refletem o
 * estado ATUAL. Custa um SELECT por PK (barato, usa indice) e fecha uma falha
 * de seguranca real.
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    throw new UnauthorizedError('Token de acesso ausente. Envie o header "Authorization: Bearer <token>".');
  }

  // 'Bearer eyJhbGciOi...' -> pega tudo depois do primeiro espaco
  const token = header.slice(7).trim();
  if (!token) throw new UnauthorizedError('Token de acesso ausente');

  const payload = verifyToken(token); // lanca 401 se invalido/expirado

  const user = await userRepository.findById(payload.sub);
  if (!user) throw new UnauthorizedError('Usuario do token nao existe mais');
  if (!user.is_active) throw new UnauthorizedError('Usuario desativado');

  // A partir daqui, TODO controller pode confiar em req.user.
  req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  next();
});

/**
 * Restringe a rota a determinados papeis.
 *
 * Repare que `authorize` NAO e um middleware - e uma FABRICA de middlewares.
 * Ela recebe os papeis e RETORNA a funcao (req, res, next). E o que permite
 * escrever `authorize(ROLES.ADMIN)` na definicao da rota. Esse padrao se chama
 * closure: a funcao devolvida "lembra" do array `allowedRoles`.
 *
 * @param {...string} allowedRoles
 */
export function authorize(...allowedRoles) {
  return function authorizeMiddleware(req, _res, next) {
    if (!req.user) {
      // Erro de programacao: alguem esqueceu o `authenticate` antes deste.
      return next(new UnauthorizedError('Rota protegida exige autenticacao'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new ForbiddenError(
          `Acesso restrito a: ${allowedRoles.join(', ')}. Seu perfil: ${req.user.role}.`,
        ),
      );
    }

    next();
  };
}

/**
 * IMPORTANTE - o limite deste middleware:
 * `authorize` responde apenas "essa ROLE pode acessar essa ROTA?". Ele nao
 * consegue responder "esse cliente e dono DESTE ticket?", porque isso depende
 * de dados que so existem depois de consultar o banco.
 *
 * Essa segunda pergunta (ownership) e regra de negocio e vive no SERVICE.
 * Confundir as duas e o erro mais comum em projetos de portfolio: a rota fica
 * "protegida", mas o cliente A consegue ler o ticket do cliente B trocando o
 * id na URL (falha classica: IDOR - Insecure Direct Object Reference).
 */
