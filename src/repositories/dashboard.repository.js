/**
 * Consultas analiticas do dashboard.
 *
 * Aqui aparece a diferenca entre "saber SQL" e "saber usar SQL":
 * a tentacao e buscar todos os tickets e contar em JavaScript. Isso significa
 * trazer 100 mil linhas pela rede para produzir 5 numeros. Agregacao e
 * trabalho do banco - ele tem indices, e otimizado para isso, e devolve
 * exatamente o resultado final.
 */
import { query } from '../config/database.js';

/**
 * AGREGACAO CONDICIONAL - uma unica varredura da tabela produz todos os totais.
 *
 * `SUM(status = 'ABERTO')` funciona porque no MySQL uma comparacao devolve
 * 1 (verdadeiro) ou 0 (falso). Somando esses 1s e 0s, temos a contagem.
 * A alternativa ingenua seriam 6 queries `SELECT COUNT(*) ... WHERE status=...`,
 * ou seja, 6 varreduras em vez de uma.
 */
export async function getStatusSummary() {
  const rows = await query(`
    SELECT
      COUNT(*)                                   AS total,
      SUM(status = 'ABERTO')                     AS abertos,
      SUM(status = 'EM_ATENDIMENTO')             AS emAtendimento,
      SUM(status = 'RESOLVIDO')                  AS resolvidos,
      SUM(status = 'FECHADO')                    AS fechados,
      SUM(priority = 'URGENTE')                  AS urgentes,
      SUM(agent_id IS NULL AND status = 'ABERTO') AS naFila
    FROM tickets
  `);

  const row = rows[0];
  // SUM() devolve NULL quando a tabela esta vazia; normalizamos para 0 e para
  // Number (o driver pode devolver string em tipos DECIMAL).
  return {
    total: Number(row.total ?? 0),
    abertos: Number(row.abertos ?? 0),
    emAtendimento: Number(row.emAtendimento ?? 0),
    resolvidos: Number(row.resolvidos ?? 0),
    fechados: Number(row.fechados ?? 0),
    urgentes: Number(row.urgentes ?? 0),
    naFila: Number(row.naFila ?? 0),
  };
}

export async function getCountByPriority() {
  const rows = await query(`
    SELECT priority, COUNT(*) AS total
      FROM tickets
     GROUP BY priority
     ORDER BY FIELD(priority, 'URGENTE', 'ALTA', 'MEDIA', 'BAIXA')
  `);
  return rows.map((row) => ({ priority: row.priority, total: Number(row.total) }));
}

/**
 * Tickets por categoria.
 *
 * LEFT JOIN partindo de `categories`: assim as categorias com ZERO tickets
 * tambem aparecem (com total 0). Com INNER JOIN elas sumiriam do relatorio, e
 * "a categoria Pagamento nao teve nenhum chamado" e justamente uma informacao
 * que o gestor quer ver.
 */
export async function getCountByCategory() {
  const rows = await query(`
    SELECT
      cat.id, cat.name,
      COUNT(t.id)                        AS total,
      SUM(t.status IN ('ABERTO','EM_ATENDIMENTO')) AS emAberto
    FROM categories cat
    LEFT JOIN tickets t ON t.category_id = cat.id
    WHERE cat.is_active = 1
    GROUP BY cat.id, cat.name
    ORDER BY total DESC, cat.name ASC
  `);

  return rows.map((row) => ({
    categoryId: row.id,
    category: row.name,
    total: Number(row.total),
    emAberto: Number(row.emAberto ?? 0),
  }));
}

/**
 * Produtividade por atendente.
 *
 * O LEFT JOIN aqui tambem e proposital: um atendente recem-contratado, sem
 * nenhum ticket, precisa aparecer na lista com zeros.
 *
 * AVG(TIMESTAMPDIFF(...)) so considera as linhas em que `resolved_at` nao e
 * NULL, porque AVG ignora NULLs - exatamente o comportamento desejado: tickets
 * ainda abertos nao devem puxar a media para baixo.
 */
export async function getAgentPerformance() {
  const rows = await query(`
    SELECT
      u.id, u.name,
      COUNT(t.id)                                    AS totalAtribuidos,
      SUM(t.status = 'EM_ATENDIMENTO')               AS emAtendimento,
      SUM(t.status IN ('RESOLVIDO','FECHADO'))       AS concluidos,
      ROUND(AVG(TIMESTAMPDIFF(MINUTE, t.created_at, t.resolved_at)), 0) AS tempoMedioMinutos
    FROM users u
    LEFT JOIN tickets t ON t.agent_id = u.id
    WHERE u.role IN ('ATENDENTE','ADMIN') AND u.is_active = 1
    GROUP BY u.id, u.name
    ORDER BY concluidos DESC, totalAtribuidos DESC
  `);

  return rows.map((row) => ({
    agentId: row.id,
    agent: row.name,
    totalAtribuidos: Number(row.totalAtribuidos),
    emAtendimento: Number(row.emAtendimento ?? 0),
    concluidos: Number(row.concluidos ?? 0),
    tempoMedioResolucaoMinutos:
      row.tempoMedioMinutos === null ? null : Number(row.tempoMedioMinutos),
  }));
}

