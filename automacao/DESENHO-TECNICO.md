# Automação 1 — Triagem de tickets do helpdesk com IA

> **Sistema alvo:** `E:\projetos\helpdesk-api` — Node 18 (ESM), Express 4, **MySQL 8**, SQL à mão, JWT, Zod. Porta 3000.
> **Objetivo:** ticket novo entra na fila → a IA classifica, prioriza, resume e avisa a equipe → humano assume.
> **Cobre do roadmap:** fase 2 inteira (webhook/schedule trigger, credentials, expressions, HTTP Request, error workflow, node Code) + o item de IA da fase 3.

---

## O que a automação faz

```
ticket novo (status ABERTO, sem dono)
        │
        ├─ 1. n8n detecta            (Schedule na v1 · Webhook na v2)
        ├─ 2. GET /api/categories    (lista fechada de categorias ativas)
        ├─ 3. LLM classifica         → { categoryId, priority, resumo, sinais, confianca }
        ├─ 4. PUT  /api/tickets/:id           → corrige a categoria
        ├─ 5. PATCH /api/tickets/:id/priority → define a prioridade real
        ├─ 6. POST /api/tickets/:id/messages  → NOTA INTERNA com o resumo  ⚠️ ver armadilha
        └─ 7. notifica o canal da equipe (URGENTE vai por um caminho separado)
```

**O bot não assume o ticket.** Ver "Decisão 3".

---

## ⚠️ A armadilha — Regra 20

`src/services/message.service.js`, função `applySideEffects`:

```js
if (isStaff(actor) && !isInternal && ticket.status === TICKET_STATUS.ABERTO) {
  await ticketRepository.update(ticket.id, {
    status: TICKET_STATUS.EM_ATENDIMENTO,
    agentId: ticket.agent?.id ?? actor.id,
  });
}
```

Se o bot (que é staff) postar uma mensagem **pública** num ticket `ABERTO` sem dono, a API entende que **ele começou o atendimento**: move para `EM_ATENDIMENTO` e coloca o bot como responsável.

Resultado: o ticket **some da fila humana**, marcado como "em atendimento", com um robô de dono. Ninguém trabalha nele, e o relatório de SLA passa a mentir. Nenhum erro aparece — a automação parece funcionar.

**A correção é uma flag:** `isInternal: true`. A própria regra 20 exclui nota interna de propósito ("é só um rascunho da equipe, não um atendimento começando"). O resumo da IA é exatamente isso.

```json
POST /api/tickets/42/messages
{ "content": "[triagem-ia] ...", "isInternal": true }
```

---

## Decisões de desenho

### 1. O bot é `ATENDENTE`, não `ADMIN`

Menor privilégio possível. Com `ATENDENTE` ele já pode: mudar categoria (`PUT /tickets/:id`), mudar prioridade (`PATCH /tickets/:id/priority`), escrever nota interna.

O único motivo para precisar de `ADMIN` seria **distribuir ticket para outro atendente** — regra 11: *"Atendentes só podem assumir tickets para si. Apenas o admin reatribui para terceiros."* Como o bot não atribui (decisão 3), `ATENDENTE` basta.

**Bônus de segurança que já existe:** `authenticate` relê o usuário do banco a cada requisição. Desativar o usuário do bot (`is_active = false`) mata a automação **na hora**, sem esperar o JWT expirar. É o botão de emergência, e ele já está construído.

### 2. Login a cada execução, não token fixo

O JWT do projeto não tem refresh token. Um token colado numa credencial do n8n vai expirar e quebrar o fluxo em silêncio.

Primeiro node do workflow: `POST /api/auth/login` com as credenciais do bot → guarda o token → usa nos nodes seguintes via expression. Custo: uma requisição por execução.

### 3. O bot **não** assume nem atribui o ticket

`assign` num ticket `ABERTO` muda o status para `EM_ATENDIMENTO` (`ticket.service.js`, linha ~372). Se o bot atribuir, o ticket fica "em atendimento" **antes de qualquer humano olhar** — a mesma mentira da armadilha acima, só que por outra porta.

O bot **classifica e avisa**. Quem clica em `claim` é gente. A máquina de estados continua significando o que foi desenhada para significar.

