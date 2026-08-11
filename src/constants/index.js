/**
 * Constantes de dominio.
 *
 * Por que centralizar? Para que a string 'EM_ATENDIMENTO' exista UMA vez no
 * projeto. Espalhada, um `'EM_ATENDIMENTO '` com espaco extra vira um bug
 * silencioso que so aparece em producao.
 */

export const ROLES = Object.freeze({
  CLIENTE: 'CLIENTE',
  ATENDENTE: 'ATENDENTE',
  ADMIN: 'ADMIN',
});

export const ROLE_VALUES = Object.values(ROLES);

/** Papeis que trabalham nos tickets (podem assumir, responder, mudar status). */
export const STAFF_ROLES = Object.freeze([ROLES.ATENDENTE, ROLES.ADMIN]);

export const TICKET_STATUS = Object.freeze({
  ABERTO: 'ABERTO',
  EM_ATENDIMENTO: 'EM_ATENDIMENTO',
  RESOLVIDO: 'RESOLVIDO',
  FECHADO: 'FECHADO',
});

export const TICKET_STATUS_VALUES = Object.values(TICKET_STATUS);

export const TICKET_PRIORITY = Object.freeze({
  BAIXA: 'BAIXA',
  MEDIA: 'MEDIA',
  ALTA: 'ALTA',
  URGENTE: 'URGENTE',
});

export const TICKET_PRIORITY_VALUES = Object.values(TICKET_PRIORITY);

/**
 * MAQUINA DE ESTADOS do ticket.
 *
 * Chave  = status atual
 * Valor  = lista de status para os quais e legal ir a partir dele
 *
 * Isto e o que impede o ticket de virar "um registro que qualquer um edita".
 * Sem esta tabela, um PUT poderia mandar um ticket FECHADO de volta para
 * ABERTO e o relatorio de SLA perderia o sentido.
 *
 *   ABERTO ──> EM_ATENDIMENTO ──> RESOLVIDO ──> FECHADO (terminal)
 *      │              │   ▲            │            ▲
 *      │              └───┘            └────────────┤
 *      └───────────────────────────────────────────-┘
 *        (cliente pode desistir e fechar um ticket ainda nao atendido)
 */
export const STATUS_TRANSITIONS = Object.freeze({
  [TICKET_STATUS.ABERTO]: [TICKET_STATUS.EM_ATENDIMENTO, TICKET_STATUS.FECHADO],
  [TICKET_STATUS.EM_ATENDIMENTO]: [
    TICKET_STATUS.RESOLVIDO,
    TICKET_STATUS.ABERTO, // devolver para a fila
    TICKET_STATUS.FECHADO,
  ],
  [TICKET_STATUS.RESOLVIDO]: [
    TICKET_STATUS.FECHADO,
    TICKET_STATUS.EM_ATENDIMENTO, // reabertura: a solucao nao funcionou
  ],
  // FECHADO e TERMINAL. Um ticket fechado nao volta - abre-se um novo.
  [TICKET_STATUS.FECHADO]: [],
});

/** Peso numerico da prioridade: usado no ORDER BY (urgente primeiro). */
export const PRIORITY_WEIGHT = Object.freeze({
  URGENTE: 4,
  ALTA: 3,
  MEDIA: 2,
  BAIXA: 1,
});

export const PAGINATION = Object.freeze({
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
});
