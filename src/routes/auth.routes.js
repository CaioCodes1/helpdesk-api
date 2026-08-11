/**
 * ROUTES = o mapa da API. Nada alem disso.
 *
 * Ler este arquivo deve responder, em 10 segundos: quais endpoints existem,
 * quem pode acessar cada um e o que e validado. Toda a cadeia de middlewares
 * fica visivel numa linha so - e essa legibilidade e o motivo de existir uma
 * camada separada de rotas.
 *
 *   router.post('/login', authLimiter, validate(loginSchema), authController.login);
 *                          └─ rate ─┘  └── validacao ────┘   └─ controller ─┘
 *
 * A ORDEM importa: o Express executa os middlewares na sequencia declarada.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as authController from '../controllers/auth.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
} from '../validators/auth.validator.js';

const router = Router();

/**
 * RATE LIMIT nas rotas de autenticacao.
 *
 * Sem isso, um script tenta 10.000 senhas por minuto ate acertar (brute force).
 * O bcrypt lento ajuda, mas nao resolve sozinho. Limitar por IP e a defesa
 * barata e eficaz - e o tipo de detalhe que mostra preocupacao com seguranca
 * real, nao apenas com o "feliz caminho" do login funcionando.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // 10 tentativas por IP na janela
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { message: 'Muitas tentativas de autenticacao. Tente novamente em 15 minutos.' },
  },
});

// --- Publicas ---------------------------------------------------------------
router.post('/register', authLimiter, validate(registerSchema), authController.register);
router.post('/login', authLimiter, validate(loginSchema), authController.login);

// --- Privadas ---------------------------------------------------------------
router.get('/me', authenticate, authController.me);
router.patch(
  '/password',
  authenticate,
  validate(changePasswordSchema),
  authController.changePassword,
);

export default router;
