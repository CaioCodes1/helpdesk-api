import { query } from '../config/database.js';

const FIELDS = 'id, name, description, is_active, created_at, updated_at';

export async function findAll({ includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE is_active = 1';
  return query(`SELECT ${FIELDS} FROM categories ${where} ORDER BY name ASC`);
}

export async function findById(id) {
  const rows = await query(`SELECT ${FIELDS} FROM categories WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

export async function findByName(name) {
  const rows = await query(`SELECT ${FIELDS} FROM categories WHERE name = ?`, [name]);
  return rows[0] ?? null;
}

export async function create({ name, description }) {
  const result = await query('INSERT INTO categories (name, description) VALUES (?, ?)', [
    name,
    description ?? null,
  ]);
  return findById(result.insertId);
}

export async function update(id, fields) {
  const columnMap = { name: 'name', description: 'description', isActive: 'is_active' };
  const setClauses = [];
  const values = [];

  for (const [key, value] of Object.entries(fields)) {
    const column = columnMap[key];
    if (!column || value === undefined) continue;
    setClauses.push(`${column} = ?`);
    values.push(key === 'isActive' ? (value ? 1 : 0) : value);
  }

  if (setClauses.length === 0) return findById(id);

  values.push(id);
  await query(`UPDATE categories SET ${setClauses.join(', ')} WHERE id = ?`, values);
  return findById(id);
}

export async function remove(id) {
  const result = await query('DELETE FROM categories WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

/**
 * Existe para o service decidir entre exclusao FISICA e LOGICA.
 * Se a categoria ja tem tickets, apagar de vez quebraria a FK (e o banco
 * recusaria com ER_ROW_IS_REFERENCED). Entao desativamos.
 */
export async function countTickets(id) {
  const rows = await query('SELECT COUNT(*) AS total FROM tickets WHERE category_id = ?', [id]);
  return Number(rows[0].total);
}
