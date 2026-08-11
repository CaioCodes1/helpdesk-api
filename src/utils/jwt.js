/**
 * Geracao e verificacao de JSON Web Tokens.
 *
 * O PROBLEMA: HTTP e stateless. O servidor esquece tudo entre uma requisicao e
 * a seguinte. Como saber, no GET /api/tickets, quem esta pedindo?
 *
 * A solucao classica e SESSAO: o servidor guarda um mapa sessionId -> usuario
 * em memoria ou Redis. Funciona, mas exige armazenamento compartilhado quando
 * ha mais de uma instancia da API rodando.
 *
 * A solucao JWT: o servidor nao guarda nada. Ele entrega ao cliente um cracha
 * ASSINADO, e o cliente reapresenta esse cracha a cada requisicao.
 *
 * ANATOMIA (tres partes separadas por ponto, em Base64URL):
 *
 *   eyJhbGciOiJIUzI1NiJ9 . eyJzdWIiOjEsInJvbGUiOiJBRE1JTiJ9 . 4pcPyMD09olPSyXn
 *   └──── HEADER ───────┘  └──────────── PAYLOAD ──────────┘  └── SIGNATURE ──┘
 *      algoritmo usado        os dados (claims): quem e o           HMAC do
 *                             usuario, sua role, validade        header+payload
 *                                                                 com o SECRET
 *
 * ATENCAO AO PONTO QUE MAIS CAI EM ENTREVISTA:
 * O payload e apenas Base64 - NAO e criptografado. Qualquer um cola o token em
 * jwt.io e le o conteudo. Portanto NUNCA coloque senha, CPF ou dado sensivel
 * ali. O que a assinatura garante nao e sigilo, e INTEGRIDADE: se alguem
 * trocar "role":"CLIENTE" por "role":"ADMIN", a assinatura deixa de bater e o
 * `jwt.verify` rejeita - porque so o servidor tem o JWT_SECRET.
 *
 * TRADE-OFF HONESTO: como o servidor nao guarda estado, nao da para "revogar"
 * um token antes de ele expirar. Por isso usamos validade curta (8h) e a
 * checagem de `is_active` no middleware a cada requisicao.
 */
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { UnauthorizedError } from '../errors/AppError.js';

/**
 * @param {{ id: number, email: string, role: string }} user
 */
export function signToken(user) {
  const payload = {
    sub: user.id, // "subject": claim padrao do JWT para o dono do token
    email: user.email,
    role: user.role,
  };

  return jwt.sign(payload, env.jwt.secret, {
    expiresIn: env.jwt.expiresIn, // vira a claim `exp`
    issuer: 'helpdesk-api', // vira a claim `iss`
  });
}

/**
 * Valida assinatura + expiracao e devolve o payload.
 * Converte as excecoes do jsonwebtoken em erros da NOSSA aplicacao, para que a
 * camada de cima nao precise conhecer a biblioteca.
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, env.jwt.secret, { issuer: 'helpdesk-api' });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new UnauthorizedError('Token expirado. Faca login novamente.');
    }
    throw new UnauthorizedError('Token invalido');
  }
}
