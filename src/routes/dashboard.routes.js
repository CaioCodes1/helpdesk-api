import { Router } from 'express';
import * as dashboardController from '../controllers/dashboard.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { ROLES } from '../constants/index.js';

const router = Router();

router.use(authenticate);

/** Visao gerencial completa: numeros de toda a operacao. Somente ADMIN. */
router.get('/', authorize(ROLES.ADMIN), dashboardController.getAdminDashboard);

/** Painel pessoal: "meus numeros". Atendente e admin. */
router.get(
  '/me',
  authorize(ROLES.ATENDENTE, ROLES.ADMIN),
  dashboardController.getMyDashboard,
);

export default router;
