# helpdesk-api

API REST de help desk / gerenciamento de tickets, com controle de acesso por
papel e um frontend de demonstração em `public/`. Primeiro projeto do workspace
(11/08/2026). Construído em 10 fases, todas concluídas.

## Stack

Node 18+ (ESM) · Express 4 · MySQL 8 com **SQL escrito à mão** (`mysql2/promise`,
sem ORM) · JWT · bcryptjs · Zod · helmet · express-rate-limit · Swagger UI

A escolha de SQL à mão é deliberada: o objetivo era entender o modelo relacional,
índices e planos de execução. O custo (migrações manuais, mais código) está
registrado na tabela de trade-offs do [ROADMAP.md](ROADMAP.md).

## Documentação existente — ler antes de mexer

| Arquivo | Conteúdo |
|---|---|
| [README.md](README.md) | Visão geral, como rodar, screenshots |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Camadas, fluxo de uma requisição, onde adicionar coisas |
| [DATABASE.md](DATABASE.md) | Modelo, FKs, políticas de exclusão, índices |
| [API.md](API.md) | Referência dos endpoints |
| [ROADMAP.md](ROADMAP.md) | **As 10 fases, o que vem depois e os trade-offs conscientes** |

## Estrutura

```
src/
  server.js  →  app.js
  config/       database.js (pool mysql2), env.js
  constants/    ROLES, TICKET_STATUS, TICKET_PRIORITY e a MÁQUINA DE ESTADOS
  routes/  →  controllers/  →  services/  →  repositories/
  middlewares/  auth (authenticate + authorize), error, validate, requestLogger
  validators/   Zod em body, params e query
  errors/       AppError e derivados (NotFoundError, ConflictError…)
  utils/        asyncHandler, httpResponse, jwt, logger próprio, pagination, password
  docs/swagger.js  → OpenAPI 3.0 escrita à mão, servida em /api/docs
database/     schema.sql (4 tabelas), migrate.js, seed.js
public/       frontend de demo: HTML/CSS/JS puro
tests/        rules.test.js — 19 testes unitários (node --test)
```

## Domínio — o que não pode ser quebrado

- **Papéis**: `CLIENTE`, `ATENDENTE`, `ADMIN`. `STAFF_ROLES` = atendente + admin.
- **Status**: `ABERTO → EM_ATENDIMENTO → RESOLVIDO → FECHADO` (terminal), com
  retornos permitidos declarados em `src/constants/index.js`. A máquina de
  estados é **dado, não `if` espalhado** — mudar transição é mudar essa tabela.
- **Prioridades**: `BAIXA | MEDIA | ALTA | URGENTE`, ordenadas com `FIELD()`.
- `POST /auth/register` cria **sempre** `CLIENTE` — imune a mass assignment.
- `authenticate` consulta o banco a cada requisição (para refletir mudança de
  papel/status na hora); `authorize(...roles)` é fábrica de middleware.
- Ownership é checado **no service**, não na rota (anti-IDOR).
- Cliente que responde ticket `RESOLVIDO` reabre o ticket automaticamente.
- Notas internas são filtradas **no SQL**, não no JavaScript.
- Ordenação usa whitelist de colunas — nome de coluna não aceita placeholder.

## Endpoints

`/api/health` · `/api/auth` · `/api/users` · `/api/tickets`
(+ aninhado `/tickets/:id/messages`, ações `claim`/`assign`) · `/api/categories`
· `/api/dashboard` · `/api/docs`

## Comandos

```bash
npm run db:reset   # migrate + seed
npm run dev        # nodemon, porta 3000
npm test           # node --test
```

Preview: config `helpdesk-api` no `launch.json` da raiz (porta 3000 — conflita
com `backend-api` do marketing dashboard).

## Estado

Git limpo, 2 commits, remote `origin/main` configurado.
Não commitado: `docs/img/linkedin-autorizacao.png` (untracked).

Próximos passos priorizados pelo ROADMAP: testes de integração com Supertest,
Docker Compose, CI no GitHub Actions. Depois: refresh token, anexos, SLA.
