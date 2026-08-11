/**
 * SERVICE = onde vivem as REGRAS DE NEGOCIO.
 *
 * Um service nunca ve `req`/`res` e nunca escreve SQL. Ele recebe dados
 * simples, aplica as regras, chama repositories e devolve dados simples.
 * Quando algo viola uma regra, ele LANCA um erro tipado - nao devolve
 * `{ error: ... }`, porque isso obrigaria toda chamada a checar o retorno.
 */
import * as userRepository from '../repositories/user.repository.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { signToken } from '../utils/jwt.js';
import { ConflictError, UnauthorizedError, NotFoundError } from '../errors/AppError.js';
import { ROLES } from '../constants/index.js';
import { logger } from '../utils/logger.js';

export async function register({ name, email, password }) {
  const existing = await userRepository.findByEmail(email);
  if (existing) {
    throw new ConflictError('Este email ja esta cadastrado');
  }

  const passwordHash = await hashPassword(password);

  // A role e FIXA aqui. Ainda que o cliente envie `role` no body, o validador
  // ja a descartou e este service nem sequer a le. Duas barreiras para a mesma
  // falha (mass assignment) - defesa em profundidade.
  const user = await userRepository.create({
    name,
    email,
    passwordHash,
    role: ROLES.CLIENTE,
  });

  logger.info(`Novo usuario cadastrado: ${email}`);

  return { user, token: signToken(user) };
}

export async function login({ email, password }) {
  const user = await userRepository.findByEmailWithPassword(email);

  /**
   * DETALHE DE SEGURANCA: a mensagem e a MESMA para "email inexistente" e
   * "senha errada". Se fossem diferentes, um atacante usaria o endpoint de
   * login para descobrir quais emails existem no sistema (user enumeration).
   *
   * Repare tambem que rodamos o `verifyPassword` mesmo quando o usuario nao
   * existe seria o ideal para equalizar o tempo de resposta; aqui optamos pela
   * versao simples, mas com rate limit na rota de login para compensar.
   */
  if (!user) {
    throw new UnauthorizedError('Email ou senha invalidos');
  }

  const passwordMatches = await verifyPassword(password, user.password_hash);
  if (!passwordMatches) {
    logger.warn(`Tentativa de login com senha invalida: ${email}`);
    throw new UnauthorizedError('Email ou senha invalidos');
  }

  if (!user.is_active) {
    throw new UnauthorizedError('Usuario desativado. Procure um administrador.');
  }

  // Nunca devolvemos `password_hash`. Montamos explicitamente o que sai.
  const safeUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  return { user: safeUser, token: signToken(safeUser) };
}

export async function getProfile(userId) {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError('Usuario');
  return user;
}

export async function changePassword(userId, { currentPassword, newPassword }) {
  const passwordHash = await userRepository.getPasswordHash(userId);
  if (!passwordHash) throw new NotFoundError('Usuario');

  // Exigir a senha atual protege contra sequestro de sessao: quem roubou o
  // token nao consegue trocar a senha e tomar a conta de vez.
  const matches = await verifyPassword(currentPassword, passwordHash);
  if (!matches) throw new UnauthorizedError('Senha atual incorreta');

  const isSame = await verifyPassword(newPassword, passwordHash);
  if (isSame) throw new ConflictError('A nova senha deve ser diferente da atual');

  await userRepository.update(userId, { passwordHash: await hashPassword(newPassword) });
  logger.info(`Senha alterada para o usuario ${userId}`);

  return { message: 'Senha alterada com sucesso' };
}
