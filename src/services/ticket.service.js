/**
 * O CORACAO DO SISTEMA.
 *
 * Este arquivo concentra as regras que fazem o Help Desk ser um Help Desk, e
 * nao um CRUD. Cada regra esta comentada com o PORQUE - que e o que voce vai
 * precisar explicar numa entrevista.
 */
import * as ticketRepository from '../repositories/ticket.repository.js';
import * as categoryRepository from '../repositories/category.repository.js';
import * as userRepository from '../repositories/user.repository.js';
import * as messageRepository from '../repositories/message.repository.js';
import { withTransaction } from '../config/database.js';
import {
  ROLES,
  STAFF_ROLES,
  STATUS_TRANSITIONS,
  TICKET_PRIORITY,
  TICKET_STATUS,
} from '../constants/index.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../errors/AppError.js';
import { buildMeta, parsePagination } from '../utils/pagination.js';
import { logger } from '../utils/logger.js';

const isStaff = (user) => STAFF_ROLES.includes(user.role);

// ===========================================================================
// LEITURA
// ===========================================================================

/**
 * REGRA 1 - ESCOPO DE VISIBILIDADE.
 *
 * O filtro de propriedade e aplicado ANTES de ir ao banco: para um CLIENTE,
 * forcamos `clientId = ele mesmo`, sobrescrevendo qualquer valor que ele tenha
 * mandado na query string.
 *
 * Por que forcar em vez de checar depois? Porque assim e IMPOSSIVEL vazar
 * dados: a query nem chega a selecionar ticket de outra pessoa. Filtrar em
 * JavaScript depois de buscar tudo funcionaria, mas seria lento e uma linha
 * esquecida viraria vazamento.
 */
export async function list(filters, actor) {
  const { page, limit, offset } = parsePagination(filters);
  const effectiveFilters = { ...filters, limit, offset };

  if (actor.role === ROLES.CLIENTE) {
    effectiveFilters.clientId = actor.id;
    effectiveFilters.agentId = undefined; // cliente nao filtra por atendente
  } else if (filters.assignedToMe) {
    effectiveFilters.agentId = actor.id;
  }

  const { data, total } = await ticketRepository.findAll(effectiveFilters);
  return { data, meta: buildMeta({ page, limit, total }) };
}

export async function getById(id, actor) {
  const ticket = await ticketRepository.findById(id);
  if (!ticket) throw new NotFoundError('Ticket');

  assertCanView(ticket, actor);
  return ticket;
}

/**
 * REGRA 2 - OWNERSHIP (a checagem que o middleware NAO consegue fazer).
 *
 * O middleware `authorize` so sabe a role. Ele responde "CLIENTE pode acessar
 * GET /api/tickets/:id?" - sim, pode. O que ele nao sabe responder e "este
 * cliente e dono DESTE ticket?", porque isso exige buscar o ticket primeiro.
 *
 * Sem esta funcao, o cliente 5 leria o ticket do cliente 9 so trocando o id na
 * URL. Essa falha tem nome: IDOR (Insecure Direct Object Reference), e esta no
 * OWASP Top 10.
 */
function assertCanView(ticket, actor) {
  if (isStaff(actor)) return; // atendente e admin veem todos
  if (ticket.client.id !== actor.id) {
    // 404 em vez de 403 de proposito: um 403 confirmaria que o ticket existe,
    // o que ja e informacao demais para quem nao deveria ve-lo.
    throw new NotFoundError('Ticket');
  }
}

// ===========================================================================
// CRIACAO
// ===========================================================================

