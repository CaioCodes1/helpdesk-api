# Referência da API

Base URL: `http://localhost:3000/api`
Documentação interativa: `http://localhost:3000/api/docs`

---

## Convenções

### Autenticação

Todas as rotas exigem o header abaixo, exceto `/health`, `/auth/register` e `/auth/login`:

```
Authorization: Bearer <token>
```

O token é obtido em `POST /auth/login` e vale 8 horas por padrão.

### Formato de resposta

**Sucesso:**

```json
{
  "success": true,
  "message": "Ticket aberto com sucesso",
  "data": { },
  "meta": { }
}
```

`meta` aparece apenas em listagens paginadas.

**Erro:**

```json
{
  "success": false,
  "error": {
    "message": "Descrição legível do problema",
    "details": [{ "field": "title", "message": "title deve ter no mínimo 5 caracteres" }]
  }
}
```

`details` aparece apenas em erros de validação (`422`).

### Status HTTP usados

| Código | Quando |
|---|---|
| `200` | Sucesso com corpo |
| `201` | Recurso criado |
| `204` | Sucesso sem corpo (exclusão efetiva) |
| `400` | Requisição inválida (referência inexistente, regra de dados) |
| `401` | Não autenticado — token ausente, inválido ou expirado |
| `403` | Autenticado, mas sem permissão |
| `404` | Recurso não encontrado (ou fora do seu escopo) |
| `409` | Conflito com o estado atual (transição inválida, duplicidade) |
| `422` | Falha de validação de entrada |
| `503` | Banco de dados indisponível |

> **401 vs 403:** `401` é problema de **identidade** ("não sei quem você é"). `403` é problema de **permissão** ("sei quem você é, e você não pode").

### Paginação

Aceita `?page=` e `?limit=` (padrão: `1` e `10`; teto de `100`, aplicado silenciosamente).

```json
"meta": {
  "page": 2, "limit": 10, "total": 42, "totalPages": 5,
  "hasPreviousPage": true, "hasNextPage": true
}
```

---

## Health

### `GET /api/health`

Público. Verifica a API **e** a conexão com o banco.

```json
{
  "success": true,
  "data": { "status": "ok", "database": "ok", "uptime": 128.4, "timestamp": "2026-08-07T16:17:26.979Z" }
}
```

Retorna `503` com `"database": "unreachable"` se o MySQL estiver fora.

---

## Auth

### `POST /api/auth/register`

Público. Cria sempre um usuário `CLIENTE`.

```json
{ "name": "João da Silva", "email": "joao@exemplo.com", "password": "Senha@123" }
```

**Senha:** mínimo 8 caracteres, com maiúscula, minúscula e número.

**`201`:**

