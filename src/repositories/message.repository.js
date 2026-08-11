import { query } from '../config/database.js';

const BASE_SELECT = `
  SELECT
    m.id, m.ticket_id, m.content, m.is_internal, m.created_at,
    m.user_id, u.name AS user_name, u.role AS user_role
  FROM ticket_messages m
  INNER JOIN users u ON u.id = m.user_id
`;

/**
 * Aqui o INNER JOIN e correto: `user_id` e NOT NULL e a FK garante que o
 * usuario existe. Nao ha mensagem sem autor, entao nao ha linha a perder.
 */
function mapMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    ticketId: row.ticket_id,
    content: row.content,
    isInternal: Boolean(row.is_internal),
    author: { id: row.user_id, name: row.user_name, role: row.user_role },
    createdAt: row.created_at,
  };
}

/**
 * @param {number} ticketId
 * @param {{ includeInternal: boolean, limit: number, offset: number }} options
 *
 * `includeInternal` e decidido pelo SERVICE a partir da role de quem pediu.
 * O filtro acontece no SQL (e nao em JavaScript depois) porque nao se deve
 * trazer do banco um dado que a pessoa nao pode ver.
 */
export async function findByTicket(ticketId, { includeInternal, limit, offset }) {
  const conditions = ['m.ticket_id = ?'];
  const params = [ticketId];

  if (!includeInternal) conditions.push('m.is_internal = 0');

  const where = conditions.join(' AND ');

  const totalRows = await query(
    `SELECT COUNT(*) AS total FROM ticket_messages m WHERE ${where}`,
    params,
  );

  const safeLimit = Number.parseInt(limit, 10);
  const safeOffset = Number.parseInt(offset, 10);

  const rows = await query(
    `${BASE_SELECT} WHERE ${where} ORDER BY m.created_at ASC, m.id ASC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params,
  );

  return { data: rows.map(mapMessage), total: Number(totalRows[0].total) };
}

export async function findById(id) {
  const rows = await query(`${BASE_SELECT} WHERE m.id = ?`, [id]);
  return mapMessage(rows[0]);
}

export async function create({ ticketId, userId, content, isInternal }) {
  const result = await query(
    'INSERT INTO ticket_messages (ticket_id, user_id, content, is_internal) VALUES (?, ?, ?, ?)',
    [ticketId, userId, content, isInternal ? 1 : 0],
  );
  return findById(result.insertId);
}

export async function countByTicket(ticketId) {
  const rows = await query('SELECT COUNT(*) AS total FROM ticket_messages WHERE ticket_id = ?', [
    ticketId,
  ]);
  return Number(rows[0].total);
}
