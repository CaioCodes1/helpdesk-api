# Arquitetura

Este documento explica **como o código está organizado e por quê**. A pergunta que ele responde é: se eu precisar mudar alguma coisa, onde eu mexo?

---

## Estrutura de pastas

```
helpdesk-api/
├── database/
│   ├── schema.sql            DDL: tabelas, chaves, índices
│   ├── migrate.js            Aplica o schema
│   └── seed.js               Dados de demonstração
│
├── src/
│   ├── config/
│   │   ├── env.js            Único lugar que lê process.env
│   │   └── database.js       Pool MySQL, helpers query() e withTransaction()
│   │
│   ├── constants/index.js    ROLES, STATUS, PRIORIDADES, máquina de estados
│   ├── errors/AppError.js    Classes de erro tipadas (404, 403, 409...)
│   │
│   ├── middlewares/
│   │   ├── auth.middleware.js           authenticate + authorize
│   │   ├── validate.middleware.js       Validação com Zod
│   │   ├── error.middleware.js          Tratamento centralizado de erros
│   │   └── requestLogger.middleware.js  Log de acesso
│   │
│   ├── validators/           Schemas Zod por recurso
│   ├── routes/               Mapa de endpoints + cadeia de middlewares
│   ├── controllers/          Tradução HTTP ⇄ domínio
│   ├── services/             REGRAS DE NEGÓCIO
│   ├── repositories/         SQL — único lugar que fala com o banco
│   ├── utils/                logger, jwt, password, paginação, respostas
│   ├── docs/swagger.js       Especificação OpenAPI
│   │
│   ├── app.js                Monta o Express (não escuta porta)
│   └── server.js             Sobe o servidor e trata o ciclo de vida
│
├── public/                   Frontend de demonstração
└── tests/                    Testes unitários
```

---

## O caminho de uma requisição

Exemplo real: um atendente marca o ticket 7 como resolvido.

```
PATCH /api/tickets/7/status   { "status": "RESOLVIDO" }
   │
   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ app.js — middlewares globais                                         │
│   helmet → cors → express.json() → requestLogger                     │
│   Resultado: req.body vira objeto JavaScript                         │
└──────────────────────────────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ routes/ticket.routes.js — casa a rota e encadeia os middlewares      │
└──────────────────────────────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ middlewares/auth.middleware.js — authenticate                        │
│   1. lê o header Authorization                                       │
│   2. verifica assinatura e expiração do JWT                          │
│   3. busca o usuário no banco (role e is_active podem ter mudado)    │
│   4. preenche req.user                                               │
│   Falhou? → 401                                                      │
└──────────────────────────────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ middlewares/validate.middleware.js                                   │
│   params: id é inteiro positivo?                                     │
│   body:   status é um dos quatro valores permitidos?                 │
│   Falhou? → 422 com a lista de campos                                │
│   Passou? → req.body/req.params são SUBSTITUÍDOS pelos normalizados  │
└──────────────────────────────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ controllers/ticket.controller.js                                     │
│   const ticket = await ticketService.updateStatus(                   │
│     req.params.id, req.body.status, req.user);                       │
│   return ok(res, ticket, `Status alterado para ${ticket.status}`);   │
│   → 4 linhas. Zero regra de negócio.                                 │
└──────────────────────────────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ services/ticket.service.js — AQUI MORA A INTELIGÊNCIA                │
│   1. busca o ticket           → não achou? NotFoundError             │
│   2. assertCanView            → é dono ou é equipe?                  │
│   3. STATUS_TRANSITIONS       → EM_ATENDIMENTO → RESOLVIDO é legal?  │
│   4. quem pode fazer isso?    → cliente só fecha/reabre              │
│   5. efeitos colaterais       → carimba resolved_at = agora          │
└──────────────────────────────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ repositories/ticket.repository.js                                    │
│   UPDATE tickets SET status = ?, resolved_at = ? WHERE id = ?        │
│   Só SQL parametrizado. Nenhum `if` de negócio.                      │
└──────────────────────────────────────────────────────────────────────┘
   │
   ▼
                              MySQL
```

**Na volta**, o objeto sobe pelas mesmas camadas até o controller montar a resposta.

**Se qualquer camada lançar um erro**, o `asyncHandler` captura e chama `next(error)`, que pula direto para o `errorHandler` — sem passar pelas camadas restantes.

---

## O papel de cada camada

### `routes/` — o mapa

Declara quais URLs existem e qual cadeia de middlewares cada uma atravessa. Ler o arquivo de rotas deve responder em segundos: *quem pode acessar isso e o que é validado?*

```js
router.delete('/:id', authorize(ROLES.ADMIN), validate({ params: idParamSchema }), ticketController.remove);
```

Não contém lógica. Se um `if` apareceu aqui, ele está no lugar errado.

### `middlewares/` — preocupações transversais

Código que precisa rodar em muitas rotas: autenticação, autorização por papel, validação, log, tratamento de erro. São funções `(req, res, next)` executadas na ordem em que foram registradas.

### `controllers/` — a fronteira HTTP

Fazem três coisas: extrair dados de `req`, chamar **um** método do service, formatar a resposta com o status correto.

**Regra prática:** se um controller passou de ~10 linhas, lógica vazou para dentro dele.

### `services/` — as regras de negócio

O coração. Aqui vivem as respostas para "pode ou não pode", "o que acontece quando", "qual o próximo estado".

Um service **não conhece** `req`, `res`, status HTTP ou SQL. Ele recebe dados simples, aplica regras e devolve dados simples. Quando algo é inválido, ele **lança** um erro tipado (`throw new ConflictError(...)`) — não devolve `{ error: ... }`, porque isso obrigaria toda chamada a checar o retorno.

### `repositories/` — o acesso a dados

