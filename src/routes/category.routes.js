import { Router } from 'express';
import * as categoryController from '../controllers/category.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { idParamSchema } from '../validators/common.validator.js';
import {
  createCategorySchema,
  listCategoriesSchema,
  updateCategorySchema,
} from '../validators/category.validator.js';
import { ROLES } from '../constants/index.js';

const router = Router();

router.use(authenticate);

/**
 * LEITURA: qualquer usuario autenticado. O cliente precisa da lista para
 * escolher a categoria ao abrir um chamado.
 * ESCRITA: apenas ADMIN. Categoria e configuracao do sistema, nao conteudo.
 */
router.get('/', validate(listCategoriesSchema), categoryController.list);
router.get('/:id', validate({ params: idParamSchema }), categoryController.getById);

router.post('/', authorize(ROLES.ADMIN), validate(createCategorySchema), categoryController.create);

router.put(
  '/:id',
  authorize(ROLES.ADMIN),
  validate({ params: idParamSchema, ...updateCategorySchema }),
  categoryController.update,
);

router.delete(
  '/:id',
  authorize(ROLES.ADMIN),
  validate({ params: idParamSchema }),
  categoryController.remove,
);

export default router;
