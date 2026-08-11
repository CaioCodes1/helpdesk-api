# Help Desk API

Sistema de gerenciamento de chamados (tickets) de suporte, construído como API REST em Node.js + Express + MySQL, com autenticação JWT e autorização baseada em papéis.

> Projeto de portfólio com foco em **backend**. O frontend existe para demonstrar a API funcionando, mas as decisões técnicas relevantes estão no servidor.

---

## Índice

- [O problema](#o-problema)
- [A solução](#a-solução)
- [Funcionalidades](#funcionalidades)
- [Tecnologias](#tecnologias)
- [Como instalar](#como-instalar)
- [Como executar](#como-executar)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Endpoints principais](#endpoints-principais)
- [Regras de negócio](#regras-de-negócio-implementadas)
- [Decisões técnicas](#decisões-técnicas)
- [Testes](#testes)
- [Melhorias futuras](#melhorias-futuras)

---

## O problema

Empresas que atendem clientes por e-mail e WhatsApp perdem controle do atendimento:

- não se sabe **quem** está cuidando de cada solicitação;
- não há **histórico** consolidado da conversa;
- não existe **priorização** — o pedido urgente fica na fila junto com a dúvida simples;
- não há **métrica**: ninguém sabe quanto tempo se leva para resolver um chamado.

## A solução

Uma API REST que modela o atendimento como um **ticket com ciclo de vida controlado**:

```
 CLIENTE ──abre──▶ TICKET ◀──assume── ATENDENTE
                     │
                     ├─ STATUS       (máquina de estados: transições inválidas são recusadas)
                     ├─ PRIORIDADE   (urgentes aparecem primeiro na fila)
                     ├─ CATEGORIA    (gerenciada pelo admin)
                     └─ MENSAGENS    (histórico imutável, com notas internas)
                                          ▲
                                    ADMIN vê métricas e gerencia a equipe
```

O que diferencia este projeto de um CRUD:

1. **Máquina de estados** — o ticket não é um registro editável livremente. `FECHADO → ABERTO` retorna `409 Conflict`.
2. **Autorização contextual** — não basta "é CLIENTE?"; a pergunta real é "é dono **deste** ticket?".
3. **Auditabilidade** — mensagens não são apagadas, datas de resolução e fechamento são carimbadas, usuários com histórico são desativados em vez de excluídos.

---

## Funcionalidades

### Autenticação e usuários
- Cadastro público (sempre com perfil `CLIENTE` — imune a *mass assignment*)
- Login com JWT, senhas com hash bcrypt
- Três papéis: `CLIENTE`, `ATENDENTE`, `ADMIN`
- Troca da própria senha, reset de senha pelo admin
- Rate limit nas rotas de autenticação (10 tentativas / 15 min por IP)

### Tickets
- Abertura, listagem, detalhamento e edição
- Fluxo de status controlado por máquina de estados
- Quatro prioridades, com ordenação automática (urgentes primeiro)
- Assumir chamado (`claim`), atribuir e devolver à fila
- Filtros combináveis: status, prioridade, categoria, atendente, período, busca textual
- Paginação e ordenação com *whitelist* de colunas

### Mensagens
- Histórico cronológico por ticket
- **Notas internas** visíveis apenas para a equipe
- Reabertura automática quando o cliente responde um ticket resolvido

### Administração
- Gestão de usuários e permissões
- CRUD de categorias (com desativação lógica quando há vínculos)
- Dashboard com totais por status/prioridade/categoria/atendente, tempo médio de resolução, taxa de resolução, série diária e atendente destaque

### Infraestrutura
- Tratamento centralizado de erros com respostas padronizadas
- Validação de entrada com Zod
- Logs estruturados de acesso e de erro
- Documentação OpenAPI/Swagger interativa
- Health check com verificação do banco
- *Graceful shutdown*

---

## Tecnologias

| Camada | Escolha | Por quê |
|---|---|---|
| Runtime | Node.js 18+ (ESM) | `import/export` nativo, test runner embutido |
| Framework | Express 4 | Minimalista; deixa a arquitetura visível em vez de escondê-la |
| Banco | MySQL 8 (`mysql2/promise`) | SQL escrito à mão, com *prepared statements* |
| Auth | `jsonwebtoken` + `bcryptjs` | Padrão de mercado para JWT e hashing |
| Validação | `zod` | Schemas declarativos que também normalizam os dados |
| Segurança | `helmet`, `cors`, `express-rate-limit` | Headers seguros, controle de origem, anti brute force |
| Docs | `swagger-ui-express` | Documentação executável no navegador |
| Testes | `node:test` | Sem dependência extra de framework |

**Sem ORM, de propósito.** Ver [Decisões técnicas](#decisões-técnicas).

---

## Como instalar

### Pré-requisitos
- Node.js 18 ou superior
- MySQL 8 em execução

### Passos

```bash
git clone https://github.com/seu-usuario/helpdesk-api.git
```

```bash
cd helpdesk-api && npm install
```

Copie o arquivo de exemplo de variáveis de ambiente:

```bash
cp .env.example .env
```

Gere um segredo forte para o JWT e cole no `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Crie o schema e popule com dados de demonstração:

```bash
npm run db:reset
```

---

## Como executar

```bash
npm run dev
```

| Recurso | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Documentação Swagger | http://localhost:3000/api/docs |
| Spec OpenAPI (JSON) | http://localhost:3000/api/docs.json |
| Health check | http://localhost:3000/api/health |

### Contas de demonstração

Senha de todas: `Senha@123`

| E-mail | Perfil |
|---|---|
| `admin@helpdesk.com` | ADMIN |
| `bruno@helpdesk.com` | ATENDENTE |
| `carla@helpdesk.com` | ATENDENTE |
| `diego@cliente.com` | CLIENTE |
| `elisa@cliente.com` | CLIENTE |

### Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` | Sobe a API com nodemon (reinício automático) |
| `npm start` | Sobe a API em modo produção |
| `npm run db:migrate` | Cria o database e as tabelas |
| `npm run db:seed` | Popula com dados de demonstração |
| `npm run db:reset` | Migrate + seed |
| `npm test` | Roda os testes unitários |

---

## Variáveis de ambiente

| Variável | Obrigatória | Padrão | Descrição |
|---|:---:|---|---|
| `NODE_ENV` | | `development` | Ambiente de execução |
| `PORT` | | `3000` | Porta HTTP |
| `DB_HOST` | | `localhost` | Host do MySQL |
| `DB_PORT` | | `3306` | Porta do MySQL |
| `DB_USER` | | `root` | Usuário do banco |
| `DB_PASSWORD` | | *(vazio)* | Senha do banco |
| `DB_NAME` | | `helpdesk` | Nome do database |
| `DB_CONNECTION_LIMIT` | | `10` | Tamanho do pool de conexões |
| `JWT_SECRET` | **sim** | — | Segredo de assinatura do token |
| `JWT_EXPIRES_IN` | | `8h` | Validade do token |
| `BCRYPT_SALT_ROUNDS` | | `10` | Custo do hash de senha |
| `CORS_ORIGIN` | | `*` | Origens permitidas, separadas por vírgula |
| `LOG_LEVEL` | | `info` | `error` \| `warn` \| `info` \| `debug` |

`JWT_SECRET` não tem valor padrão de propósito: a aplicação **se recusa a subir** sem ele. Um segredo default seria uma falha de segurança que ninguém percebe até chegar em produção.

---

## Endpoints principais

Documentação completa e interativa em `/api/docs`. Detalhamento em [API.md](API.md).

### Autenticação

| Método | Rota | Acesso |
|---|---|---|
| `POST` | `/api/auth/register` | Público |
| `POST` | `/api/auth/login` | Público |
| `GET` | `/api/auth/me` | Autenticado |
| `PATCH` | `/api/auth/password` | Autenticado |

### Tickets

| Método | Rota | Acesso |
|---|---|---|
| `GET` | `/api/tickets` | Autenticado (escopo automático por papel) |
| `POST` | `/api/tickets` | CLIENTE, ADMIN |
| `GET` | `/api/tickets/:id` | Dono ou equipe |
| `PUT` | `/api/tickets/:id` | Dono (só se ABERTO) ou equipe |
| `PATCH` | `/api/tickets/:id/status` | Conforme a máquina de estados |
| `PATCH` | `/api/tickets/:id/priority` | ATENDENTE, ADMIN |
| `PATCH` | `/api/tickets/:id/assign` | ATENDENTE (só a si), ADMIN |
| `POST` | `/api/tickets/:id/claim` | ATENDENTE, ADMIN |
| `DELETE` | `/api/tickets/:id` | ADMIN |

### Mensagens, categorias, usuários e dashboard

| Método | Rota | Acesso |
|---|---|---|
| `GET` / `POST` | `/api/tickets/:id/messages` | Dono ou equipe |
| `GET` | `/api/categories` | Autenticado |
| `POST` / `PUT` / `DELETE` | `/api/categories/:id` | ADMIN |
| `GET` | `/api/users`, `/api/users/:id` | ADMIN |
| `PATCH` | `/api/users/:id/role` | ADMIN |
| `GET` | `/api/users/agents` | ATENDENTE, ADMIN |
| `GET` | `/api/dashboard` | ADMIN |
| `GET` | `/api/dashboard/me` | ATENDENTE, ADMIN |

### Formato das respostas

Sucesso:

```json
{
  "success": true,
  "message": "Ticket aberto com sucesso",
  "data": { "id": 12, "title": "..." },
  "meta": { "page": 1, "limit": 10, "total": 42, "totalPages": 5 }
}
```

Erro:

```json
{
  "success": false,
  "error": {
    "message": "Transição inválida: ABERTO -> RESOLVIDO",
    "details": [{ "field": "title", "message": "title deve ter no mínimo 5 caracteres" }]
  }
}
```

---

## Regras de negócio implementadas

| # | Regra | Resposta quando violada |
|:--:|---|---|
| 1 | Cliente só enxerga os próprios tickets (filtro forçado no servidor) | — |
| 2 | Cliente acessando ticket alheio recebe `404`, não `403` | `404` |
| 3 | Atendente não abre chamados | `403` |
| 4 | Categoria desativada não aceita novos tickets | `400` |
| 5 | Prioridade `URGENTE` pedida por cliente é rebaixada para `ALTA` | — |
| 6 | Cliente só edita o ticket enquanto `ABERTO` | `409` |
| 7 | Só a equipe altera prioridade | `403` |
| 8 | Transições de status seguem a máquina de estados | `409` |
| 9 | Cliente só pode fechar ou reabrir ticket resolvido | `403` |
| 10 | Ticket não pode ser atribuído a usuário `CLIENTE` | `400` |
| 11 | Atendente só atribui a si mesmo; admin reatribui a terceiros | `403` |
| 12 | Atendente não "rouba" ticket de colega | `409` |
| 13 | Só admin exclui tickets | `403` |
| 14 | Ticket `FECHADO` é imutável | `409` |
| 15 | Ver mensagens exige poder ver o ticket | `404` |
| 16 | Notas internas nunca chegam ao cliente (filtradas no SQL) | — |
| 17 | Ticket `FECHADO` não recebe mensagens | `409` |
| 18 | Só a equipe cria notas internas | `403` |
| 19 | Cliente responder ticket `RESOLVIDO` reabre para `EM_ATENDIMENTO` | — |
| 20 | Atendente responder publicamente ticket `ABERTO` inicia o atendimento | — |
| 21 | Categoria com tickets é desativada, não excluída | — |
| 22 | Admin não altera a própria role nem se desativa | `403` |
| 23 | Sistema nunca fica sem admin ativo | `400` |
| 24 | Usuário com histórico é desativado, não excluído | — |

### Fluxo de status

```
        ┌──────────────────────────────────────────────┐
        │                                              ▼
    ┌────────┐      ┌────────────────┐      ┌───────────┐      ┌─────────┐
    │ ABERTO │─────▶│ EM_ATENDIMENTO │─────▶│ RESOLVIDO │─────▶│ FECHADO │
    └────────┘      └────────────────┘      └───────────┘      └─────────┘
         ▲                  │  ▲                  │                (final)
         └──────────────────┘  └──────────────────┘
           devolver à fila       reabrir (não resolveu)
```

---

## Decisões técnicas

### Por que sem ORM?

Sequelize ou Prisma resolveriam mais rápido, mas esconderiam exatamente o que este projeto quer demonstrar: modelagem relacional e SQL. Escrevendo `JOIN`, `GROUP BY` e agregação condicional à mão, dá para explicar em entrevista por que existe cada índice e por que o `LEFT JOIN` de `agent_id` não pode ser `INNER`.

O custo é real: mais código de mapeamento e nenhuma migração automática. Foi um trade-off consciente.

### Por que Controller / Service / Repository?

- **Controller** traduz HTTP: lê `req`, devolve `res` com o status correto. Não conhece SQL nem regra.
- **Service** guarda as regras de negócio. Não conhece `req`/`res`, então a mesma regra serve para a API, um job agendado ou um teste.
- **Repository** é o único lugar com SQL. Trocar de banco significa mexer só nessa pasta.

O teste disso: `tests/rules.test.js` verifica a máquina de estados **sem subir servidor nem banco**. Isso só é possível porque a regra não está grudada no HTTP.

### Por que endpoints de ação em vez de um `PUT` gigante?

`PATCH /tickets/:id/status` em vez de `PUT /tickets/:id { status }`. Cada ação tem regras próprias, permissões próprias e log próprio — e a intenção fica explícita na URL, o que ajuda auditoria e depuração.

### Por que `404` em vez de `403` para ticket alheio?

Um `403` confirmaria que o ticket existe. Para quem não deveria vê-lo, até a existência é informação demais.

### Onde a segurança foi tratada

| Ameaça | Defesa |
|---|---|
| SQL injection | *Prepared statements* em 100% das queries; nomes de coluna vêm de whitelist |
| Mass assignment | `role` não existe no schema de cadastro público |
| IDOR | Verificação de propriedade no service, não só de papel na rota |
| Brute force | `express-rate-limit` nas rotas de auth + custo do bcrypt |
| Enumeração de usuários | Mensagem idêntica para e-mail inexistente e senha errada |
| Vazamento de stack trace | `errorHandler` só expõe erros operacionais |
| XSS no frontend | Escape de HTML em toda interpolação |
| Headers inseguros | `helmet` |

---

## Testes

```bash
npm test
```

19 testes unitários cobrindo máquina de estados, papéis, ordenação por prioridade, paginação e hashing de senha.

A API também foi validada por um roteiro de 77 verificações de integração cobrindo autenticação, autorização por papel, escopo de visibilidade, transições de status, notas internas, filtros, tentativas de SQL injection e o dashboard.

---

## Melhorias futuras

- [ ] *Refresh token* com rotação e revogação
- [ ] Upload de anexos nos tickets (S3 ou disco local)
- [ ] Notificações por e-mail em mudanças de status
- [ ] SLA por prioridade com alerta de vencimento
- [ ] Tabela de auditoria com histórico completo de transições
- [ ] WebSocket para atualização da conversa em tempo real
- [ ] Testes de integração automatizados com Supertest + banco de teste
- [ ] Docker Compose (API + MySQL) e pipeline de CI
- [ ] Cache de dashboard em Redis
- [ ] Migração para TypeScript

---

## Documentação adicional

| Arquivo | Conteúdo |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Camadas, fluxo de dados e o porquê de cada separação |
| [DATABASE.md](DATABASE.md) | Modelo de dados, relacionamentos, índices e queries comentadas |
| [API.md](API.md) | Referência de todos os endpoints com exemplos |
| [ROADMAP.md](ROADMAP.md) | Etapas de construção e próximos passos |

---

## Licença

MIT
