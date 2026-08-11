import { Router } from 'express';
import * as userController from '../controllers/user.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { idParamSchema } from '../validators/common.validator.js';
import {
  createUserSchema,
  listUsersSchema,
  resetPasswordSchema,
  updateRoleSchema,
  updateUserSchema,
} from '../validators/user.validator.js';
import { ROLES } from '../constants/index.js';

const router = Router();

// Aplicado a TODAS as rotas abaixo. Sem argumento de path, `router.use` roda
// para qualquer requisicao que chegue neste router - evita repetir
// `authenticate` em cada linha e, principalmente, evita ESQUECER em alguma.
router.use(authenticate);

/**
 * Lista de atendentes: acessivel a toda a equipe, porque a tela de atribuicao
 * precisa dela. Vem ANTES de `/:id` de proposito - o Express casa rotas na
 * ordem, e `/agents` bateria em `/:id` (com id = "agents") se viesse depois.
 * Esse detalhe de ordenacao e um bug classico de quem esta comecando.
 */
router.get('/agents', authorize(ROLES.ATENDENTE, ROLES.ADMIN), userController.listAgents);

// Gestao de usuarios: exclusiva do ADMIN.
router.get('/', authorize(ROLES.ADMIN), validate(listUsersSchema), userController.list);

router.get(
  '/:id',
  authorize(ROLES.ADMIN),
  validate({ params: idParamSchema }),
  userController.getById,
);

router.post('/', authorize(ROLES.ADMIN), validate(createUserSchema), userController.create);

router.put(
  '/:id',
  authorize(ROLES.ADMIN),
  validate({ params: idParamSchema, ...updateUserSchema }),
  userController.update,
);

/**
 * PATCH e nao PUT: alteramos UM campo, nao substituimos o recurso inteiro.
 * Endpoint dedicado (`/role`) em vez de embutir no PUT porque promover alguem
 * a ADMIN e uma acao sensivel - merece rota propria, log proprio e regra
 * propria, em vez de virar mais um campo opcional de um update generico.
 */
router.patch(
  '/:id/role',
  authorize(ROLES.ADMIN),
  validate({ params: idParamSchema, ...updateRoleSchema }),
  userController.updateRole,
);

router.patch(
  '/:id/password',
  authorize(ROLES.ADMIN),
  validate({ params: idParamSchema, ...resetPasswordSchema }),
  userController.resetPassword,
);

router.delete(
  '/:id',
  authorize(ROLES.ADMIN),
  validate({ params: idParamSchema }),
  userController.remove,
);

export default router;
