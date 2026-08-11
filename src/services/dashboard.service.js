import * as dashboardRepository from '../repositories/dashboard.repository.js';
import { ROLES } from '../constants/index.js';

/**
 * Dashboard administrativo.
 *
 * `Promise.all` dispara as consultas EM PARALELO. Elas sao independentes entre
 * si, entao nao ha motivo para esperar uma terminar antes de comecar a
 * proxima: com `await` sequencial, o tempo total seria a SOMA das queries;
 * em paralelo, e o tempo da mais lenta.
 *
 * (O pool de conexoes torna isso possivel: cada query pega uma conexao livre.)
 */
export async function getAdminDashboard({ days = 14 } = {}) {
  const [summary, byPriority, byCategory, byAgent, resolution, perDay, topAgent] =
    await Promise.all([
      dashboardRepository.getStatusSummary(),
      dashboardRepository.getCountByPriority(),
      dashboardRepository.getCountByCategory(),
      dashboardRepository.getAgentPerformance(),
      dashboardRepository.getResolutionMetrics(),
      dashboardRepository.getTicketsPerDay(days),
      dashboardRepository.getTopAgent(),
    ]);

  return {
    resumo: summary,
    porPrioridade: byPriority,
    porCategoria: byCategory,
    porAtendente: byAgent,
    metricas: {
      ...resolution,
      atendenteDestaque: topAgent,
      // Taxa de resolucao: quanto do que entrou ja foi concluido.
      // Calculada aqui (e nao no SQL) porque e derivada de numeros que ja
      // temos - nao vale uma ida extra ao banco.
      taxaResolucaoPercentual:
        summary.total > 0
          ? Number((((summary.resolvidos + summary.fechados) / summary.total) * 100).toFixed(1))
          : 0,
    },
    ticketsPorDia: perDay,
  };
}

/** Painel pessoal do atendente logado. */
export async function getAgentDashboard(actor) {
  if (actor.role === ROLES.CLIENTE) {
    // Nao deveria chegar aqui (a rota ja e restrita), mas defesa em
    // profundidade: a regra tambem existe no service.
    return null;
  }
  return dashboardRepository.getAgentOwnStats(actor.id);
}