export async function create(payload, actor) {
  const { title, description, categoryId, priority, clientId } = payload;

  // REGRA 3 - Quem e o dono do ticket.
  // Um CLIENTE so abre chamado para si mesmo. Um ADMIN pode abrir em nome de
  // um cliente (caso real: chamado aberto por telefone). Um ATENDENTE nao abre
  // chamados - ele os atende.
  let ownerId = actor.id;

  if (actor.role === ROLES.ADMIN && clientId) {
    const client = await userRepository.findById(clientId);
    if (!client) throw new NotFoundError('Cliente informado');
    if (client.role !== ROLES.CLIENTE) {
      throw new BadRequestError('O responsavel pelo ticket deve ser um usuario com role CLIENTE');
    }
    if (!client.is_active) throw new BadRequestError('O cliente informado esta desativado');
    ownerId = client.id;
  } else if (actor.role === ROLES.ATENDENTE) {
    throw new ForbiddenError(
      'Atendentes nao abrem chamados. Peca a um administrador para abrir em nome do cliente.',
    );
  } else if (clientId && clientId !== actor.id) {
    throw new ForbiddenError('Voce so pode abrir tickets em seu proprio nome');
  }

  // REGRA 4 - A categoria precisa existir E estar ativa.
  // A FK garante que ela existe; nao garante que esta ativa. Categoria
  // desativada e uma decisao de negocio ("nao aceitamos mais chamados disso"),
  // e o banco nao sabe nada sobre isso.
  const category = await categoryRepository.findById(categoryId);
  if (!category) throw new NotFoundError('Categoria');
  if (!category.is_active) {
    throw new BadRequestError('Esta categoria esta desativada e nao aceita novos tickets');
  }

  // REGRA 5 - O cliente NAO escolhe prioridade URGENTE.
  // Se pudesse, todo mundo marcaria urgente e a fila perderia o sentido. Quem
  // classifica a urgencia e a equipe de atendimento.
  let effectivePriority = priority ?? TICKET_PRIORITY.MEDIA;
  if (actor.role === ROLES.CLIENTE && effectivePriority === TICKET_PRIORITY.URGENTE) {
    effectivePriority = TICKET_PRIORITY.ALTA;
  }

  // TRANSACAO: o ticket e a primeira mensagem (a descricao do problema) sao
  // um evento so. Se a mensagem falhar, nao queremos um ticket sem historico.
  const ticket = await withTransaction(async (connection) => {
    const [result] = await connection.execute(
      `INSERT INTO tickets (title, description, category_id, client_id, priority)
       VALUES (?, ?, ?, ?, ?)`,
      [title, description, categoryId, ownerId, effectivePriority],
    );

    await connection.execute(
      'INSERT INTO ticket_messages (ticket_id, user_id, content) VALUES (?, ?, ?)',
      [result.insertId, ownerId, description],
    );

    return result.insertId;
  });

  logger.info(`Ticket #${ticket} criado por ${actor.email} (cliente ${ownerId})`);
  return ticketRepository.findById(ticket);
}

// ===========================================================================
// ATUALIZACAO DE CONTEUDO
// ===========================================================================

/**
 * REGRA 6 - Quem edita o que.
 *
 * O cliente e dono do TEXTO (titulo/descricao), mas so enquanto ninguem
 * comecou a trabalhar - depois disso, mudar o enunciado do problema no meio do
 * atendimento invalidaria a conversa ja registrada.
 *
 * A equipe e dona da CLASSIFICACAO (categoria/prioridade), porque e ela quem
 * conhece a operacao.
 */
export async function update(id, fields, actor) {
  const ticket = await ticketRepository.findById(id);
  if (!ticket) throw new NotFoundError('Ticket');
  assertCanView(ticket, actor);

  assertNotClosed(ticket);

  if (actor.role === ROLES.CLIENTE) {
    if (ticket.status !== TICKET_STATUS.ABERTO) {
      throw new ConflictError(
        'O ticket so pode ser editado enquanto estiver com status ABERTO',
      );
    }
    const forbidden = ['priority', 'categoryId'].filter((field) => fields[field] !== undefined);
    if (forbidden.length > 0) {
      throw new ForbiddenError(
        `Clientes nao podem alterar: ${forbidden.join(', ')}. Solicite ao atendente.`,
      );
    }
  }

  if (fields.categoryId) {
    const category = await categoryRepository.findById(fields.categoryId);
    if (!category) throw new NotFoundError('Categoria');
    if (!category.is_active) throw new BadRequestError('Categoria desativada');
  }

  return ticketRepository.update(id, fields);
}

/**
 * REGRA 7 - Prioridade e decisao da equipe.
 */
export async function updatePriority(id, priority, actor) {
  const ticket = await ticketRepository.findById(id);
  if (!ticket) throw new NotFoundError('Ticket');

  if (!isStaff(actor)) {
    throw new ForbiddenError('Apenas atendentes e administradores alteram a prioridade');
  }

  assertNotClosed(ticket);

  logger.info(`Prioridade do ticket #${id}: ${ticket.priority} -> ${priority} (${actor.email})`);
  return ticketRepository.update(id, { priority });
}

