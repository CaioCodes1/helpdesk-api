/**
 * Ponto de entrada: liga o servidor numa porta e cuida do ciclo de vida do
 * processo.
 *
 * O que este arquivo faz e o app.js nao faz:
 *   * abre a porta
 *   * testa a conexao com o banco antes de anunciar que esta pronto
 *   * trata sinais do sistema operacional (graceful shutdown)
 *   * captura falhas globais que escapariam de todos os try/catch
 */
import app from './app.js';
import { env } from './config/env.js';
import { closePool, testConnection } from './config/database.js';
import { logger } from './utils/logger.js';

async function start() {
  // Falhar cedo: melhor a aplicacao nao subir do que subir "meio funcionando"
  // e so revelar o problema quando o primeiro usuario tentar logar.
  try {
    await testConnection();
  } catch (error) {
    logger.error('Nao foi possivel conectar ao MySQL. A API vai subir mesmo assim, mas ' +
      'as rotas que usam o banco vao falhar com 503.', { erro: error.message });
  }

  const server = app.listen(env.port, () => {
    logger.info(`Help Desk API rodando em http://localhost:${env.port} [${env.nodeEnv}]`);
    logger.info(`Documentacao Swagger:    http://localhost:${env.port}/api/docs`);
    logger.info(`Health check:            http://localhost:${env.port}/api/health`);
  });

  /**
   * GRACEFUL SHUTDOWN.
   *
   * Ao receber SIGINT (Ctrl+C) ou SIGTERM (Docker/Kubernetes parando o
   * container), nao matamos o processo na hora: paramos de aceitar novas
   * conexoes, deixamos as requisicoes em andamento terminarem e so entao
   * fechamos o pool do banco.
   *
   * Sem isso, um deploy derrubaria requisicoes no meio e poderia deixar
   * transacoes penduradas no MySQL.
   */
  const shutdown = async (signal) => {
    logger.info(`${signal} recebido. Encerrando com seguranca...`);

    server.close(async () => {
      await closePool();
      logger.info('Servidor encerrado');
      process.exit(0);
    });

    // Rede de seguranca: se algo travar, forca a saida em 10s.
    setTimeout(() => {
      logger.error('Encerramento forcado apos timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  /**
   * Ultima rede de seguranca. Se um erro chegou ate aqui, o estado do processo
   * e desconhecido - o certo e logar e deixar morrer, para que o gerenciador
   * (pm2, Docker) suba uma instancia limpa. Continuar rodando "torto" e pior.
   */
  process.on('unhandledRejection', (reason) => {
    logger.error('Promise rejeitada sem tratamento', { reason: String(reason) });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Excecao nao capturada - encerrando', { erro: error.message, stack: error.stack });
    process.exit(1);
  });
}

start();
