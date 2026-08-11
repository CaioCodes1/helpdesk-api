import * as categoryRepository from '../repositories/category.repository.js';
import { ConflictError, NotFoundError } from '../errors/AppError.js';
import { logger } from '../utils/logger.js';

export async function list({ includeInactive = false } = {}) {
  return categoryRepository.findAll({ includeInactive });
}

export async function getById(id) {
  const category = await categoryRepository.findById(id);
  if (!category) throw new NotFoundError('Categoria');
  return category;
}

export async function create({ name, description }) {
  // Checamos aqui para dar uma mensagem clara. O UNIQUE no banco continua
  // sendo a garantia real (duas requisicoes simultaneas passariam por este if).
  const existing = await categoryRepository.findByName(name);
  if (existing) throw new ConflictError('Ja existe uma categoria com esse nome');

  const category = await categoryRepository.create({ name, description });
  logger.info(`Categoria criada: ${name}`);
  return category;
}

export async function update(id, fields) {
  const category = await categoryRepository.findById(id);
  if (!category) throw new NotFoundError('Categoria');

  if (fields.name && fields.name !== category.name) {
    const existing = await categoryRepository.findByName(fields.name);
    if (existing) throw new ConflictError('Ja existe uma categoria com esse nome');
  }

  return categoryRepository.update(id, fields);
}

/**
 * REGRA 21 - Categoria com tickets NAO e apagada, e desativada.
 *
 * A FK `fk_tickets_category` usa ON DELETE RESTRICT: o banco recusaria o
 * DELETE. Poderiamos deixar o erro estourar, mas o comportamento util para o
 * admin e outro - ele quer "parar de oferecer esta categoria", nao destruir
 * o historico. Entao: sem tickets = DELETE de verdade; com tickets =
 * `is_active = 0`, e a categoria some dos formularios sem quebrar relatorios.
 */
export async function remove(id) {
  const category = await categoryRepository.findById(id);
  if (!category) throw new NotFoundError('Categoria');

  const ticketCount = await categoryRepository.countTickets(id);

  if (ticketCount > 0) {
    await categoryRepository.update(id, { isActive: false });
    logger.info(`Categoria ${id} desativada (${ticketCount} tickets vinculados)`);
    return {
      deleted: false,
      message: `Categoria desativada: existem ${ticketCount} ticket(s) vinculados ao historico`,
    };
  }

  await categoryRepository.remove(id);
  logger.info(`Categoria ${id} removida permanentemente`);
  return { deleted: true, message: 'Categoria removida com sucesso' };
}