/**
 * Tempo medio de resolucao, global.
 *
 * TIMESTAMPDIFF(MINUTE, a, b) devolve a diferenca ja em minutos - mais preciso
 * e mais legivel que subtrair timestamps na mao. Convertemos para horas na
 * saida porque e a unidade em que se fala de SLA.
 */
export async function getResolutionMetrics() {
  const rows = await query(`
    SELECT
      COUNT(*)                                                        AS totalResolvidos,
      ROUND(AVG(TIMESTAMPDIFF(MINUTE, created_at, resolved_at)), 0)   AS mediaMinutos,
      MIN(TIMESTAMPDIFF(MINUTE, created_at, resolved_at))             AS minimoMinutos,
      MAX(TIMESTAMPDIFF(MINUTE, created_at, resolved_at))             AS maximoMinutos
    FROM tickets
    WHERE resolved_at IS NOT NULL
  `);

  const row = rows[0];
  const toHours = (minutes) =>
    minutes === null || minutes === undefined ? null : Number((Number(minutes) / 60).toFixed(2));

  return {
    totalResolvidos: Number(row.totalResolvidos ?? 0),
    tempoMedioHoras: toHours(row.mediaMinutos),
    tempoMinimoHoras: toHours(row.minimoMinutos),
    tempoMaximoHoras: toHours(row.maximoMinutos),
  };
}

/**
 * Serie temporal: quantos tickets por dia nos ultimos N dias.
 *
 * `DATE(created_at)` corta a hora, permitindo agrupar por dia.
 * ATENCAO: aplicar funcao numa coluna dentro do GROUP BY impede o uso do
 * indice `idx_tickets_created`. Em volume grande, o certo seria guardar uma
 * coluna `created_date` ja truncada. Para a escala deste projeto, esta forma
 * e mais simples e o custo e irrelevante - mas saber do trade-off e o que
 * conta numa entrevista.
 */
export async function getTicketsPerDay(days = 14) {
  const safeDays = Number.parseInt(days, 10);

  const rows = await query(`
    SELECT
      DATE(created_at)               AS dia,
      COUNT(*)                       AS total,
      SUM(priority = 'URGENTE')      AS urgentes
    FROM tickets
    WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ${safeDays} DAY)
    GROUP BY DATE(created_at)
    ORDER BY dia ASC
  `);

  return rows.map((row) => ({
    dia: row.dia,
    total: Number(row.total),
    urgentes: Number(row.urgentes ?? 0),
  }));
}

/** Atendente com mais tickets concluidos - o "destaque" do painel. */
export async function getTopAgent() {
  const rows = await query(`
    SELECT u.id, u.name, COUNT(t.id) AS concluidos
      FROM users u
      INNER JOIN tickets t
              ON t.agent_id = u.id
             AND t.status IN ('RESOLVIDO','FECHADO')
     GROUP BY u.id, u.name
     ORDER BY concluidos DESC
     LIMIT 1
  `);

  if (rows.length === 0) return null;
  return { agentId: rows[0].id, agent: rows[0].name, concluidos: Number(rows[0].concluidos) };
}

/** Metricas do proprio atendente logado (usadas em /api/dashboard/me). */
export async function getAgentOwnStats(agentId) {
  const rows = await query(
    `SELECT
        COUNT(*)                                 AS totalAtribuidos,
        SUM(status = 'EM_ATENDIMENTO')           AS emAtendimento,
        SUM(status IN ('RESOLVIDO','FECHADO'))   AS concluidos,
        SUM(priority = 'URGENTE' AND status IN ('ABERTO','EM_ATENDIMENTO')) AS urgentesPendentes
       FROM tickets
      WHERE agent_id = ?`,
    [agentId],
  );

  const row = rows[0];
  return {
    totalAtribuidos: Number(row.totalAtribuidos ?? 0),
    emAtendimento: Number(row.emAtendimento ?? 0),
    concluidos: Number(row.concluidos ?? 0),
    urgentesPendentes: Number(row.urgentesPendentes ?? 0),
  };
}