### 4. Idempotência: o marcador `[triagem-ia]`

O trigger por Schedule busca `status=ABERTO&unassigned=true`. Enquanto ninguém assumir, **o mesmo ticket volta em toda execução** — e seria re-triado a cada 5 minutos, empilhando notas.

Solução: antes de processar, `GET /api/tickets/:id/messages` e pular se já existir nota interna começando com `[triagem-ia]`.

O estado de "já foi triado" mora **no sistema de registro**, não na memória do n8n. Sobrevive a restart do container, a reimportar o workflow, a rodar dois n8n ao mesmo tempo. É a mesma lógica de idempotência do `billing-platform` — só que a chave é o marcador em vez de um `@@unique`.

> Vale também na v2 com webhook: retry de entrega dispara o mesmo ticket duas vezes.

### 5. URGENTE só existe pela triagem

Regra 5: cliente que pede `URGENTE` recebe `ALTA` — senão todo chamado é urgente. Ou seja, `URGENTE` **só pode ser posto pela equipe**.

Isso dá um papel real à IA em vez de decorativo: ela é o caminho legítimo de um chamado chegar a `URGENTE` em minutos, em vez de esperar alguém abrir a fila. E justifica o caminho de escalonamento separado.

### 6. Confiança baixa → não decide, escala

Se o modelo devolver `confianca < 0.7`, ou JSON inválido, ou uma `categoryId` fora da lista: **não altera nada**. Escreve a nota interna dizendo que não conseguiu classificar e avisa o canal pedindo triagem humana.

Automação que erra sozinha é pior que automação que não roda. Isso é o "tratamento de erro" da fase 2 com consequência de negócio, não um `try/catch` decorativo.

---

## Contrato do LLM

**Entrada:** título + descrição do ticket + a lista de categorias ativas (vinda de `GET /api/categories` — nunca hardcoded, senão categoria nova quebra a triagem em silêncio).

**Saída — JSON estrito:**

```json
{
  "categoryId": 3,
  "priority": "ALTA",
  "resumo": "Cliente não consegue emitir nota desde a atualização de ontem; afeta o faturamento do mês.",
  "sinais": ["bloqueio operacional", "menciona prazo legal"],
  "confianca": 0.86
}
```

Regras no prompt: `categoryId` **obrigatoriamente** um dos ids recebidos; `priority` um de `BAIXA|MEDIA|ALTA|URGENTE`; nada de texto fora do JSON. Validar a saída num node **Code** antes de tocar na API — o modelo pode alucinar um id.

---

## Endpoints que o workflow usa

| Passo | Método e rota | Observação |
|---|---|---|
| Login | `POST /api/auth/login` | devolve o JWT do bot |
| Fila | `GET /api/tickets?status=ABERTO&unassigned=true&sortBy=createdAt&sortOrder=asc` | `unassigned=true` já existe no validador — a fila sem dono é um filtro de primeira classe |
| Conversa | `GET /api/tickets/:id/messages` | checagem do marcador `[triagem-ia]` |
| Categorias | `GET /api/categories` | só as ativas entram no prompt |
| Categoria | `PUT /api/tickets/:id` | corpo: `{ "categoryId": N }` |
| Prioridade | `PATCH /api/tickets/:id/priority` | corpo: `{ "priority": "ALTA" }` |
| Nota | `POST /api/tickets/:id/messages` | corpo: `{ "content": "...", "isInternal": true }` |

---

## v1 → v2: o pulo que vale no portfólio

**v1 — Schedule (polling).** Zero alteração no helpdesk. Roda a cada 5 min. Fica de pé num dia.

**v2 — Webhook (push).** O helpdesk passa a **disparar** um POST para o n8n quando um ticket é criado. Exige mexer no `ticket.service.js`.

A v2 é o item *"consumir e também disparar webhooks — automação de mão dupla, não só receber"* da fase 3 do roadmap. E o jeito certo de fazer é o padrão que ele já implementou no `billing-platform`: **outbox** — gravar o evento numa tabela dentro da transação que cria o ticket, e um worker entrega depois. Disparar HTTP dentro da transação é o erro clássico: se o n8n estiver fora do ar, ou a criação do ticket falha, ou o evento se perde.

