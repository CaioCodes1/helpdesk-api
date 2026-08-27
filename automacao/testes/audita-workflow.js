/**
 * Auditoria de configuracao do workflow de triagem.
 *
 * Nao testa logica: testa que as PROTECOES continuam no lugar. Cada verificacao
 * aqui existe porque a ausencia dela causa um bug real e silencioso - e bug
 * silencioso e o unico tipo que sobrevive a uma revisao desatenta.
 *
 * Uso:  node testes/audita-workflow.js
 */

import fs from 'node:fs';
import path from 'node:path';

// Prefere o arquivo real (que fica fora do git, com as credenciais) e cai no
// .example.json quando ele nao existe - e o caso de um clone limpo.
const CANDIDATOS = ['workflow-triagem-helpdesk.json', 'workflow-triagem-helpdesk.example.json'];
const WORKFLOW = CANDIDATOS.map((n) => path.join(import.meta.dirname, '..', 'n8n', n)).find(fs.existsSync);
if (!WORKFLOW) {
  console.error('Nao encontrei o workflow em ../n8n/');
  process.exit(1);
}
const w = JSON.parse(fs.readFileSync(WORKFLOW, 'utf8'));
const node = (nome) => w.nodes.find((n) => n.name === nome);
const texto = (n) => JSON.stringify(n && n.parameters ? n.parameters : {});

const checks = [];
const ok = (nome, cond, porque) => checks.push({ nome, passou: !!cond, porque });

// ---------------------------------------------------------------------------
// A protecao mais importante do projeto inteiro.
// ---------------------------------------------------------------------------
const nota = node('Nota interna');
ok(
  'nota vai como isInternal: true',
  nota && /isInternal:\s*true/.test(texto(nota)),
  'Regra 20 do message.service: mensagem PUBLICA de staff em ticket ABERTO sem ' +
    'dono faz o autor ASSUMIR o ticket. Sem esta flag o bot vira responsavel e o ' +
    'chamado some da fila humana, marcado como EM_ATENDIMENTO, sem erro nenhum.',
);

// ---------------------------------------------------------------------------
// Idempotencia
// ---------------------------------------------------------------------------
const jaTriado = node('Ja triado?');
ok(
  'checagem do marcador antes de processar',
  jaTriado && /marcador/.test(texto(jaTriado)) && /isInternal/.test(texto(jaTriado)),
  'Sem isto o mesmo ticket e re-triado a cada ciclo enquanto ninguem assumir, ' +
    'empilhando notas.',
);
const cfg = node('Config');
const assign = cfg ? cfg.parameters.assignments.assignments : [];
const val = (n) => (assign.find((a) => a.name === n) || {}).value;
ok('marcador definido no Config', !!val('marcador'), 'E a chave da idempotencia.');

// ---------------------------------------------------------------------------
// Inanicao da fila - bug real encontrado em 27/08/2026
// ---------------------------------------------------------------------------
const fila = node('Fila de tickets');
const qp = fila ? fila.parameters.queryParameters.parameters : [];
const qv = (n) => (qp.find((x) => x.name === n) || {}).value;

ok(
  'fila ordenada do mais novo para o mais antigo (desc)',
  String(qv('sortOrder')).toLowerCase() === 'desc',
  'Com ordem ASC, os tickets ja triados - que continuam ABERTO e sem dono, ' +
    'porque o bot nao assume de proposito - ocupam os primeiros slots. Quando ' +
    'chegam ao limite, chamado NOVO nunca mais e alcancado. Medido: 15 tickets ' +
    'ficaram 26 min sem processar com TODAS as execucoes marcadas como success. ' +
    'Falha 100% silenciosa.',
);
ok(
  'limite da busca em 100 (maximo da API)',
  Number(qv('limit')) >= 100,
  'Quanto menor o limite, menos tickets encalhados bastam para travar a fila.',
);

// ---------------------------------------------------------------------------
// Rede: a pegadinha do IPv6
// ---------------------------------------------------------------------------
ok(
  'ollamaUrl usa 127.0.0.1, nao localhost',
  String(val('ollamaUrl')).includes('127.0.0.1'),
  'O Node resolve localhost para ::1 (IPv6) primeiro e o Ollama escuta so em ' +
    'IPv4 - da ECONNREFUSED com o servico no ar.',
);

// ---------------------------------------------------------------------------
// keep_alive contra o intervalo do schedule
// ---------------------------------------------------------------------------
const ollama = node('Ollama classifica');
const trigger = node('A cada 5 minutos');
const minutos =
  trigger && trigger.parameters.rule && trigger.parameters.rule.interval
    ? trigger.parameters.rule.interval[0].minutesInterval
    : null;
const keepAlive = (texto(ollama).match(/keep_alive:\s*'(\d+)([mh])'/) || []).slice(1);
const keepMin = keepAlive.length
  ? Number(keepAlive[0]) * (keepAlive[1] === 'h' ? 60 : 1)
  : 5; // padrao do Ollama
ok(
  'keep_alive (' + keepMin + 'min) maior que o intervalo do schedule (' + minutos + 'min)',
  keepMin > minutos,
  'Se o keep_alive for menor ou igual ao intervalo, o modelo e descarregado e ' +
    'recarregado a cada ciclo - e cada recarga de ~5 GB pode falhar por memoria.',
);

// ---------------------------------------------------------------------------
// Determinismo e formato
// ---------------------------------------------------------------------------
ok(
  "Ollama com format: 'json'",
  /format:\s*'json'/.test(texto(ollama)),
  'Sem isso o modelo devolve prosa e o validador barra tudo.',
);
ok(
  'temperature: 0',
  /temperature:\s*0/.test(texto(ollama)),
  'O mesmo ticket precisa sair sempre igual - senao nao da para reproduzir bug.',
);

