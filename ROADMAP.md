# Roadmap

Registro do que foi construído, em que ordem, e o que vem depois.

---

## Fases concluídas

### Fase 1 — Estrutura e Express ✅

- `npm init`, dependências, `"type": "module"` (ESM)
- Separação `app.js` (monta) / `server.js` (escuta) — habilita testes sem ocupar porta
- Primeira rota: `GET /api/health`
- `.env` / `.env.example` / `.gitignore`

**Conceitos:** ciclo request/response, HTTP stateless, Express como roteador + pilha de middlewares.

### Fase 2 — MySQL, modelagem e relacionamentos ✅

- `database/schema.sql` com 4 tabelas
- Chaves primárias, estrangeiras, índices e constraints
- Políticas de exclusão diferenciadas: `RESTRICT`, `SET NULL`, `CASCADE`
- Pool de conexões com `mysql2/promise`
- Scripts `db:migrate` e `db:seed`

**Conceitos:** cardinalidade 1:N, duas FKs para a mesma tabela, quando indexar, prepared statements. Ver [DATABASE.md](DATABASE.md).

### Fase 3 — Camadas, validação e erros ✅

- `controllers` / `services` / `repositories`
- Erros tipados (`AppError`, `NotFoundError`, `ConflictError`…)
- `errorHandler` centralizado, incluindo tradução de códigos do MySQL
- Validação com Zod em `body`, `params` e `query`
- `asyncHandler` eliminando `try/catch` repetido
- Logger com níveis e log de acesso com duração

**Conceitos:** separação de responsabilidades, por que o service não conhece HTTP, validação na borda.

### Fase 4 — Cadastro, login, bcrypt e JWT ✅

- `POST /auth/register` (sempre `CLIENTE` — imune a *mass assignment*)
- `POST /auth/login` retornando JWT
- Hash bcrypt com salt por senha
- `GET /auth/me`, `PATCH /auth/password`
- Rate limit nas rotas de autenticação

**Conceitos:** hash vs criptografia, por que bcrypt e não SHA-256, anatomia do JWT, por que o payload não é secreto.

### Fase 5 — Papéis e autorização ✅

- Middleware `authenticate` (identidade) e `authorize(...roles)` (permissão)
- Consulta ao banco a cada requisição para refletir mudanças de papel/status
- Checagem de propriedade (*ownership*) na camada de service

**Conceitos:** 401 vs 403, `authorize` como fábrica de middlewares (closure), IDOR.

### Fase 6 — Tickets, status e prioridades ✅

- CRUD completo com escopo por papel
- Máquina de estados com transições validadas
- Quatro prioridades com ordenação via `FIELD()`
- 24 regras de negócio implementadas

**Conceitos:** máquina de estados como dado, efeitos colaterais de transição, por que endpoints de ação em vez de um `PUT` genérico.

### Fase 7 — Mensagens, histórico e atribuição ✅

- Recurso aninhado `/tickets/:id/messages`
- Notas internas filtradas no SQL
- Reabertura automática quando o cliente responde ticket resolvido
- `claim`, `assign` e devolução à fila
- Criação de ticket + primeira mensagem em transação

**Conceitos:** URL aninhada refletindo a hierarquia dos dados, imutabilidade do histórico, `ON DELETE CASCADE`, atomicidade.

### Fase 8 — Paginação, filtros, ordenação e busca ✅

- `page` / `limit` com teto de 100
- Filtros combináveis, incluindo múltiplos valores por vírgula
- Busca textual em título e descrição
- Ordenação com whitelist de colunas (anti SQL injection)
- `meta` com `totalPages`, `hasNextPage`, `hasPreviousPage`

**Conceitos:** construção dinâmica de `WHERE` mantendo parametrização, por que `LIMIT` não aceita placeholder, por que nome de coluna precisa de whitelist.

### Fase 9 — Dashboard e SQL analítico ✅

- Totais por status, prioridade, categoria e atendente
- Tempo médio/mínimo/máximo de resolução
- Taxa de resolução e atendente destaque
- Série temporal diária
- Painel pessoal do atendente

**Conceitos:** agregação condicional (`SUM(coluna = valor)`), `TIMESTAMPDIFF`, `AVG` ignorando `NULL`, `LEFT JOIN` para não esconder o zero, `Promise.all` para paralelizar consultas.

### Fase 10 — Documentação, testes e segurança ✅

- OpenAPI 3.0 completa em `/api/docs`
- 19 testes unitários (`node --test`)
- Roteiro de 77 verificações de integração
- `helmet`, `cors`, rate limit, *graceful shutdown*
- README, ARCHITECTURE, DATABASE, API, ROADMAP

---

## Frontend de demonstração ✅

HTML/CSS/JS puro, sem framework: login e cadastro, lista de chamados com filtros, detalhe com conversa e ações contextuais, dashboard, gestão de categorias e usuários.

> A UI esconde botões conforme o papel — mas isso é **conveniência**, não segurança. O backend valida tudo de novo, sempre.

---

## Próximos passos

### Curto prazo

- [ ] **Testes de integração automatizados** — Supertest + banco de teste, transformando o roteiro manual de 77 verificações em `npm test`
- [ ] **Docker Compose** (API + MySQL) para subir com um comando
- [ ] **CI no GitHub Actions** rodando lint e testes em cada push
- [ ] **Screenshots no README**

### Médio prazo

- [ ] **Refresh token** com rotação e revogação — hoje não há como invalidar um token antes de expirar
- [ ] **Upload de anexos** nos tickets, com validação de tipo e tamanho
- [ ] **Notificações por e-mail** em mudança de status e nova mensagem
- [ ] **SLA por prioridade** com alerta de vencimento
- [ ] **Tabela de auditoria** com histórico completo de transições (hoje só guardamos os carimbos finais)

### Longo prazo

- [ ] **WebSocket** para atualização da conversa em tempo real
- [ ] **Cache do dashboard** em Redis — as agregações são as queries mais caras
- [ ] **Migração para TypeScript**
- [ ] **Multi-tenant**: várias empresas no mesmo sistema, com isolamento por `company_id`
- [ ] **Deploy** (Render/Railway + PlanetScale ou RDS)

---

## Trade-offs conscientes

Decisões tomadas sabendo o que se perdeu — e por quê.

| Decisão | O que ganhamos | O que abrimos mão |
|---|---|---|
| SQL à mão em vez de ORM | Entender e explicar o modelo relacional; controle sobre índices e planos de execução | Velocidade de desenvolvimento; migrações automáticas |
| Sem tabela de auditoria | Modelo simples e viável para uma pessoa | Não dá para reconstruir a linha do tempo completa de um ticket |
| JWT sem refresh token | Menos complexidade; sem estado no servidor | Não há revogação antes da expiração (mitigado com validade de 8h + checagem de `is_active`) |
| Token no `localStorage` (frontend) | Simplicidade da demonstração | Vulnerável a XSS; cookie `httpOnly` seria mais seguro |
| Logger próprio em vez de winston/pino | Zero dependência; 40 linhas legíveis | Sem log estruturado em JSON, sem transports, sem rotação de arquivo |
| Swagger escrito à mão | Uma fonte da verdade, sem plugin de build | Precisa ser atualizado manualmente ao criar endpoints |
| Frontend sem framework | Foco no backend; sem etapa de build | Código de UI mais verboso e menos reutilizável |