// ===========================================================================
// MAQUINA DE ESTADOS
// ===========================================================================

/**
 * REGRA 8 - TRANSICOES DE STATUS.
 *
 * Duas perguntas independentes, nesta ordem:
 *   1. A transicao e LEGAL? (ABERTO -> RESOLVIDO nao e: alguem tem que atender)
 *   2. QUEM esta pedindo pode faze-la?
 *
 * Separar as duas evita `if`s gigantes e deixa o codigo espelhar a regra real.
 */
export async function updateStatus(id, newStatus, actor) {
  const ticket = await ticketRepository.findById(id);
  if (!ticket) throw new NotFoundError('Ticket');
  assertCanView(ticket, actor);

  const currentStatus = ticket.status;

  if (currentStatus === newStatus) {
    throw new ConflictError(`O ticket ja esta com status ${newStatus}`);
  }

  // --- 1. A transicao existe no fluxo? ------------------------------------
  const allowed = STATUS_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new ConflictError(
      allowed.length === 0
        ? `Tickets com status ${currentStatus} nao podem mudar de status (estado final)`
        : `Transicao invalida: ${currentStatus} -> ${newStatus}. ` +
          `A partir de ${currentStatus} so e possivel ir para: ${allowed.join(', ')}.`,
    );
  }

  // --- 2. Quem pode executar esta transicao? ------------------------------
  if (actor.role === ROLES.CLIENTE) {
    const clientAllowed =
      newStatus === TICKET_STATUS.FECHADO ||
      // reabertura: "a solucao nao resolveu"
      (currentStatus === TICKET_STATUS.RESOLVIDO && newStatus === TICKET_STATUS.EM_ATENDIMENTO);

    if (!clientAllowed) {
      throw new ForbiddenError(
        'Como cliente, voce so pode fechar o ticket ou reabrir um ticket resolvido',
      );
    }
  }

  // --- 3. Efeitos colaterais da transicao ---------------------------------
  const changes = { status: newStatus };

  // Comecar a atender exige um responsavel. Se ninguem assumiu ainda e quem
  // esta mudando o status e da equipe, ele assume automaticamente - e o
  // comportamento natural de "clicar em atender".
  if (newStatus === TICKET_STATUS.EM_ATENDIMENTO) {
    if (!ticket.agent && isStaff(actor)) {
      changes.agentId = actor.id;
    }
    if (!ticket.agent && !isStaff(actor)) {
      throw new ConflictError(
        'Este ticket precisa de um atendente responsavel antes de entrar em atendimento',
      );
    }
    // Reabertura: as datas de conclusao deixam de valer.
    changes.resolvedAt = null;
    changes.closedAt = null;
  }

  // Carimbamos o INSTANTE de cada marco. Sao esses campos que alimentam as
  // metricas de tempo medio de resolucao no dashboard.
  if (newStatus === TICKET_STATUS.RESOLVIDO) {
    changes.resolvedAt = new Date();
    changes.closedAt = null;
  }

  if (newStatus === TICKET_STATUS.FECHADO) {
    changes.closedAt = new Date();
    // Fechado sem passar por RESOLVIDO (ex.: cliente desistiu): nao ha
    // resolucao, entao `resolved_at` continua NULL e o ticket nao entra na
    // media de tempo de resolucao. Isso mantem a metrica honesta.
  }

  logger.info(`Ticket #${id}: ${currentStatus} -> ${newStatus} por ${actor.email}`);
  return ticketRepository.update(id, changes);
}

// ===========================================================================
// ATRIBUICAO
// ===========================================================================

/**
 * REGRA 9 - ATRIBUICAO DE ATENDENTE.
 *
 * `agentId: null` desatribui (devolve o ticket para a fila).
 */
