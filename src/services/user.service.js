import * as userRepository from '../repositories/user.repository.js';
import { hashPassword } from '../utils/password.js';
import { ROLES } from '../constants/index.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../errors/AppError.js';
import { buildMeta, parsePagination } from '../utils/pagination.js';
import { logger } from '../utils/logger.js';

export async function list(filters) {
  const { page, limit, offset } = parsePagination(filters);
  const { data, total } = await userRepository.findAll({ ...filters, limit, offset });
  return { data, meta: buildMeta({ page, limit, total }) };
}

export async function getById(id) {
  const user = await userRepository.findById(id);
  if (!user) throw new NotFoundError('Usuario');
  return user;
}

export async function create({ name, email, password, role }) {
  const existing = await userRepository.findByEmail(email);
  if (existing) throw new ConflictError('Este email ja esta cadastrado');

  const user = await userRepository.create({
    name,
    email,
    passwordHash: await hashPassword(password),
    role,
  });

  logger.info(`Admin criou usuario ${email} com role ${role}`);
  return user;
}

export async function update(id, fields, actor) {
  const user = await userRepository.findById(id);
  if (!user) throw new NotFoundError('Usuario');

  if (fields.email && fields.email !== user.email) {
    const emailOwner = await userRepository.findByEmail(fields.email);
    if (emailOwner) throw new ConflictError('Este email ja esta em uso por outro usuario');
  }

  // REGRA: o admin nao pode rebaixar nem desativar a si mesmo.
  // Sem isso, um clique errado tiraria o unico acesso administrativo do
  // sistema e so restaria arrumar direto no banco.
  if (Number(id) === actor.id) {
    if (fields.role && fields.role !== user.role) {
      throw new ForbiddenError('Voce nao pode alterar a sua propria role');
    }
    if (fields.isActive === false) {
      throw new ForbiddenError('Voce nao pode desativar a sua propria conta');
    }
  }

  await assertNotLastAdmin(user, fields);

  return userRepository.update(id, fields);
}

export async function updateRole(id, role, actor) {
  const user = await userRepository.findById(id);
  if (!user) throw new NotFoundError('Usuario');

  if (Number(id) === actor.id) {
    throw new ForbiddenError('Voce nao pode alterar a sua propria role');
  }

  await assertNotLastAdmin(user, { role });

  /**
   * REGRA IMPORTANTE: rebaixar um ATENDENTE para CLIENTE deixaria tickets
   * atribuidos a alguem que, pelas regras, nao pode atende-los. Em vez de
   * permitir o estado inconsistente, exigimos que os tickets sejam
   * redistribuidos antes.
   */
  if (user.role !== ROLES.CLIENTE && role === ROLES.CLIENTE) {
    const activeTickets = await userRepository.countTicketsOfUser(id);
    if (activeTickets > 0) {
      throw new ConflictError(
        'Este usuario possui tickets vinculados. Reatribua os tickets antes de rebaixa-lo para CLIENTE.',
      );
    }
  }

  logger.info(`Role do usuario ${id} alterada de ${user.role} para ${role} por ${actor.email}`);
  return userRepository.update(id, { role });
}

export async function resetPassword(id, newPassword) {
  const user = await userRepository.findById(id);
  if (!user) throw new NotFoundError('Usuario');

  await userRepository.update(id, { passwordHash: await hashPassword(newPassword) });
  logger.warn(`Senha do usuario ${id} redefinida por um administrador`);

  return { message: 'Senha redefinida com sucesso' };
}

/**
 * REGRA: exclusao inteligente.
 *
 * Se o usuario nunca participou de nenhum ticket, apagamos de verdade.
 * Se participou, apenas DESATIVAMOS - porque apagar destruiria o historico
 * (e o banco recusaria, por causa do ON DELETE RESTRICT).
 *
 * Devolver ao controller qual das duas coisas aconteceu permite uma resposta
 * honesta ao cliente da API, em vez de mentir "deletado".
 */
export async function remove(id, actor) {
  const user = await userRepository.findById(id);
  if (!user) throw new NotFoundError('Usuario');

  if (Number(id) === actor.id) {
    throw new ForbiddenError('Voce nao pode remover a sua propria conta');
  }

  await assertNotLastAdmin(user, { isActive: false });

  const ticketCount = await userRepository.countTicketsOfUser(id);

  if (ticketCount > 0) {
    await userRepository.deactivate(id);
    logger.info(`Usuario ${id} desativado (possui ${ticketCount} tickets vinculados)`);
    return { deleted: false, message: 'Usuario desativado (possui historico de tickets)' };
  }

  await userRepository.remove(id);
  logger.info(`Usuario ${id} removido permanentemente`);
  return { deleted: true, message: 'Usuario removido com sucesso' };
}

export async function listAgents() {
  return userRepository.findAssignableAgents();
}

/** Impede que o sistema fique sem nenhum administrador ativo. */
async function assertNotLastAdmin(user, changes) {
  const losingAdmin =
    user.role === ROLES.ADMIN &&
    ((changes.role && changes.role !== ROLES.ADMIN) || changes.isActive === false);

  if (!losingAdmin) return;

  const activeAdmins = await userRepository.countByRole(ROLES.ADMIN);
  if (activeAdmins <= 1) {
    throw new BadRequestError(
      'Operacao bloqueada: o sistema ficaria sem nenhum administrador ativo',
    );
  }
}
