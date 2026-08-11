# Banco de Dados

Modelo relacional em MySQL 8, InnoDB, `utf8mb4`. Este documento explica **por que cada tabela existe** e **por que cada relacionamento foi feito daquela maneira**.

---

## Diagrama

```
┌────────────────────────┐
│         users          │
├────────────────────────┤
│ PK id                  │
│ UQ email               │
│    name                │
│    password_hash       │
│    role (ENUM)         │
│    is_active           │
│    created_at          │
│    updated_at          │
└───┬──────────┬─────────┘
    │          │
    │ 1..N     │ 1..N                    ┌─────────────────────┐
    │          │                         │     categories      │
    │ client_id│ agent_id                ├─────────────────────┤
    │          │                         │ PK id               │
    │          │                         │ UQ name             │
    │          │                         │    description      │
    │          │                         │    is_active        │
    │          │                         │    created_at       │
    │          │                         │    updated_at       │
    │          │                         └──────────┬──────────┘
    │          │                                    │ 1..N
    ▼          ▼                                    ▼
┌─────────────────────────────────────────────────────────────┐
│                          tickets                            │
├─────────────────────────────────────────────────────────────┤
│ PK id                                                       │
│ FK client_id    → users(id)       NOT NULL   RESTRICT       │
│ FK agent_id     → users(id)       NULL       SET NULL       │
│ FK category_id  → categories(id)  NOT NULL   RESTRICT       │
│    title, description                                       │
│    status (ENUM), priority (ENUM)                           │
│    created_at, updated_at, resolved_at, closed_at           │
└──────────────────────────┬──────────────────────────────────┘
                           │ 1..N
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      ticket_messages                        │
├─────────────────────────────────────────────────────────────┤
│ PK id                                                       │
│ FK ticket_id → tickets(id)  NOT NULL   CASCADE              │
│ FK user_id   → users(id)    NOT NULL   RESTRICT             │
│    content, is_internal, created_at                         │
└─────────────────────────────────────────────────────────────┘
```

---

## `users`

### Por que existe

É a tabela de identidade. Guarda quem pode entrar no sistema e o que cada pessoa pode fazer.

### Por que os três papéis ficam na MESMA tabela

Cliente, atendente e admin compartilham exatamente os mesmos atributos: nome, e-mail, senha. A diferença é só uma coluna (`role`). O padrão se chama **Single Table Inheritance**.

Tabelas separadas (`clients`, `agents`, `admins`) exigiriam `UNION` em toda consulta de usuário e — pior — quebrariam a chave estrangeira de `tickets`, que precisa apontar para "um usuário", não para "um cliente ou um atendente". SQL não tem FK polimórfica.

O custo é uma tabela com colunas que nem todo papel usa. Aqui isso não acontece: os três usam todas.

### Colunas

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | `INT UNSIGNED AI` | Chave substituta |
| `name` | `VARCHAR(120)` | |
| `email` | `VARCHAR(160)` | **UNIQUE** |
| `password_hash` | `VARCHAR(255)` | Hash bcrypt; 255 acomoda mudança de algoritmo |
| `role` | `ENUM` | `CLIENTE` \| `ATENDENTE` \| `ADMIN` |
| `is_active` | `TINYINT(1)` | Exclusão lógica |
| `created_at` / `updated_at` | `DATETIME` | Gerenciados pelo MySQL |

### Por que `UNIQUE` no e-mail

Validar duplicidade no código **não basta**. Duas requisições simultâneas podem passar pelo `SELECT` de checagem antes de qualquer `INSERT` acontecer — e o banco fica com dois registros. O `UNIQUE` é a única garantia real contra essa corrida.

O código também checa, mas por outro motivo: dar uma mensagem clara (`409 "Este email já está cadastrado"`) em vez de estourar o erro cru do driver.

### Por que `is_active` em vez de `DELETE`

Um usuário que já abriu tickets e escreveu mensagens é parte do histórico. Apagá-lo destruiria a autoria da conversa — e o banco recusaria, por causa do `ON DELETE RESTRICT`.

A API implementa **exclusão inteligente**: sem vínculo nenhum, `DELETE` de verdade; com vínculo, `is_active = 0`.

### Índices

```sql
UNIQUE KEY uq_users_email (email)
KEY idx_users_role_active (role, is_active)
```

O composto `(role, is_active)` serve a `GET /api/users/agents` — "atendentes e admins ativos". Um índice sobre duas colunas resolve o filtro inteiro; dois índices separados obrigariam o MySQL a escolher um e filtrar o resto linha a linha.

---

## `categories`

### Por que é tabela e não `ENUM`

A categoria poderia ser um `ENUM` dentro de `tickets` — mais simples. Mas o requisito diz que o **admin cria, edita e remove categorias em runtime**.

Alterar um `ENUM` exige `ALTER TABLE`, que é DDL: bloqueia a tabela e não se executa a partir de uma requisição HTTP. Logo, categoria vira tabela própria e o ticket guarda só a FK.

### Por que `is_active`

