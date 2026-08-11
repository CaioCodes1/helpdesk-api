/**
 * Testes unitarios das regras puras (sem banco, sem HTTP).
 *
 * Usamos o test runner NATIVO do Node (`node --test`), disponivel desde a
 * versao 18. Sem Jest, sem Vitest, sem configuracao.
 *
 * Repare no que estamos testando: as regras de dominio isoladas. Isso so e
 * possivel porque elas vivem em modulos que nao dependem de `req`, `res` ou
 * de conexao com o MySQL. Se a maquina de estados estivesse dentro de um
 * controller, este arquivo precisaria subir um servidor e um banco inteiro
 * para verificar uma unica linha de logica.
 *
 * Rodar: npm test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRIORITY_WEIGHT,
  ROLES,
  STAFF_ROLES,
  STATUS_TRANSITIONS,
  TICKET_STATUS,
} from '../src/constants/index.js';
import { buildMeta, parsePagination } from '../src/utils/pagination.js';
import { hashPassword, verifyPassword } from '../src/utils/password.js';

describe('Maquina de estados do ticket', () => {
  it('permite o fluxo feliz completo', () => {
    assert.ok(STATUS_TRANSITIONS.ABERTO.includes(TICKET_STATUS.EM_ATENDIMENTO));
    assert.ok(STATUS_TRANSITIONS.EM_ATENDIMENTO.includes(TICKET_STATUS.RESOLVIDO));
    assert.ok(STATUS_TRANSITIONS.RESOLVIDO.includes(TICKET_STATUS.FECHADO));
  });

  it('bloqueia pular etapas (ABERTO -> RESOLVIDO)', () => {
    assert.ok(!STATUS_TRANSITIONS.ABERTO.includes(TICKET_STATUS.RESOLVIDO));
  });

  it('trata FECHADO como estado terminal', () => {
    assert.equal(STATUS_TRANSITIONS.FECHADO.length, 0);
  });

  it('permite reabrir um ticket resolvido', () => {
    assert.ok(STATUS_TRANSITIONS.RESOLVIDO.includes(TICKET_STATUS.EM_ATENDIMENTO));
  });

  it('permite devolver um ticket em atendimento para a fila', () => {
    assert.ok(STATUS_TRANSITIONS.EM_ATENDIMENTO.includes(TICKET_STATUS.ABERTO));
  });

  it('nao tem estado sem transicao definida', () => {
    for (const status of Object.values(TICKET_STATUS)) {
      assert.ok(Array.isArray(STATUS_TRANSITIONS[status]), `faltou definir ${status}`);
    }
  });
});

describe('Papeis', () => {
  it('considera ATENDENTE e ADMIN como equipe', () => {
    assert.deepEqual(STAFF_ROLES, [ROLES.ATENDENTE, ROLES.ADMIN]);
    assert.ok(!STAFF_ROLES.includes(ROLES.CLIENTE));
  });
});

describe('Ordenacao por prioridade', () => {
  it('coloca URGENTE acima de todas as outras', () => {
    const ordered = ['BAIXA', 'MEDIA', 'ALTA', 'URGENTE'].sort(
      (a, b) => PRIORITY_WEIGHT[b] - PRIORITY_WEIGHT[a],
    );
    assert.deepEqual(ordered, ['URGENTE', 'ALTA', 'MEDIA', 'BAIXA']);
  });
});

describe('Paginacao', () => {
  it('usa os valores padrao quando nada e informado', () => {
    assert.deepEqual(parsePagination({}), { page: 1, limit: 10, offset: 0 });
  });

  it('calcula o offset corretamente', () => {
    assert.equal(parsePagination({ page: 3, limit: 20 }).offset, 40);
  });

  it('ignora entradas nao numericas em vez de gerar NaN no SQL', () => {
    assert.deepEqual(parsePagination({ page: 'abc', limit: 'xyz' }), {
      page: 1,
      limit: 10,
      offset: 0,
    });
  });

  it('impede que um limite absurdo derrube o banco', () => {
    assert.equal(parsePagination({ limit: 999999 }).limit, 100);
  });

  it('rejeita pagina zero ou negativa', () => {
    assert.equal(parsePagination({ page: 0 }).page, 1);
    assert.equal(parsePagination({ page: -5 }).page, 1);
  });

  it('monta o meta com as flags de navegacao', () => {
    const meta = buildMeta({ page: 2, limit: 10, total: 35 });
    assert.equal(meta.totalPages, 4);
    assert.equal(meta.hasPreviousPage, true);
    assert.equal(meta.hasNextPage, true);
  });

  it('nao oferece proxima pagina na ultima', () => {
    const meta = buildMeta({ page: 4, limit: 10, total: 35 });
    assert.equal(meta.hasNextPage, false);
  });
});

describe('Hash de senha', () => {
  it('nunca guarda a senha em texto puro', async () => {
    const hash = await hashPassword('Senha@123');
    assert.notEqual(hash, 'Senha@123');
    assert.ok(hash.startsWith('$2'), 'deve ser um hash bcrypt');
  });

  it('gera hashes diferentes para a mesma senha (salt aleatorio)', async () => {
    const [a, b] = await Promise.all([hashPassword('Senha@123'), hashPassword('Senha@123')]);
    assert.notEqual(a, b);
  });

  it('valida a senha correta', async () => {
    const hash = await hashPassword('Senha@123');
    assert.equal(await verifyPassword('Senha@123', hash), true);
  });

  it('rejeita a senha errada', async () => {
    const hash = await hashPassword('Senha@123');
    assert.equal(await verifyPassword('Senha@124', hash), false);
  });
});
