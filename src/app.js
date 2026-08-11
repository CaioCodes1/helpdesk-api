/**
 * Montagem da aplicacao Express.
 *
 * Este arquivo NAO chama `listen`. Ele apenas constroi e exporta o `app`.
 * A separacao app.js / server.js e o que permite:
 *   * testes de integracao (supertest sobe o app sem ocupar uma porta real)
 *   * subir o mesmo app em ambientes diferentes (serverless, por exemplo)
 *   * um lugar so para configurar, outro so para inicializar
 *
 * A ORDEM dos middlewares abaixo e significativa - o Express executa na
 * sequencia em que sao registrados:
 *
 *   1. seguranca e CORS      (antes de tudo, inclusive de erros)
 *   2. parsers de body       (para que req.body exista nos controllers)
 *   3. log de acesso         (registra tudo, ate o que vai falhar)
 *   4. arquivos estaticos    (frontend)
 *   5. rotas da API          (o trabalho de verdade)
 *   6. 404                   (nada casou)
 *   7. tratador de erros     (SEMPRE por ultimo)
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import swaggerUi from 'swagger-ui-express';

import routes from './routes/index.js';
import { swaggerSpec } from './docs/swagger.js';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware.js';
import { requestLogger } from './middlewares/requestLogger.middleware.js';
import { env } from './config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// --- 1. Seguranca -----------------------------------------------------------
/**
 * `helmet` define headers HTTP de seguranca (X-Frame-Options, HSTS,
 * X-Content-Type-Options e outros). Sao protecoes que custam uma linha e
 * evitam classes inteiras de ataque no navegador.
 *
 * A CSP fica desligada porque o frontend de demonstracao usa estilos e scripts
 * inline. Numa aplicacao real com build, ela deve ser ligada e configurada.
 */
app.use(helmet({ contentSecurityPolicy: false }));

/**
 * CORS: o navegador BLOQUEIA, por padrao, uma pagina em localhost:5500 de
 * chamar uma API em localhost:3000 (origens diferentes). Este middleware
 * envia os headers que autorizam essas origens especificas.
 * `'*'` so e aceitavel em desenvolvimento.
 */
app.use(
  cors({
    origin: env.corsOrigin.includes('*') ? true : env.corsOrigin,
    credentials: true,
  }),
);

// Nao anunciar "X-Powered-By: Express" - informacao gratuita para atacantes.
app.disable('x-powered-by');

// Necessario para o rate limit funcionar atras de proxy (Render, Railway, nginx),
// onde o IP real vem no header X-Forwarded-For.
app.set('trust proxy', 1);

// --- 2. Parsers -------------------------------------------------------------
// Sem isto, `req.body` seria `undefined`: o corpo chega como stream de bytes e
// alguem precisa transformar em objeto. O limite de tamanho evita que alguem
// derrube a API mandando um JSON de 500 MB.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// --- 3. Logs ----------------------------------------------------------------
app.use(requestLogger);

// --- 4. Frontend estatico ---------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- 5. Documentacao --------------------------------------------------------
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'Help Desk API - Documentacao',
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none' },
  }),
);

// Spec crua: util para importar no Postman/Insomnia ou gerar clientes.
app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));

// --- 6. Rotas da API --------------------------------------------------------
// Prefixo unico `/api`: versionar depois (`/api/v2`) fica trivial, e evita
// conflito com as rotas do frontend estatico.
app.use('/api', routes);

// --- 7. 404 e erros ---------------------------------------------------------
app.use(notFoundHandler);
app.use(errorHandler); // 4 parametros: precisa ser o ULTIMO

export default app;