```json
{
  "success": true,
  "message": "Cadastro realizado com sucesso",
  "data": {
    "user": { "id": 6, "name": "João da Silva", "email": "joao@exemplo.com", "role": "CLIENTE" },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

> Enviar `"role": "ADMIN"` no corpo **não tem efeito**: o campo não existe no schema de validação. Proteção contra *mass assignment*.

**Erros:** `409` e-mail já cadastrado · `422` validação

---

### `POST /api/auth/login`

Público. Limitado a 10 tentativas por IP a cada 15 minutos.

```json
{ "email": "admin@helpdesk.com", "password": "Senha@123" }
```

**`200`:** mesmo formato do register.

**Erros:** `401` credenciais inválidas ou usuário desativado · `429` rate limit

> A mensagem de erro é **idêntica** para e-mail inexistente e senha errada, para não permitir enumeração de usuários.

---

### `GET /api/auth/me`

Retorna o perfil do usuário autenticado, com dados **atuais** do banco (não os do token).

---

### `PATCH /api/auth/password`

```json
{ "currentPassword": "Senha@123", "newPassword": "NovaSenha@456" }
```

Exigir a senha atual protege contra sequestro de sessão: quem roubou o token não consegue tomar a conta.

**Erros:** `401` senha atual incorreta · `409` nova senha igual à atual

---

## Tickets

### `GET /api/tickets`

Escopo automático por papel:

| Papel | O que vê |
|---|---|
| `CLIENTE` | Apenas os próprios tickets — filtro **forçado no servidor** |
| `ATENDENTE` | Todos |
| `ADMIN` | Todos |

**Query params**

| Param | Exemplo | Descrição |
|---|---|---|
| `page`, `limit` | `?page=2&limit=20` | Paginação |
| `status` | `?status=ABERTO,EM_ATENDIMENTO` | Múltiplos por vírgula |
| `priority` | `?priority=URGENTE,ALTA` | Múltiplos por vírgula |
| `categoryId` | `?categoryId=3` | |
| `agentId` | `?agentId=2` | Ignorado para `CLIENTE` |
| `assignedToMe` | `?assignedToMe=true` | Atalho da tela do atendente |
| `unassigned` | `?unassigned=true` | Fila: tickets sem responsável |
| `search` | `?search=pedido` | Busca em título e descrição |
| `createdFrom` / `createdTo` | `?createdFrom=2026-08-01` | Formato `YYYY-MM-DD` |
| `sortBy` | `?sortBy=createdAt` | `createdAt` \| `updatedAt` \| `priority` \| `status` |
| `sortOrder` | `?sortOrder=asc` | `asc` \| `desc` |

**Ordenação padrão:** prioridade `URGENTE` primeiro, depois mais recentes.

**`200`:**

```json
{
  "success": true,
  "data": [{
    "id": 2,
    "title": "Cobrança duplicada no cartão",
    "description": "Fui cobrado duas vezes pelo mesmo pedido #8842.",
    "status": "ABERTO",
    "priority": "URGENTE",
    "category": { "id": 2, "name": "Pagamento" },
    "client":   { "id": 5, "name": "Elisa Cliente", "email": "elisa@cliente.com" },
    "agent":    null,
    "createdAt": "2026-08-05 13:19:00",
    "updatedAt": "2026-08-05 13:19:00",
    "resolvedAt": null,
    "closedAt": null
  }],
  "meta": { "page": 1, "limit": 10, "total": 5, "totalPages": 1, "hasPreviousPage": false, "hasNextPage": false }
}
```

> `"agent": null` significa **"está na fila"** — um estado real do negócio.

**Erros:** `422` valor inválido em filtro ou `sortBy` fora da whitelist

---

### `POST /api/tickets`

| Papel | Comportamento |
|---|---|
| `CLIENTE` | Abre para si mesmo |
| `ADMIN` | Pode informar `clientId` (chamado aberto por telefone) |
| `ATENDENTE` | **`403`** — atendentes não abrem chamados, atendem |

```json
{
  "title": "Meu pedido ainda não chegou",
  "description": "Comprei no dia 02 e o prazo era de 3 dias úteis.",
  "categoryId": 3,
  "priority": "ALTA",
  "clientId": 4
}
```

| Campo | Obrigatório | Regra |
|---|:---:|---|
| `title` | sim | 5–150 caracteres |
| `description` | sim | 10–5000 caracteres |
| `categoryId` | sim | Categoria existente e **ativa** |
| `priority` | não | Padrão `MEDIA` |
| `clientId` | não | Só `ADMIN`; deve ser usuário `CLIENTE` ativo |

**Efeitos automáticos:**
- Status inicial `ABERTO`, sem responsável.
- A descrição vira a **primeira mensagem** do ticket (na mesma transação).
- `URGENTE` pedido por um `CLIENTE` é rebaixado para `ALTA` — senão todo mundo marcaria urgente.

**Erros:** `400` cliente inválido / categoria desativada · `403` atendente ou `clientId` de terceiro · `404` categoria inexistente · `422` validação

---

### `GET /api/tickets/:id`

Retorna o ticket completo.

> Um `CLIENTE` acessando ticket alheio recebe **`404`**, não `403`. Um `403` confirmaria que o recurso existe.

---

### `PUT /api/tickets/:id`

```json
{ "title": "...", "description": "...", "categoryId": 2, "priority": "ALTA" }
```

Todos os campos são opcionais, mas ao menos um é obrigatório.

| Papel | Pode alterar | Quando |
|---|---|---|
| `CLIENTE` | `title`, `description` | Só enquanto `ABERTO` |
| `ATENDENTE` / `ADMIN` | Todos | Enquanto não `FECHADO` |

**Erros:** `403` cliente tentando mudar prioridade/categoria · `409` ticket não está `ABERTO` (cliente) ou está `FECHADO`

---

### `PATCH /api/tickets/:id/status`

```json
{ "status": "RESOLVIDO" }
```

**Transições permitidas:**

| De | Para |
|---|---|
| `ABERTO` | `EM_ATENDIMENTO`, `FECHADO` |
| `EM_ATENDIMENTO` | `RESOLVIDO`, `ABERTO`, `FECHADO` |
| `RESOLVIDO` | `FECHADO`, `EM_ATENDIMENTO` (reabertura) |
| `FECHADO` | *(nenhuma — estado final)* |

**Quem pode:**

| Papel | Transições |
|---|---|
| `CLIENTE` | Fechar (de qualquer estado permitido) e reabrir um `RESOLVIDO` |
| `ATENDENTE` / `ADMIN` | Todas as válidas |

**Efeitos automáticos:**
- `→ EM_ATENDIMENTO` sem responsável: quem executou assume o ticket; `resolved_at` e `closed_at` são limpos.
- `→ RESOLVIDO`: carimba `resolved_at`.
- `→ FECHADO`: carimba `closed_at`.

**Erros:**

```json
{
  "success": false,
  "error": { "message": "Transição inválida: ABERTO -> RESOLVIDO. A partir de ABERTO só é possível ir para: EM_ATENDIMENTO, FECHADO." }
}
```

`403` papel sem permissão para a transição · `409` transição ilegal ou status já é o atual

---

### `PATCH /api/tickets/:id/priority`

`ATENDENTE` e `ADMIN` apenas.

```json
{ "priority": "URGENTE" }
```

---

### `PATCH /api/tickets/:id/assign`

```json
{ "agentId": 2 }
```

`"agentId": null` devolve o ticket à fila (volta para `ABERTO`).

| Papel | Pode |
|---|---|
| `ATENDENTE` | Atribuir **apenas a si mesmo**; devolver à fila um ticket que é seu |
| `ADMIN` | Atribuir a qualquer atendente ou admin |

**Regras:**
- O responsável **nunca** pode ter papel `CLIENTE` → `400`
- Não pode ser um usuário desativado → `400`
- Atendente não "rouba" ticket de colega → `409`
- Se o ticket estava `ABERTO`, passa para `EM_ATENDIMENTO`

---

### `POST /api/tickets/:id/claim`

Atalho para "assumir": equivale a `assign` com o próprio id. Sem corpo.

---

### `DELETE /api/tickets/:id`

`ADMIN` apenas. **`204`**. As mensagens são removidas em cascata pelo banco.

> O fluxo normal é **fechar**, que preserva o histórico. Excluir é exceção (spam, duplicidade).

---

## Mensagens

### `GET /api/tickets/:id/messages`

Ordem cronológica. Aceita `page` e `limit`.

```json
{
  "success": true,
  "data": [{
    "id": 12,
    "ticketId": 1,
    "content": "Olá! Vou verificar o status do pedido.",
    "isInternal": false,
    "author": { "id": 2, "name": "Bruno Atendente", "role": "ATENDENTE" },
    "createdAt": "2026-08-07 13:19:00"
  }],
  "meta": { }
}
```

> Mensagens com `isInternal: true` **nunca** são retornadas para um `CLIENTE`. O filtro é aplicado no SQL.

---

### `POST /api/tickets/:id/messages`

```json
{ "content": "Localizamos a cobrança e o estorno foi solicitado.", "isInternal": false }
```

| Campo | Obrigatório | Regra |
|---|:---:|---|
| `content` | sim | 1–5000 caracteres |
| `isInternal` | não | Padrão `false`; só `ATENDENTE`/`ADMIN` |

**Efeitos automáticos:**

| Situação | O que acontece |
|---|---|
| `CLIENTE` responde ticket `RESOLVIDO` | Reabre para `EM_ATENDIMENTO` e limpa `resolved_at` |
| Equipe responde publicamente ticket `ABERTO` sem dono | Assume o ticket e move para `EM_ATENDIMENTO` |
| Nota **interna** | Não dispara nenhum dos efeitos acima |

**Erros:** `403` cliente tentando nota interna · `404` ticket fora do seu escopo · `409` ticket `FECHADO`

---

## Categorias

### `GET /api/categories`

Qualquer usuário autenticado. Retorna apenas ativas; `?includeInactive=true` funciona só para `ADMIN`.

### `POST /api/categories` · `ADMIN`

```json
{ "name": "Financeiro", "description": "Cobranças e faturas" }
```

`409` se o nome já existir.

### `PUT /api/categories/:id` · `ADMIN`

```json
{ "name": "...", "description": "...", "isActive": true }
```

### `DELETE /api/categories/:id` · `ADMIN`

| Situação | Resposta |
|---|---|
| Sem tickets vinculados | `204` — removida de fato |
| Com tickets vinculados | `200` — apenas **desativada**, com mensagem explicando |

> A API responde com honestidade sobre o que realmente aconteceu, em vez de dizer "deletado" nos dois casos.

---

## Usuários

Todas exigem `ADMIN`, exceto `/users/agents`.

### `GET /api/users`

Filtros: `role`, `isActive`, `search` (nome ou e-mail), `page`, `limit`.

### `GET /api/users/agents`

`ATENDENTE` e `ADMIN`. Lista atendentes e admins **ativos** — alimenta a tela de atribuição.

### `POST /api/users`

Diferente do register público: aqui `role` **é** aceito.

```json
{ "name": "Carla", "email": "carla@helpdesk.com", "password": "Senha@123", "role": "ATENDENTE" }
```

### `PUT /api/users/:id`

```json
{ "name": "...", "email": "...", "role": "ATENDENTE", "isActive": true }
```

### `PATCH /api/users/:id/role`

```json
{ "role": "ATENDENTE" }
```

**Bloqueios:**

| Regra | Resposta |
|---|---|
| Admin alterando a própria role | `403` |
| Operação deixaria o sistema sem nenhum admin ativo | `400` |
| Rebaixar para `CLIENTE` alguém com tickets vinculados | `409` |

### `PATCH /api/users/:id/password`

```json
{ "newPassword": "NovaSenha@123" }
```

### `DELETE /api/users/:id`

| Situação | Resposta |
|---|---|
| Sem histórico | `204` — removido |
| Com tickets ou mensagens | `200` — **desativado** |
| Removendo a si mesmo | `403` |
| Último admin ativo | `400` |

---

## Dashboard

### `GET /api/dashboard` · `ADMIN`

Query param opcional: `?days=30` (janela da série temporal, 1–365, padrão 14).

```json
{
  "success": true,
  "data": {
    "resumo": {
      "total": 5, "abertos": 2, "emAtendimento": 1,
      "resolvidos": 1, "fechados": 1, "urgentes": 2, "naFila": 2
    },
    "porPrioridade": [{ "priority": "URGENTE", "total": 2 }],
    "porCategoria": [{ "categoryId": 3, "category": "Entrega", "total": 1, "emAberto": 1 }],
    "porAtendente": [{
      "agentId": 2, "agent": "Bruno Atendente",
      "totalAtribuidos": 2, "emAtendimento": 1, "concluidos": 1,
      "tempoMedioResolucaoMinutos": 1680
    }],
    "metricas": {
      "totalResolvidos": 2,
      "tempoMedioHoras": 28,
      "tempoMinimoHoras": 28,
      "tempoMaximoHoras": 28,
      "atendenteDestaque": { "agentId": 2, "agent": "Bruno Atendente", "concluidos": 1 },
      "taxaResolucaoPercentual": 40
    },
    "ticketsPorDia": [{ "dia": "2026-08-05", "total": 5, "urgentes": 2 }]
  }
}
```

As sete consultas rodam em paralelo (`Promise.all`), então o tempo total é o da mais lenta, não a soma.

### `GET /api/dashboard/me` · `ATENDENTE` e `ADMIN`

```json
{
  "success": true,
  "data": { "totalAtribuidos": 2, "emAtendimento": 1, "concluidos": 1, "urgentesPendentes": 0 }
}
```

---

## Exemplos com curl

Login e captura do token:

```bash
curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@helpdesk.com\",\"password\":\"Senha@123\"}"
```

Listar tickets urgentes em aberto:

```bash
curl -s "http://localhost:3000/api/tickets?status=ABERTO&priority=URGENTE" -H "Authorization: Bearer SEU_TOKEN"
```

Abrir um chamado:

```bash
curl -s -X POST http://localhost:3000/api/tickets -H "Authorization: Bearer SEU_TOKEN" -H "Content-Type: application/json" -d "{\"title\":\"Não consigo acessar minha conta\",\"description\":\"O login retorna erro 500 desde ontem à noite.\",\"categoryId\":4}"
```

Assumir e resolver:

```bash
curl -s -X POST http://localhost:3000/api/tickets/1/claim -H "Authorization: Bearer SEU_TOKEN"
```

```bash
curl -s -X PATCH http://localhost:3000/api/tickets/1/status -H "Authorization: Bearer SEU_TOKEN" -H "Content-Type: application/json" -d "{\"status\":\"RESOLVIDO\"}"
```
