/**
 * REPOSITORY = a unica camada que conhece SQL.
 *
 * Regras que valem para todos os repositories deste projeto:
 *  1. Nenhum `if` de regra de negocio aqui. Repository nao decide "pode ou
 *     nao pode" - ele so le e escreve. Quem decide e o service.
 *  2. Nenhuma referencia a `req` ou `res`. Repository nao sabe que existe HTTP.
 *  3. Todo valor vindo de fora entra como `?` (prepared statement).
 *
 * O ganho: se um dia migrarmos MySQL -> PostgreSQL, so esta pasta muda.
 */
import { query } from '../config/database.js';

/** Colunas seguras para expor. `password_hash` JAMAIS entra num SELECT publico. */
const PUBLIC_FIELDS = 'id, name, email, role, is_active, created_at, updated_at';

export async function findById(id) {
  const rows = await query(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

/**
 * Usado APENAS no login e na troca de senha, porque so ali precisamos do hash.
 * Manter esta funcao separada de `findByEmail` e proposital: assim ninguem
 * expoe o hash por acidente ao reaproveitar a busca por email.
 */
export async function findByEmailWithPassword(email) {
  const rows = await query(
    `SELECT id, name, email, password_hash, role, is_active FROM users WHERE email = ?`,
    [email],
  );
  return rows[0] ?? null;
}

export async function findByEmail(email) {
  const rows = await query(`SELECT ${PUBLIC_FIELDS} FROM users WHERE email = ?`, [email]);
  return rows[0] ?? null;
}

export async function getPasswordHash(id) {
  const rows = await query('SELECT password_hash FROM users WHERE id = ?', [id]);
  return rows[0]?.password_hash ?? null;
}

export async function create({ name, email, passwordHash, role }) {
  const rows = await query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [name, email, passwordHash, role],
  );
  return findById(rows.insertId);
}

/**
 * UPDATE dinamico.
 *
 * O desafio: `PUT /users/1 { "name": "X" }` deve alterar SO o nome. Um UPDATE
 * fixo com todas as colunas apagaria os campos nao enviados.
 *
 * A solucao: montamos a lista de `coluna = ?` a partir das chaves presentes.
 * Note que os NOMES das colunas vem de um mapa fixo no codigo (nunca do
 * cliente) e os VALORES vao como parametros - as duas metades da defesa
 * contra SQL injection.
 */
export async function update(id, fields) {
  const columnMap = {
    name: 'name',
    email: 'email',
    role: 'role',
    isActive: 'is_active',
    passwordHash: 'password_hash',
  };

  const setClauses = [];
  const values = [];

  for (const [key, value] of Object.entries(fields)) {
    const column = columnMap[key];
    if (!column || value === undefined) continue;
    setClauses.push(`${column} = ?`);
    values.push(value);
  }

  if (setClauses.length === 0) return findById(id);

  values.push(id);
  await query(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`, values);
  return findById(id);
}

export async function remove(id) {
  const result = await query('DELETE FROM users WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

/** Exclusao logica: preserva o historico de tickets e mensagens do usuario. */
export async function deactivate(id) {
  const result = await query('UPDATE users SET is_active = 0 WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

export async function countTicketsOfUser(id) {
  const rows = await query(
    'SELECT COUNT(*) AS total FROM tickets WHERE client_id = ? OR agent_id = ?',
    [id, id],
  );
  return Number(rows[0].total);
}

export async function countByRole(role) {
  const rows = await query(
    'SELECT COUNT(*) AS total FROM users WHERE role = ? AND is_active = 1',
    [role],
  );
  return Number(rows[0].total);
}

/**
 * Listagem com filtros + paginacao.
 *
 * Construcao dinamica de WHERE: comecamos com `1 = 1` (sempre verdadeiro) para
 * poder concatenar todo filtro com ` AND ...` sem checar se e o primeiro.
 * Truque simples que evita um monte de `if` de string.
 */
export async function findAll({ role, isActive, search, limit, offset }) {
  const conditions = ['1 = 1'];
  const params = [];

  if (role) {
    conditions.push('role = ?');
    params.push(role);
  }
  if (isActive !== undefined) {
    conditions.push('is_active = ?');
    params.push(isActive ? 1 : 0);
  }
  if (search) {
    conditions.push('(name LIKE ? OR email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const where = conditions.join(' AND ');

  const totalRows = await query(`SELECT COUNT(*) AS total FROM users WHERE ${where}`, params);

  // LIMIT/OFFSET entram interpolados, e nao como `?`, porque o protocolo de
  // prepared statement do MySQL nao aceita placeholder nessa posicao. E seguro
  // porque `Number.parseInt` garante que so um inteiro chega aqui.
  const safeLimit = Number.parseInt(limit, 10);
  const safeOffset = Number.parseInt(offset, 10);

  const data = await query(
    `SELECT ${PUBLIC_FIELDS}
       FROM users
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params,
  );

  return { data, total: Number(totalRows[0].total) };
}

/** Atendentes e admins ativos - quem pode receber a atribuicao de um ticket. */
export async function findAssignableAgents() {
  return query(
    `SELECT ${PUBLIC_FIELDS}
       FROM users
      WHERE role IN ('ATENDENTE', 'ADMIN') AND is_active = 1
      ORDER BY name ASC`,
  );
}
