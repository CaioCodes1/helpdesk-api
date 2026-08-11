import { Router } from 'express';
import * as ticketController from '../controllers/ticket.controller.js';
import * as messageController from '../controllers/message.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { idParamSchema } from '../validators/common.validator.js';
import {
  assignTicketSchema,
  createTicketSchema,
  listTicketsSchema,
  updatePrioritySchema,
  updateStatusSchema,
  updateTicketSchema,
} from '../validators/ticket.validator.js';
import { createMessageSchema, listMessagesSchema } from '../validators/message.validator.js';
import { ROLES } from '../constants/index.js';

const router = Router();

router.use(authenticate);

/**
 * OBSERVACAO SOBRE AUTORIZACAO NESTE ARQUIVO:
 *
 * A maioria destas rotas NAO usa `authorize(...)`. Nao e esquecimento.
 *
 * `authorize` responde "esta ROLE pode chamar esta ROTA?". Para tickets, a
 * pergunta real quase sempre e "este usuario pode mexer NESTE ticket?" - e
 * isso depende do dono, do responsavel e do status atual, ou seja, de dados
 * que so existem depois de consultar o banco. Essa decisao mora no service.
 *
 * `authorize` aparece so onde a role JA basta para decidir - como o DELETE,
 * que e exclusivo do ADMIN em qualquer circunstancia.
 */

// --- Colecao ----------------------------------------------------------------
router.get('/', validate(listTicketsSchema), ticketController.list);
router.post('/', validate(createTicketSchema), ticketController.create);

// --- Recurso ----------------------------------------------------------------
router.get('/:id', validate({ params: idParamSchema }), ticketController.getById);

router.put(
  '/:id',
  validate({ params: idParamSchema, ...updateTicketSchema }),
  ticketController.update,
);

router.delete(
  '/:id',
  authorize(ROLES.ADMIN),
  validate({ params: idParamSchema }),
  ticketController.remove,
);

/**
 * SUB-RECURSOS EM VEZ DE UM PUT GIGANTE.
 *
 * Poderiamos ter so `PUT /tickets/:id` aceitando qualquer campo. Optamos por
 * endpoints de ACAO porque:
 *   1. Cada acao tem regras proprias (transicao de status != trocar titulo).
 *   2. A permissao fica explicita na URL, nao escondida num `if` do service.
 *   3. O log e a auditoria ficam legiveis: da para ver que alguem chamou
 *      /assign, e nao "um PUT com um campo diferente".
 *
 * PATCH e o verbo certo: modificacao parcial de um recurso existente.
 */
router.patch(
  '/:id/status',
  validate({ params: idParamSchema, ...updateStatusSchema }),
  ticketController.updateStatus,
);

router.patch(
  '/:id/priority',
  authorize(ROLES.ATENDENTE, ROLES.ADMIN),
  validate({ params: idParamSchema, ...updatePrioritySchema }),
  ticketController.updatePriority,
);

router.patch(
  '/:id/assign',
  authorize(ROLES.ATENDENTE, ROLES.ADMIN),
  validate({ params: idParamSchema, ...assignTicketSchema }),
  ticketController.assign,
);

/** Atalho para "assumir": POST porque cria uma atribuicao, sem corpo. */
router.post(
  '/:id/claim',
  authorize(ROLES.ATENDENTE, ROLES.ADMIN),
  validate({ params: idParamSchema }),
  ticketController.claim,
);

// --- Mensagens (recurso aninhado) -------------------------------------------
/**
 * `/tickets/:id/messages` e nao `/messages?ticketId=:id`.
 *
 * A URL aninhada expressa a relacao real do dominio: mensagem NAO existe fora
 * de um ticket (a FK tem ON DELETE CASCADE justamente por isso). O caminho da
 * URL deve espelhar a hierarquia dos dados - e uma das poucas regras do REST
 * que valem discussao em entrevista.
 */
router.get(
  '/:id/messages',
  validate({ params: idParamSchema, ...listMessagesSchema }),
  messageController.listByTicket,
);

router.post(
  '/:id/messages',
  validate({ params: idParamSchema, ...createMessageSchema }),
  messageController.create,
);

export default router;
