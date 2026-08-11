import { query } from '../config/database.js';

/**
 * SELECT base dos tickets.
 *
 * Note os DOIS joins na tabela `users`:
 *   LEFT JOIN users c  -> o cliente dono do ticket
 *   LEFT JOIN users a  -> o atendente responsavel
 *
 * Sao a mesma tabela, entao o ALIAS (c / a) e obrigatorio: sem ele o MySQL nao
 * saberia a qual `users.name` nos referimos.
 *
 * Por que LEFT JOIN e nao INNER JOIN?
 *   * `agent_id` pode ser NULL (ticket ainda na fila). Com INNER JOIN, esses
 *     tickets DESAPARECERIAM do resultado - bug classico e dificil de notar.
 *   * Para cliente e categoria (que sao NOT NULL) o INNER daria no mesmo;
 *     mantemos LEFT por consistencia e para nao esconder dados se algum dia
 *     uma FK for afrouxada.
 */
const BASE_SELECT = `
  SELECT
    t.id, t.title, t.description, t.status, t.priority,
    t.created_at, t.updated_at, t.resolved_at, t.closed_at,
    t.category_id, cat.name AS category_name,
    t.client_id, c.name AS client_name, c.email AS client_email,
    t.agent_id,  a.name AS agent_name,  a.email AS agent_email
  FROM tickets t
  LEFT JOIN categories cat ON cat.id = t.category_id
  LEFT JOIN users c        ON c.id   = t.client_id
  LEFT JOIN users a        ON a.id   = t.agent_id
`;

/**
 * Converte a linha "achatada" do SQL no objeto aninhado que a API expoe.
 *
 * O banco devolve `client_name`; a API devolve `client: { id, name }`. Essa
 * traducao acontece AQUI para que o resto do sistema trabalhe com um formato
 * so - e para que mudar a query nao quebre o contrato publico da API.
 */
function mapTicket(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    category: { id: row.category_id, name: row.category_name },
    client: { id: row.client_id, name: row.client_name, email: row.client_email },
    agent: row.agent_id
      ? { id: row.agent_id, name: row.agent_name, email: row.agent_email }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
  };
}

/**
 * `FIELD()` do MySQL devolve a POSICAO do valor na lista.
 * FIELD(priority,'BAIXA','MEDIA','ALTA','URGENTE') vira 1,2,3,4.
 * Ordenando por ele em DESC, URGENTE vem primeiro - que e exatamente a regra
 * de negocio pedida. Sem isso, o ORDER BY seria alfabetico e 'ALTA' viria
 * antes de 'URGENTE', o que nao faz sentido nenhum para o atendente.
 */
const PRIORITY_ORDER = `FIELD(t.priority, 'BAIXA', 'MEDIA', 'ALTA', 'URGENTE')`;

/** Whitelist: unico caminho entre `sortBy` da URL e uma coluna real. */
const SORT_COLUMNS = {
  createdAt: 't.created_at',
  updatedAt: 't.updated_at',
  priority: PRIORITY_ORDER,
  status: `FIELD(t.status, 'ABERTO', 'EM_ATENDIMENTO', 'RESOLVIDO', 'FECHADO')`,
};

export async function findById(id) {
  const rows = await query(`${BASE_SELECT} WHERE t.id = ?`, [id]);
  return mapTicket(rows[0]);
}

/** Versao "crua", sem JOINs: usada quando o service so precisa checar regras. */
export async function findRawById(id) {
  const rows = await query(
    'SELECT id, status, priority, client_id, agent_id, category_id FROM tickets WHERE id = ?',
    [id],
  );
  return rows[0] ?? null;
}

export async function create({ title, description, categoryId, clientId, priority }) {
  const result = await query(
    `INSERT INTO tickets (title, description, category_id, client_id, priority)
     VALUES (?, ?, ?, ?, ?)`,
    [title, description, categoryId, clientId, priority],
  );
  return findById(result.insertId);
}

export async function update(id, fields) {
  const columnMap = {
    title: 'title',
    description: 'description',
    categoryId: 'category_id',
    priority: 'priority',
    status: 'status',
    agentId: 'agent_id',
    resolvedAt: 'resolved_at',
    closedAt: 'closed_at',
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
  await query(`UPDATE tickets SET ${setClauses.join(', ')} WHERE id = ?`, values);
  return findById(id);
}

export async function remove(id) {
  // As mensagens somem junto por causa do ON DELETE CASCADE definido no schema.
  const result = await query('DELETE FROM tickets WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

/**
 * Listagem com filtros, busca, ordenacao e paginacao.
 *
 * A montagem do WHERE e feita em partes para que os filtros sejam combinaveis:
 * ?status=ABERTO&priority=URGENTE&categoryId=2 funciona sem nenhum tratamento
 * especial de combinacoes.
 */
export async function findAll(filters) {
  const {
    status,
    priority,
    categoryId,
    clientId,
    agentId,
    unassigned,
    search,
    createdFrom,
    createdTo,
    sortBy,
    sortOrder = 'DESC',
    limit,
    offset,
  } = filters;

  const conditions = ['1 = 1'];
  const params = [];

  if (status?.length) {
    // Um `?` para cada item: IN (?, ?, ?). Nunca `IN (${array.join(',')})`.
    conditions.push(`t.status IN (${status.map(() => '?').join(', ')})`);
    params.push(...status);
  }
  if (priority?.length) {
    conditions.push(`t.priority IN (${priority.map(() => '?').join(', ')})`);
    params.push(...priority);
  }
  if (categoryId) {
    conditions.push('t.category_id = ?');
    params.push(categoryId);
  }
  if (clientId) {
    conditions.push('t.client_id = ?');
    params.push(clientId);
  }
  if (agentId) {
    conditions.push('t.agent_id = ?');
    params.push(agentId);
  }
  if (unassigned) {
    conditions.push('t.agent_id IS NULL');
  }
  if (search) {
    conditions.push('(t.title LIKE ? OR t.description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (createdFrom) {
    conditions.push('t.created_at >= ?');
    params.push(`${createdFrom} 00:00:00`);
  }
  if (createdTo) {
    conditions.push('t.created_at <= ?');
    params.push(`${createdTo} 23:59:59`);
  }

  const where = conditions.join(' AND ');

  const totalRows = await query(
    `SELECT COUNT(*) AS total FROM tickets t WHERE ${where}`,
    params,
  );

  // ORDENACAO PADRAO (a regra "tickets urgentes aparecem primeiro"):
  // 1o pela prioridade, do mais urgente ao menos; 2o pelo mais recente.
  // Se o cliente pediu um sortBy explicito, ele vem antes do desempate.
  const direction = sortOrder === 'ASC' ? 'ASC' : 'DESC';
  const orderBy = sortBy
    ? `${SORT_COLUMNS[sortBy]} ${direction}, t.created_at DESC`
    : `${PRIORITY_ORDER} DESC, t.created_at DESC`;

  const safeLimit = Number.parseInt(limit, 10);
  const safeOffset = Number.parseInt(offset, 10);

  const rows = await query(
    `${BASE_SELECT} WHERE ${where} ORDER BY ${orderBy} LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params,
  );

  return { data: rows.map(mapTicket), total: Number(totalRows[0].total) };
}
