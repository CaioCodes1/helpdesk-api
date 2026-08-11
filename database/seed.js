/**
 * Popula o banco com dados de demonstracao.
 *
 * Por que um script .js e nao um seed.sql?
 * Porque as senhas precisam ser passadas pelo bcrypt. Um hash bcrypt e
 * diferente a cada execucao (tem salt aleatorio embutido), entao nao daria
 * para deixar hashes fixos num arquivo .sql.
 *
 * Uso: npm run db:seed   (roda depois de npm run db:migrate)
 */
import { pool } from '../src/config/database.js';
import { hashPassword } from '../src/utils/password.js';

const DEMO_PASSWORD = 'Senha@123';

const CATEGORIES = [
  ['Problema técnico', 'Falhas, erros e indisponibilidade do sistema'],
  ['Pagamento', 'Cobranças, faturas, estornos e reembolsos'],
  ['Entrega', 'Prazos, rastreio e extravio de pedidos'],
  ['Conta', 'Acesso, cadastro, senha e dados pessoais'],
  ['Produto', 'Dúvidas e defeitos sobre produtos'],
  ['Outros', 'Assuntos que não se encaixam nas demais categorias'],
];

const USERS = [
  ['Ana Admin', 'admin@helpdesk.com', 'ADMIN'],
  ['Bruno Atendente', 'bruno@helpdesk.com', 'ATENDENTE'],
  ['Carla Atendente', 'carla@helpdesk.com', 'ATENDENTE'],
  ['Diego Cliente', 'diego@cliente.com', 'CLIENTE'],
  ['Elisa Cliente', 'elisa@cliente.com', 'CLIENTE'],
];

async function seed() {
  const connection = await pool.getConnection();

  try {
    // Uma transacao: ou todo o seed entra, ou nada entra.
    await connection.beginTransaction();

    // Limpa na ordem inversa das FKs.
    await connection.query('DELETE FROM ticket_messages');
    await connection.query('DELETE FROM tickets');
    await connection.query('DELETE FROM categories');
    await connection.query('DELETE FROM users');
    await connection.query('ALTER TABLE users AUTO_INCREMENT = 1');
    await connection.query('ALTER TABLE categories AUTO_INCREMENT = 1');
    await connection.query('ALTER TABLE tickets AUTO_INCREMENT = 1');

    // --- categorias --------------------------------------------------------
    const categoryIds = {};
    for (const [name, description] of CATEGORIES) {
      const [result] = await connection.execute(
        'INSERT INTO categories (name, description) VALUES (?, ?)',
        [name, description],
      );
      categoryIds[name] = result.insertId;
    }

    // --- usuarios ----------------------------------------------------------
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const userIds = {};
    for (const [name, email, role] of USERS) {
      const [result] = await connection.execute(
        'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [name, email, passwordHash, role],
      );
      userIds[email] = result.insertId;
    }

    // --- tickets -----------------------------------------------------------
    const tickets = [
      {
        title: 'Meu pedido ainda não chegou',
        description:
          'Comprei no dia 02 e o prazo era de 3 dias úteis. O rastreio não atualiza desde sexta.',
        status: 'EM_ATENDIMENTO',
        priority: 'ALTA',
        category: 'Entrega',
        client: 'diego@cliente.com',
        agent: 'bruno@helpdesk.com',
        messages: [
          ['diego@cliente.com', 'Meu pedido ainda não chegou.', 0],
          ['bruno@helpdesk.com', 'Olá! Vou verificar o status do pedido.', 0],
          ['bruno@helpdesk.com', 'Transportadora reportou atraso na região.', 1],
          ['diego@cliente.com', 'Obrigado.', 0],
        ],
      },
      {
        title: 'Cobrança duplicada no cartão',
        description: 'Fui cobrado duas vezes pelo mesmo pedido #8842.',
        status: 'ABERTO',
        priority: 'URGENTE',
        category: 'Pagamento',
        client: 'elisa@cliente.com',
        agent: null,
        messages: [['elisa@cliente.com', 'Preciso do estorno com urgência.', 0]],
      },
      {
        title: 'Não consigo redefinir minha senha',
        description: 'O e-mail de recuperação nunca chega na minha caixa.',
        status: 'RESOLVIDO',
        priority: 'MEDIA',
        category: 'Conta',
        client: 'diego@cliente.com',
        agent: 'carla@helpdesk.com',
        messages: [
          ['diego@cliente.com', 'O e-mail de recuperação não chega.', 0],
          ['carla@helpdesk.com', 'Estava caindo no spam. Reenviei, confere?', 0],
          ['diego@cliente.com', 'Chegou! Consegui trocar a senha.', 0],
        ],
      },
      {
        title: 'Sistema fora do ar pela manhã',
        description: 'Das 09h às 09h40 o painel retornava erro 500.',
        status: 'FECHADO',
        priority: 'URGENTE',
        category: 'Problema técnico',
        client: 'elisa@cliente.com',
        agent: 'bruno@helpdesk.com',
        messages: [
          ['elisa@cliente.com', 'O painel está retornando erro 500.', 0],
          ['bruno@helpdesk.com', 'Incidente identificado e corrigido.', 0],
        ],
      },
      {
        title: 'Dúvida sobre garantia do produto',
        description: 'A garantia cobre defeito de fábrica após 6 meses?',
        status: 'ABERTO',
        priority: 'BAIXA',
        category: 'Produto',
        client: 'diego@cliente.com',
        agent: null,
        messages: [],
      },
    ];

    for (const ticket of tickets) {
      const resolvedAt =
        ticket.status === 'RESOLVIDO' || ticket.status === 'FECHADO'
          ? 'DATE_SUB(NOW(), INTERVAL 20 HOUR)'
          : 'NULL';
      const closedAt =
        ticket.status === 'FECHADO' ? 'DATE_SUB(NOW(), INTERVAL 2 HOUR)' : 'NULL';

      const [result] = await connection.execute(
        `INSERT INTO tickets
           (title, description, status, priority, category_id, client_id, agent_id,
            created_at, resolved_at, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL 2 DAY), ${resolvedAt}, ${closedAt})`,
        [
          ticket.title,
          ticket.description,
          ticket.status,
          ticket.priority,
          categoryIds[ticket.category],
          userIds[ticket.client],
          ticket.agent ? userIds[ticket.agent] : null,
        ],
      );

      for (const [email, content, isInternal] of ticket.messages) {
        await connection.execute(
          'INSERT INTO ticket_messages (ticket_id, user_id, content, is_internal) VALUES (?, ?, ?, ?)',
          [result.insertId, userIds[email], content, isInternal],
        );
      }
    }

    await connection.commit();

    console.log('[seed] dados de demonstracao inseridos com sucesso');
    console.log(`[seed] senha de todos os usuarios: ${DEMO_PASSWORD}`);
    console.table(USERS.map(([name, email, role]) => ({ name, email, role })));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

seed().catch((error) => {
  console.error('[seed] falhou:', error.message);
  process.exit(1);
});