// ---------------------------------------------------------------------------
// Resiliencia
// ---------------------------------------------------------------------------
const http = w.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
const semRetry = http.filter((n) => !n.retryOnFail).map((n) => n.name);
ok(
  'todo node HTTP tem retryOnFail',
  semRetry.length === 0,
  'Falha de rede momentanea nao pode derrubar o ciclo. Sem retry: ' + semRetry.join(', '),
);

const discord = node('Avisa no Discord');
ok(
  'falha no Discord nao derruba o loop',
  discord && discord.onError === 'continueRegularOutput',
  'A classificacao ja foi gravada no ticket; o aviso e o extra. Se o Discord ' +
    'cair, os proximos tickets ainda precisam ser processados.',
);

ok(
  'timeout generoso no Ollama',
  /timeout":\s*\d{5,}/.test(texto(ollama)) || /timeout['"]?:\s*\d{5,}/.test(texto(ollama)),
  'A primeira chamada carrega o modelo na VRAM e leva ~55s.',
);

// ---------------------------------------------------------------------------
// Um ticket por vez
// ---------------------------------------------------------------------------
const loop = node('Loop tickets');
ok(
  'batchSize = 1',
  loop && loop.parameters.batchSize === 1,
  'O modelo local nao aguenta paralelismo, e erro em um ticket nao pode ' +
    'derrubar os outros.',
);

// ---------------------------------------------------------------------------
// Categorias vem da API
// ---------------------------------------------------------------------------
const prompt = node('Monta o prompt');
ok(
  'categorias lidas da API, nao fixas no prompt',
  prompt && /\$\('Categorias'\)/.test(prompt.parameters.jsCode),
  'Categoria nova entraria em producao sem a IA saber que existe.',
);
ok(
  'so categorias ativas entram no prompt',
  prompt && /is_active/.test(prompt.parameters.jsCode),
  'A API recusa ticket novo em categoria desativada - sugerir uma daria 400.',
);

// ---------------------------------------------------------------------------
// Calibracao do prompt (as tres coisas que fizeram funcionar)
// ---------------------------------------------------------------------------
const jsPrompt = prompt ? prompt.parameters.jsCode : '';
ok(
  'prompt tem calibracao de raridade do URGENTE',
  /menos de 1 em 20|raro/i.test(jsPrompt),
  'Sem essa linha o modelo marca todo chamado como URGENTE - foi o modo de ' +
    'falha medido no qwen2.5:3b.',
);
ok(
  'raciocinio (sinais/impacto) vem ANTES de priority no formato',
  jsPrompt.indexOf('"impacto"') > -1 &&
    jsPrompt.indexOf('"impacto"') < jsPrompt.indexOf('"priority"'),
  'O modelo gera token a token: a decisao precisa sair do raciocinio ja ' +
    'escrito, nao de um palpite justificado depois.',
);

// ---------------------------------------------------------------------------
// Integridade estrutural
// ---------------------------------------------------------------------------
const nomes = w.nodes.map((n) => n.name);
const alvos = new Set();
for (const v of Object.values(w.connections)) {
  for (const saida of v.main) for (const c of saida) alvos.add(c.node);
}
const orfaos = [...alvos].filter((a) => !nomes.includes(a));
ok('todas as conexoes apontam para nodes existentes', orfaos.length === 0, orfaos.join(', '));

const semEntrada = nomes.filter((n) => !alvos.has(n));
ok(
  'apenas o trigger fica sem entrada',
  semEntrada.length === 1 && semEntrada[0] === 'A cada 5 minutos',
  'Node solto nunca executa. Sem entrada: ' + semEntrada.join(', '),
);

const desativados = w.nodes.filter((n) => n.disabled).map((n) => n.name);
ok('nenhum node desativado', desativados.length === 0, 'Desativados: ' + desativados.join(', '));

for (const n of w.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
  let erro = null;
  try {
    new Function('$', '$json', '$input', n.parameters.jsCode);
  } catch (e) {
    erro = e.message;
  }
  ok('JS compila: ' + n.name, !erro, erro || '');
}

// ---------------------------------------------------------------------------
// Credenciais (aviso, nao falha)
// ---------------------------------------------------------------------------
// Detecta credencial DE VERDADE, nao o placeholder: a URL real do Discord tem
// um id numerico longo seguido de um token; a de exemplo tem 'SEU/WEBHOOK'.
const ehPlaceholder = (s) => /^(COLOQUE|TROQUE|SUA|SEU)/i.test(String(s || ''));
const temSegredo =
  /discord\.com\/api\/webhooks\/\d{8,}\/\S{20,}/.test(String(val('discordWebhook') || '')) ||
  (val('botSenha') && !ehPlaceholder(val('botSenha')));

// ---------------------------------------------------------------------------

let falhou = 0;
console.log('Auditoria do workflow: ' + w.name + '\n');
for (const c of checks) {
  if (c.passou) {
    console.log('  OK  ' + c.nome);
  } else {
    falhou++;
    console.log('  XX  ' + c.nome);
    console.log('      por que importa: ' + c.porque);
  }
}

console.log('\n' + (checks.length - falhou) + ' de ' + checks.length + ' verificacoes passaram');

if (temSegredo) {
  console.log(
    '\n  AVISO: o node Config contem credenciais reais (webhook do Discord e/ou\n' +
      '  senha do bot). NAO versionar este arquivo - publicar so a versao .example.',
  );
}

process.exit(falhou === 0 ? 0 : 1);
