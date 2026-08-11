/**
 * Agregador de rotas.
 *
 * Existe para que o `app.js` nao precise conhecer cada modulo da API. Ele
 * monta UM router e pronto. Adicionar um recurso novo (ex.: anexos) passa a
 * ser uma linha aqui, sem tocar no arquivo de configuracao da aplicacao.
 */
import { Router } from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import ticketRoutes from './ticket.routes.js';
import categoryRoutes from './category.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import { pool } from '../config/database.js';

const router = Router();

/**
 * HEALTH CHECK - rota publica, sem autenticacao.
 *
 * E o endpoint que orquestradores (Docker, Kubernetes, Render, Railway) e
 * ferramentas de monitoramento chamam para saber se a aplicacao esta viva.
 * Ele checa o BANCO tambem: uma API que responde mas nao alcanca o banco esta
 * quebrada na pratica, e mereceria ser reiniciada.
 */
router.get('/health', async (_req, res) => {
  let database = 'ok';
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
  } catch {
    database = 'unreachable';
  }

  const healthy = database === 'ok';

  return res.status(healthy ? 200 : 503).json({
    success: healthy,
    data: {
      status: healthy ? 'ok' : 'degraded',
      database,
      uptime: Number(process.uptime().toFixed(2)),
      timestamp: new Date().toISOString(),
    },
  });
});

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/tickets', ticketRoutes);
router.use('/categories', categoryRoutes);
router.use('/dashboard', dashboardRoutes);

export default router;