> Fazer a v1 primeiro não é preguiça: é ter o fluxo funcionando ponta a ponta antes de mudar o sistema de produção. A v2 vira um commit isolado e explicável.

---

## Resultado dos testes do modelo — 26/08/2026

Testado o `qwen2.5:3b` local (CPU, `temperature: 0`) com 4 chamados de gravidades diferentes, **antes** de montar os nodes. Três versões de prompt:

| Chamado | Esperado | v1 simples | v2 rubrica + exemplos | v3 extrai fatos, regra no código |
|---|---|---|---|---|
| "Esqueci a senha, **sem pressa**" | BAIXA | 🔴 URGENTE | ✅ BAIXA | 🔴 MEDIA |
| Impressora (têm outra) | MEDIA | 🔴 URGENTE | 🔴 ALTA | 🔴 ALTA |
| NF trava, prazo sexta, multa | ALTA | 🔴 URGENTE | ✅ ALTA | 🔴 URGENTE |
| Operação parada, 40 pessoas | URGENTE | ✅ URGENTE | 🔴 ALTA | ✅ URGENTE |

**Categoria: acertou em todas as versões.** Prioridade: nenhuma versão passou.

Três achados que mudaram o desenho:

1. **O modo de falha é "tudo é urgente".** Na v1, os 4 chamados viraram URGENTE — inclusive um que diz literalmente *"não tem pressa"*.
2. **`confianca` auto-declarada é inútil.** O modelo respondeu `0.9` em tudo, inclusive nos erros. O portão de `confiancaMinima` não filtraria nada — foi removido do validador.
3. **Extrair fatos e decidir no código (v3) não salvou.** A hipótese era boa — o LLM extrai, a regra decide, igual ao `STATUS_TRANSITIONS` que é tabela e não `if` espalhado. Mas a *extração* também erra: disse `pessoas=setor` para um chamado de uma pessoa só, e `consegue_trabalhar=false` num texto que diz *"conseguimos usar a do financeiro"*. Regra determinística sobre entrada errada continua errada.

### O 7B resolveu — 4 de 4

Depois do reinício, com memória disponível, testado o **`qwen2.5:7b`** com a rubrica da v2:

| Chamado | Esperado | `qwen2.5:3b` | `qwen2.5:7b` |
|---|---|---|---|
| "Esqueci a senha, sem pressa" | BAIXA | 🔴 URGENTE | ✅ **BAIXA** |
| Impressora (têm outra) | MEDIA | 🔴 URGENTE | ✅ **MEDIA** |
| NF trava, prazo sexta, multa | ALTA | 🔴 URGENTE | ✅ **ALTA** |
| Operação parada, 40 pessoas | URGENTE | ✅ URGENTE | ✅ **URGENTE** |

O raciocínio intermediário confirma que não foi sorte: *"1 pessoa, existe alternativa"* na impressora; *"40 pessoas, sem alternativa, prazo hoje"* na parada. E acertou a NF como **Software** (o 3B chutou Financeiro).

> [!important] A decisão final
> **Modelo: `qwen2.5:7b`.** Categoria e prioridade são aplicadas; o node `Define prioridade` está ativo.
>
> Não é "modelo maior é melhor" — é que **prioridade exige julgamento de impacto**, e essa é a capacidade que falta no 3B. Categoria é reconhecimento de padrão, e nisso o 3B já ia bem. Duas tarefas, dificuldades diferentes, no mesmo prompt.

**O que faz o prompt funcionar** (as três coisas juntas, nenhuma decorativa):

1. **Rubrica com critério objetivo** por nível — "existe alternativa?", "quantas pessoas?", "há prazo?" — em vez de adjetivos como "importante" ou "crítico".
2. **Calibração explícita:** *"URGENTE é raro, menos de 1 em 20."* Sem essa linha, o modelo marca tudo como urgente — foi o modo de falha medido.
3. **Ordem dos campos:** `sinais` e `impacto` vêm **antes** de `priority` no JSON. O modelo gera token a token, então a decisão sai do raciocínio já escrito, em vez de um palpite que ele depois tenta justificar.