export async function assign(id, agentId, actor) {
  const ticket = await ticketRepository.findById(id);
  if (!ticket) throw new NotFoundError('Ticket');

  // Cliente nunca atribui ticket a ninguem - ele nao conhece a equipe nem a
  // carga de trabalho de cada um.
  if (!isStaff(actor)) {
    throw new ForbiddenError('Apenas atendentes e administradores atribuem tickets');
  }

  assertNotClosed(ticket);

  // Desatribuir
  if (agentId === null) {
    if (actor.role !== ROLES.ADMIN && ticket.agent?.id !== actor.id) {
      throw new ForbiddenError('Voce so pode devolver a fila um ticket que e seu');
    }
    logger.info(`Ticket #${id} devolvido a fila por ${actor.email}`);
    return ticketRepository.update(id, { agentId: null, status: TICKET_STATUS.ABERTO });
  }

  // REGRA 11 - Um ATENDENTE so atribui a si mesmo ("assumir").
  // Redistribuir o trabalho da equipe e prerrogativa do ADMIN.
  //
  // ORDEM IMPORTA: a checagem de PERMISSAO vem antes da validacao dos DADOS.
  // Se fosse o contrario, um atendente sem permissao descobriria, pela
  // diferenca entre 400 e 404, quais ids de usuario existem no sistema - e
  // ainda gastariamos uma consulta ao banco para responder a alguem que nao
  // podia fazer a operacao de qualquer forma. Autorizacao primeiro, sempre.
  if (actor.role === ROLES.ATENDENTE && agentId !== actor.id) {
    throw new ForbiddenError(
      'Atendentes so podem assumir tickets para si. Apenas o admin reatribui para terceiros.',
    );
  }

  // REGRA 10 - O responsavel NAO pode ser um CLIENTE.
  // Esta e a checagem que o banco nao faz por nos: a FK garante que agent_id
  // aponta para um usuario existente, mas nao sabe nada sobre roles.
  const agent = await userRepository.findById(agentId);
  if (!agent) throw new NotFoundError('Atendente');
  if (agent.role === ROLES.CLIENTE) {
    throw new BadRequestError('Um ticket nao pode ser atribuido a um usuario com role CLIENTE');
  }
  if (!agent.is_active) {
    throw new BadRequestError('Nao e possivel atribuir tickets a um usuario desativado');
  }

  // REGRA 12 - Nao roubar ticket de colega.
  if (ticket.agent && ticket.agent.id !== agentId && actor.role !== ROLES.ADMIN) {
    throw new ConflictError(
      `Este ticket ja esta sendo atendido por ${ticket.agent.name}. Peca ao admin para reatribuir.`,
    );
  }

  const changes = { agentId };

  // Assumir um ticket que estava na fila ja o coloca em atendimento: sao a
  // mesma acao do ponto de vista de quem trabalha nele.
  if (ticket.status === TICKET_STATUS.ABERTO) {
    changes.status = TICKET_STATUS.EM_ATENDIMENTO;
  }

  logger.info(`Ticket #${id} atribuido ao atendente ${agentId} por ${actor.email}`);
  return ticketRepository.update(id, changes);
}

/** Atalho: `POST /tickets/:id/claim` - o atendente assume o ticket. */
export async function claim(id, actor) {
  return assign(id, actor.id, actor);
}

// ===========================================================================
// EXCLUSAO
// ===========================================================================

/**
 * REGRA 13 - Apagar ticket e excecao, nao rotina.
 *
 * Apenas ADMIN, e apenas para spam/duplicidade. O fluxo normal e FECHAR, que
 * preserva o historico. As mensagens somem junto pelo ON DELETE CASCADE.
 */
export async function remove(id, actor) {
  const ticket = await ticketRepository.findById(id);
  if (!ticket) throw new NotFoundError('Ticket');

  if (actor.role !== ROLES.ADMIN) {
    throw new ForbiddenError(
      'Apenas administradores excluem tickets. Feche o ticket para encerra-lo.',
    );
  }

  const messageCount = await messageRepository.countByTicket(id);
  await ticketRepository.remove(id);

  logger.warn(
    `Ticket #${id} EXCLUIDO por ${actor.email} (${messageCount} mensagens removidas em cascata)`,
  );
  return { deleted: true };
}

// ===========================================================================
// HELPERS DE REGRA
// ===========================================================================

/**
 * REGRA 14 - Ticket FECHADO e imutavel.
 *
 * Um ticket fechado e um registro historico. Se pudesse ser editado, nenhum
 * relatorio ou auditoria valeria nada. Quem precisa de mais atendimento abre
 * um novo chamado.
 */
function assertNotClosed(ticket) {
  if (ticket.status === TICKET_STATUS.FECHADO) {
    throw new ConflictError(
      'Este ticket esta FECHADO e nao pode mais ser alterado. Abra um novo chamado.',
    );
  }
}

export { assertCanView, assertNotClosed, isStaff };