Único lugar do projeto com string SQL. Regras:

1. Nenhuma decisão de negócio.
2. Nenhuma referência a `req`/`res`.
3. Todo valor externo entra como `?` (prepared statement).

### `validators/` — o formato da entrada

Schemas Zod que garantem que os dados **chegaram no formato certo**. Importante: validador cuida de **formato**, service cuida de **permissão e regra**.

O validador de `POST /tickets` aceita o campo `clientId`. Quem decide se você *pode* preenchê-lo (só admin) é o service — o validador nem tem acesso a `req.user`.

---

## Por que separar Controller e Service?

O argumento decisivo é **testabilidade e reuso**.

A regra *"ticket fechado não recebe mensagem"* não tem nada a ver com HTTP. Se ela morasse no controller:

- testá-la exigiria simular objetos `req` e `res` falsos;
- reaproveitá-la num job agendado ou num comando de CLI seria impossível;
- mudar de Express para Fastify significaria reescrever a regra junto.

Com a separação, `tests/rules.test.js` verifica a máquina de estados **sem subir servidor nem banco**.

O segundo argumento é **um lugar só por assunto**. Quando a pergunta é "quem pode fechar um ticket?", há exatamente um arquivo para abrir: `services/ticket.service.js`.

---

## Onde fica cada coisa

| Pergunta | Arquivo |
|---|---|
| Quais endpoints existem? | `routes/` |
| Quem pode acessar esta rota? | `routes/` (papel) + `services/` (propriedade) |
| Qual o formato aceito no body? | `validators/` |
| Qual regra impede X? | `services/` |
| Qual query roda no banco? | `repositories/` |
| Como o erro vira resposta HTTP? | `middlewares/error.middleware.js` |
| Quais status/prioridades existem? | `constants/index.js` |
| Como o token é gerado/validado? | `utils/jwt.js` |

---

## Autenticação e autorização

São **duas** perguntas, resolvidas em **três** camadas:

```
1. QUEM É VOCÊ?              middlewares/auth.middleware.js → authenticate
   Token válido? Usuário existe? Está ativo?
   Falhou → 401

2. SEU PAPEL PODE ESTA ROTA? middlewares/auth.middleware.js → authorize(...)
   authorize(ROLES.ADMIN)
   Falhou → 403

3. VOCÊ PODE ESTE REGISTRO?  services/ticket.service.js → assertCanView(...)
   Este cliente é dono DESTE ticket? Este atendente é o responsável?
   Falhou → 404 (para não revelar que o recurso existe)
```

**A camada 3 é a que projetos de portfólio esquecem.** Sem ela, a rota parece protegida, mas o cliente A lê o ticket do cliente B trocando o id na URL — falha conhecida como **IDOR** (*Insecure Direct Object Reference*), do OWASP Top 10.

Ela não pode viver num middleware porque depende de dados que só existem depois de consultar o banco.

---

## Tratamento de erros

Fluxo completo:

```
service lança                errorHandler traduz              cliente recebe
─────────────────            ───────────────────              ──────────────
NotFoundError('Ticket')  →   statusCode: 404              →   404 + JSON padrão
ConflictError(...)       →   statusCode: 409              →   409 + JSON padrão
ForbiddenError(...)      →   statusCode: 403              →   403 + JSON padrão
ZodError                 →   ValidationError (422)        →   422 + lista de campos
err.code ER_DUP_ENTRY    →   409 "valor único duplicado"  →   409 (sem citar MySQL)
TypeError inesperado     →   500 genérico + log com stack →   500 sem detalhe interno
```

Três garantias:

1. **Um formato só.** Todo erro sai como `{ success: false, error: { message, details? } }`.
2. **Erro de infra não vaza.** `"Table 'helpdesk.users' doesn't exist"` vira `"Erro interno do servidor"`. A mensagem original vai para o log.
3. **Nada de `try/catch` repetido.** O `asyncHandler` encapsula o `.catch(next)` uma vez só.

---

## Fluxo de dados e transações

A maioria das operações é uma escrita simples. Duas exigem **atomicidade**:

**Criar ticket** — o ticket e sua primeira mensagem (a descrição do problema) são um único evento. Se a mensagem falhar, não queremos um ticket sem histórico:

```js
await withTransaction(async (connection) => {
  const [result] = await connection.execute('INSERT INTO tickets ...');
  await connection.execute('INSERT INTO ticket_messages ...');
  return result.insertId;
});
```

**Seed** — ou todos os dados de demonstração entram, ou nenhum entra.

`withTransaction` garante `COMMIT` no sucesso, `ROLLBACK` no erro e `release()` da conexão em qualquer caso (bloco `finally`). Esquecer o `release` é a causa nº 1 de "a API travou depois de um tempo".

---

## Separação `app.js` / `server.js`

| Arquivo | Responsabilidade |
|---|---|
| `app.js` | Monta a aplicação e **exporta** o `app`. Não chama `listen`. |
| `server.js` | Chama `listen`, testa o banco, trata `SIGINT`/`SIGTERM`. |

Isso permite testes de integração (Supertest usa o `app` sem ocupar porta real) e mantém configuração separada de inicialização.

---

## Convenções

- **Nomes de arquivo:** `recurso.camada.js` (`ticket.service.js`)
- **Exports:** nomeados, nunca `default` — favorece autocomplete e busca
- **Imports de camada:** `import * as ticketRepository from ...` deixa explícito de onde vem cada função
- **Async:** `async/await` em tudo; nada de callbacks
- **SQL:** palavras-chave em maiúsculas, um `?` por valor
- **Idioma:** código e comentários em português (é um projeto de estudo); constantes de domínio também (`ABERTO`, `URGENTE`), o que evita traduzir mentalmente entre banco, API e interface