**Sem campo de confiança.** O modelo respondia `0.9` em tudo, inclusive nos erros. Auto-avaliação de confiança não serve de portão; validação de schema serve.

**Desempenho medido:** 55 s no primeiro chamado (carregamento do modelo na VRAM), depois **3,7 a 3,9 s** por chamado — cabe nos 6 GB da GTX 1660 SUPER. Com `batchSize: 1` e ciclo de 5 minutos, sobra folga. O `timeout` de 180 s no node do Ollama está adequado.

---

## Bateria de testes — 27/08/2026

Sete baterias. **Um bug real encontrado e corrigido.**

| Teste | Resultado |
|---|---|
| Portão de validação, 15 casos | ✅ 15/15 |
| Auditoria de configuração, 23 checagens | ✅ 23/23 |
| Descrição de 5000 chars com o fato no final | ✅ sem truncamento |
| Ollama fora do ar | ✅ falha limpa, ticket intacto |
| Ollama volta | ✅ recupera sozinho, sem duplicar nota |
| API do helpdesk fora do ar | ✅ falha limpa |
| Fila com 35 chamados | 🐛 **bug encontrado** |

Os testes ficam em `testes/` e rodam **offline**, sem precisar de nada no ar:

```bash
node testes/testa-validador.js
node testes/audita-workflow.js
```

### `testa-validador.js` — o portão de segurança

Executa o `jsCode` **real** extraído do workflow, com entradas simuladas. Teste
que reimplementa a lógica testa a cópia, não o que roda.

Barra: categoria alucinada, prioridade inventada, texto solto, JSON truncado,
`null`, array, campos faltando, id negativo, id zero. Aceita: `categoryId` como
string, prioridade em minúsculas. E verifica duas invariantes em **todos** os
casos — a nota sempre existe com o marcador, e quando `ok=false` a categoria e a
prioridade saem nulas, para nada chegar na API.

### `audita-workflow.js` — as proteções continuam no lugar

Não testa lógica: testa que ninguém removeu uma proteção. Cada verificação
explica **por que importa** — se o `isInternal: true` sumir, o teste falha
dizendo que o robô passaria a sequestrar tickets da fila humana.

### O bug: inanição da fila

Com 35 chamados, a automação **parou de processar sem dar sinal**. Quinze tickets
ficaram 26 minutos parados com todas as execuções marcadas como `success`.

Causa: `limit=20` ordenado por `createdAt asc`, somado ao fato de que o bot **não
assume o ticket** de propósito — então chamado já triado continua `ABERTO` e sem
dono, e continua aparecendo na busca. Quando chegaram a 20, ocuparam todos os
slots e os novos nunca mais foram alcançados.

> [!danger] Falha sem sintoma
> Nada quebra, nenhum retry dispara, o painel fica verde. Você só descobre por
> reclamação de cliente.

Corrigido com ordem `desc` e `limit=100`: de travado indefinidamente para **15
chamados num único ciclo**, fila zerada em 5,7 minutos. A auditoria ganhou duas
verificações para impedir o `asc` de voltar.

É mitigação, não cura — com 100 tickets encalhados o problema volta. A cura é a
**v2 por webhook**, sem fila para varrer.

### A sequência de publicação, que não é óbvia

Depois de corrigir a query, o bug continuou. Banco correto, `activeVersionId`
correto, painel mostrando publicado — e a execução ainda mandando `limit=20`.

```
import:workflow  →  publicar na tela  →  REINICIAR o n8n
```

Pular o reinício deixa o agendador rodando a definição antiga, em silêncio.
**Conferir no banco não prova nada**; a prova é o `meta` da resposta HTTP dentro
do registro da execução.

---

## Pendências antes de começar

- [ ] MySQL do helpdesk rodando + `npm run db:reset` (contas demo, senha `Senha@123`)
- [ ] Criar o usuário do bot com role `ATENDENTE` (ex: `bot@helpdesk.com`) — via admin
- [ ] n8n de pé (`n8n/docker-compose.yml` nesta pasta)
- [ ] Definir o provedor de LLM e o canal de notificação
- [ ] ⚠️ **Conflito de porta:** a 3000 é disputada com o `backend-api` do marketing dashboard. Não subir os dois juntos.