`ON DELETE RESTRICT` impede apagar uma categoria com tickets. Mas o admin geralmente não quer destruir o histórico — quer **parar de oferecer** aquela categoria. `is_active = 0` some dos formulários sem quebrar relatórios antigos.

---

## `tickets`

A entidade central. Três chaves estrangeiras, e cada uma tem um comportamento de exclusão diferente — de propósito.

### `client_id → users(id)` · NOT NULL · RESTRICT

> Um cliente abre muitos tickets. Cada ticket pertence a exatamente um cliente.

- **`NOT NULL`**: ticket órfão não faz sentido de negócio. Alguém sempre pediu ajuda.
- **`RESTRICT`**: o banco recusa apagar um cliente que tem tickets. É a rede de segurança que força a aplicação a desativar em vez de excluir.

### `agent_id → users(id)` · NULL · SET NULL

> Um atendente cuida de muitos tickets. Cada ticket tem no máximo um responsável.

- **`NULL`**: ticket recém-aberto ainda não foi assumido. `NULL` aqui significa "está na fila" — um estado real do negócio, não um dado faltando.
- **`SET NULL`**: se o atendente sai da empresa, o ticket volta para a fila em vez de ser apagado junto com ele.

> **Duas FKs para a mesma tabela.** Isso é normal e chama-se auto-relacionamento múltiplo. A consequência prática: toda query precisa de **dois `JOIN`s em `users` com alias diferentes**:
>
> ```sql
> LEFT JOIN users c ON c.id = t.client_id
> LEFT JOIN users a ON a.id = t.agent_id
> ```
>
> Sem o alias, o MySQL não saberia a qual `users.name` você se refere.

### `category_id → categories(id)` · NOT NULL · RESTRICT

Todo ticket é classificado. `RESTRICT` impede que um ticket aponte para o vazio.

### Por que `resolved_at` e `closed_at` separados

Não guardamos histórico de transições (seria uma tabela de auditoria, fora do escopo). Em vez disso, **carimbamos o instante de cada marco** no próprio ticket. São essas duas colunas que alimentam o tempo médio de resolução do dashboard.

Detalhe de modelagem importante: um ticket fechado **sem** passar por resolvido (cliente desistiu) fica com `resolved_at = NULL`. Como `AVG()` ignora `NULL`, ele **não entra** na média de tempo de resolução. A métrica continua honesta.

### Índices — cada um existe por uma query real

```sql
KEY idx_tickets_client_created  (client_id, created_at DESC)
KEY idx_tickets_agent_status    (agent_id, status)
KEY idx_tickets_status_priority (status, priority)
KEY idx_tickets_category        (category_id)
KEY idx_tickets_created         (created_at)
```

| Índice | Query que ele atende |
|---|---|
| `(client_id, created_at)` | "meus chamados, mais recentes primeiro" — tela do cliente |
| `(agent_id, status)` | "chamados atribuídos a mim" — tela do atendente |
| `(status, priority)` | "fila de trabalho: filtra por status, ordena por prioridade" |
| `(category_id)` | agregação por categoria no dashboard |
| `(created_at)` | filtro por período |

**Por que não indexar tudo?** Todo índice acelera leitura e **desacelera escrita** (o MySQL precisa atualizar cada árvore a cada `INSERT`/`UPDATE`), além de ocupar disco. Índice se cria a partir de uma query que existe, não por precaução.

### Por que a ordem das colunas no índice composto importa

Um índice `(status, priority)` serve para `WHERE status = 'ABERTO'` e para `WHERE status = 'ABERTO' AND priority = 'ALTA'`, mas **não** para `WHERE priority = 'ALTA'` sozinho. O índice é ordenado pela primeira coluna — é o mesmo motivo pelo qual uma lista telefônica ordenada por sobrenome não ajuda a buscar pelo primeiro nome.

---

## `ticket_messages`

### Por que é tabela separada

A conversa é uma lista que cresce sem limite. Guardar tudo num campo `TEXT` do ticket impediria saber **quem** escreveu e **quando**, e tornaria impossível paginar ou filtrar dentro do histórico.

### `ticket_id → tickets(id)` · CASCADE

> Uma mensagem não existe sem o ticket.

`ON DELETE CASCADE`: se o admin apagar o ticket, as mensagens vão junto — automaticamente, pelo banco. O repository não precisa de nenhum `DELETE` manual.

Este é o **único** `CASCADE` do schema, e ele está aqui porque a dependência é existencial: uma mensagem solta não significa nada.

### `user_id → users(id)` · RESTRICT

A autoria é parte do histórico. Nunca apagamos um usuário que já falou em algum ticket.

### Por que NÃO existe `updated_at`

Mensagem é um **evento imutável**. Histórico que pode ser editado não serve como histórico — nem para o cliente, nem para auditoria.

### `is_internal`

Nota interna: visível apenas para `ATENDENTE` e `ADMIN`. O filtro acontece **no SQL**, não em JavaScript depois:

```sql
WHERE m.ticket_id = ? AND m.is_internal = 0
```

Dado que o cliente não pode ver nem sequer sai do banco. Filtrar depois seria uma linha de código de distância de um vazamento.

