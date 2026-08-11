import * as messageRepository from '../repositories/message.repository.js';
import * as ticketRepository from '../repositories/ticket.repository.js';
import { assertCanView, isStaff } from './ticket.service.js';
import { ROLES, TICKET_STATUS } from '../constants/index.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors/AppError.js';
import { buildMeta, parsePagination } from '../utils/pagination.js';
import { logger } from '../utils/logger.js';

/**
 * REGRA 15 - Ver a conversa exige poder ver o ticket.
 *
 * Repare que reaproveitamos `assertCanView` do ticket.service em vez de
 * reescrever a checagem. Uma regra duplicada e uma regra que um dia vai
 * divergir - e a versao esquecida vira a brecha de seguranca.
 */
export async function listByTicket(ticketId, queryParams, actor) {
  const ticket = await ticketRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError('Ticket');
  assertCanView(ticket, actor);

  const { page, limit, offset } = parsePagination(queryParams);

  // REGRA 16 - Notas internas nao vazam para o cliente.
  // O filtro vai para o SQL: dado que o cliente nao pode ver nem sequer sai do
  // banco. Filtrar depois, em JavaScript, seria uma linha de codigo de
  // distancia de um vazamento.
  const { data, total } = await messageRepository.findByTicket(ticketId, {
    includeInternal: isStaff(actor),
    limit,
    offset,
  });

  return { data, meta: buildMeta({ page, limit, total }) };
}

export async function create(ticketId, { content, isInternal }, actor) {
  const ticket = await ticketRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError('Ticket');
  assertCanView(ticket, actor);

  // REGRA 17 - Ticket FECHADO nao recebe mensagem.
  // Este e o requisito literal do enunciado, e faz sentido: encerrado e
  // encerrado. Para continuar a conversa, abre-se um novo ticket.
  if (ticket.status === TICKET_STATUS.FECHADO) {
    throw new ConflictError(
      'Este ticket esta FECHADO e nao aceita novas mensagens. Abra um novo chamado.',
    );
  }

  // REGRA 18 - Nota interna e privilegio da equipe.
  if (isInternal && !isStaff(actor)) {
    throw new ForbiddenError('Apenas atendentes e administradores criam notas internas');
  }

  const message = await messageRepository.create({
    ticketId,
    userId: actor.id,
    content,
    isInternal: Boolean(isInternal),
  });

  await applySideEffects(ticket, actor, isInternal);

  logger.info(`Mensagem #${message.id} criada no ticket #${ticketId} por ${actor.email}`);
  return message;
}

/**
 * REGRAS 19 e 20 - Efeitos colaterais de uma nova mensagem.
 *
 * Sao dois comportamentos que qualquer help desk real tem, e que transformam
 * a lista de mensagens num fluxo de trabalho de verdade:
 *
 *  19. Se o CLIENTE responde um ticket ja RESOLVIDO, isso significa que a
 *      solucao nao funcionou -> o ticket volta para EM_ATENDIMENTO
 *      automaticamente. Sem isso, a resposta dele ficaria invisivel na fila.
 *
 *  20. Se um ATENDENTE responde publicamente um ticket ABERTO e sem dono, ele
 *      esta de fato iniciando o atendimento -> assume o ticket e move para
 *      EM_ATENDIMENTO. Nota INTERNA nao dispara isso (e so um rascunho da
 *      equipe, nao um atendimento comecando).
 */
async function applySideEffects(ticket, actor, isInternal) {
  if (actor.role === ROLES.CLIENTE && ticket.status === TICKET_STATUS.RESOLVIDO) {
    await ticketRepository.update(ticket.id, {
      status: TICKET_STATUS.EM_ATENDIMENTO,
      resolvedAt: null,
    });
    logger.info(`Ticket #${ticket.id} reaberto automaticamente: cliente respondeu apos resolucao`);
    return;
  }

  if (isStaff(actor) && !isInternal && ticket.status === TICKET_STATUS.ABERTO) {
    await ticketRepository.update(ticket.id, {
      status: TICKET_STATUS.EM_ATENDIMENTO,
      agentId: ticket.agent?.id ?? actor.id,
    });
    logger.info(`Ticket #${ticket.id} entrou em atendimento: ${actor.email} respondeu`);
  }
}