### Índice

```sql
KEY idx_messages_ticket_created (ticket_id, created_at)
```

A query "mensagens do ticket X em ordem cronológica" é resolvida **inteiramente** por este índice: ele já entrega as linhas do ticket certo, já ordenadas. Sem ele, o MySQL faria uma ordenação extra em memória (`Using filesort`).

---

## Resumo das políticas de exclusão

| FK | Política | Por quê |
|---|---|---|
| `tickets.client_id` | `RESTRICT` | Histórico não pode ser destruído |
| `tickets.agent_id` | `SET NULL` | Atendente sai, ticket volta para a fila |
| `tickets.category_id` | `RESTRICT` | Ticket não pode apontar para o vazio |
| `ticket_messages.ticket_id` | `CASCADE` | Mensagem não existe sem o ticket |
| `ticket_messages.user_id` | `RESTRICT` | Autoria é parte do histórico |

---

## Queries comentadas

### Listagem com os dois JOINs em `users`

```sql
SELECT
  t.id, t.title, t.status, t.priority,
  cat.name AS category_name,
  c.name   AS client_name,
  a.name   AS agent_name
FROM tickets t
LEFT JOIN categories cat ON cat.id = t.category_id
LEFT JOIN users c        ON c.id   = t.client_id
LEFT JOIN users a        ON a.id   = t.agent_id
WHERE t.status IN (?, ?)
ORDER BY FIELD(t.priority, 'BAIXA','MEDIA','ALTA','URGENTE') DESC,
         t.created_at DESC
LIMIT 10 OFFSET 0;
```

**`LEFT JOIN` e não `INNER`:** `agent_id` pode ser `NULL`. Com `INNER JOIN`, todos os tickets ainda na fila **desapareceriam** do resultado — bug clássico e difícil de perceber, porque a query "funciona".

**`FIELD()`:** devolve a posição do valor na lista (`BAIXA`=1 … `URGENTE`=4). Ordenando por ele em `DESC`, urgentes vêm primeiro. Sem isso, o `ORDER BY priority` seria alfabético e `'ALTA'` viria antes de `'URGENTE'` — o que não faz sentido nenhum para quem trabalha na fila.

### Agregação condicional — todos os totais em uma varredura

```sql
SELECT
  COUNT(*)                       AS total,
  SUM(status = 'ABERTO')         AS abertos,
  SUM(status = 'EM_ATENDIMENTO') AS em_atendimento,
  SUM(status = 'RESOLVIDO')      AS resolvidos,
  SUM(status = 'FECHADO')        AS fechados,
  SUM(priority = 'URGENTE')      AS urgentes
FROM tickets;
```

No MySQL uma comparação devolve `1` ou `0`. Somando esses valores, temos a contagem. A alternativa ingênua seriam **seis** queries `COUNT(*) ... WHERE`, ou seja, seis varreduras em vez de uma.

### Métrica de tempo com `TIMESTAMPDIFF`

```sql
SELECT
  COUNT(*)                                                      AS total_resolvidos,
  ROUND(AVG(TIMESTAMPDIFF(MINUTE, created_at, resolved_at)), 0) AS media_minutos
FROM tickets
WHERE resolved_at IS NOT NULL;
```

`AVG()` ignora `NULL` — exatamente o comportamento desejado: tickets ainda abertos não devem puxar a média.

### `LEFT JOIN` para não esconder o zero

```sql
SELECT cat.name, COUNT(t.id) AS total
FROM categories cat
LEFT JOIN tickets t ON t.category_id = cat.id
WHERE cat.is_active = 1
GROUP BY cat.id, cat.name;
```

Partindo de `categories` com `LEFT JOIN`, categorias **sem nenhum ticket** aparecem com total `0`. Com `INNER JOIN` elas sumiriam — e "a categoria Pagamento não teve nenhum chamado" é justamente uma informação que o gestor quer ver.

---

## SQL parametrizado

Todo valor externo entra como `?`, via `pool.execute()` (prepared statement):

```js
// ✅ o SQL vai separado dos valores; o banco não interpreta valor como comando
await query('SELECT * FROM users WHERE email = ?', [email]);

// ❌ nunca — um email como  ' OR '1'='1  vira parte do comando
await query(`SELECT * FROM users WHERE email = '${email}'`);
```

**Duas exceções, ambas seguras por construção:**

1. **`LIMIT` / `OFFSET`** — o protocolo de prepared statement do MySQL não aceita placeholder nessa posição. Interpolamos, mas só depois de `Number.parseInt()`, então apenas um inteiro pode chegar lá.
2. **Nomes de coluna no `ORDER BY`** — não são parametrizáveis. A defesa é uma **whitelist**: `sortBy` só pode ser um de quatro valores fixos, validados por `z.enum()` antes de qualquer coisa. `?sortBy=id;DROP TABLE users` é rejeitado com `422` antes de chegar ao repository.

---

## Recriar o banco

```bash
npm run db:reset
```

Executa `database/schema.sql` (drop + create de tudo) e depois o seed com 5 usuários, 6 categorias, 5 tickets e mensagens.
