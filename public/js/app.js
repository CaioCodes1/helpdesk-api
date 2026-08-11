/**
 * Frontend de demonstracao - JavaScript puro, sem framework.
 *
 * Organizacao: um "router" simples troca a view dentro de #view-container.
 * Cada view e uma funcao async que busca dados na API e renderiza HTML.
 * Nao ha reatividade: apos uma acao, a view e simplesmente re-renderizada.
 * Para o escopo deste projeto (o foco e o backend), isso basta.
 */

const STATUS_LABEL = {
  ABERTO: 'Aberto',
  EM_ATENDIMENTO: 'Em atendimento',
  RESOLVIDO: 'Resolvido',
  FECHADO: 'Fechado',
};

const PRIORITY_LABEL = {
  BAIXA: 'Baixa',
  MEDIA: 'Média',
  ALTA: 'Alta',
  URGENTE: 'Urgente',
};

const state = {
  user: null,
  view: 'tickets',
  ticketId: null,
  filters: { page: 1, status: '', priority: '', categoryId: '', search: '' },
  categories: [],
  agents: [],
};

// ============================================================ HELPERS =====
const $ = (selector) => document.querySelector(selector);
const container = () => $('#view-container');

/** Escapa HTML. Sem isto, um titulo de ticket com <script> viraria XSS. */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toast-area').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function statusBadge(status) {
  return `<span class="badge badge-${status}">${STATUS_LABEL[status] || status}</span>`;
}

function priorityTag(priority) {
  return `<span class="prio prio-${priority}">${PRIORITY_LABEL[priority] || priority}</span>`;
}

const isStaff = () => ['ATENDENTE', 'ADMIN'].includes(state.user?.role);
const isAdmin = () => state.user?.role === 'ADMIN';

function openModal(html) {
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
  $('.modal-backdrop').addEventListener('click', (event) => {
    if (event.target.classList.contains('modal-backdrop')) closeModal();
  });
}
const closeModal = () => ($('#modal-root').innerHTML = '');

/** Wrapper para acoes: mostra o erro da API como toast em vez de quebrar. */
async function run(action, successMessage) {
  try {
    const result = await action();
    if (successMessage) toast(successMessage, 'success');
    return result;
  } catch (error) {
    toast(error.message, 'error');
    return null;
  }
}

// ======================================================= AUTENTICACAO =====
function showAuth() {
  $('#auth-screen').classList.remove('hidden');
  $('#app-screen').classList.add('hidden');
}

async function showApp() {
  $('#auth-screen').classList.add('hidden');
  $('#app-screen').classList.remove('hidden');

  const { name, role } = state.user;
  $('#user-name').textContent = name;
  $('#user-role').textContent = role;
  $('#user-role').className = `badge badge-${role}`;
  $('#user-avatar').textContent = name.charAt(0).toUpperCase();

  // Esconde do menu o que a role nao pode acessar. Isso e conveniencia de UI,
  // NAO seguranca: o backend continua barrando de qualquer jeito. Esconder
  // botao no frontend nunca protege nada.
  document.querySelectorAll('#main-nav .nav-item').forEach((item) => {
    const roles = item.dataset.role;
    item.classList.toggle('hidden', Boolean(roles) && !roles.split(',').includes(state.user.role));
  });

  const categories = await run(() => API.categories.list());
  state.categories = categories?.data ?? [];

  if (isStaff()) {
    const agents = await run(() => API.users.agents());
    state.agents = agents?.data ?? [];
  }

  navigate('tickets');
}

function bindAuthScreen() {
  document.querySelectorAll('[data-auth-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-auth-tab]').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const isLogin = tab.dataset.authTab === 'login';
      $('#login-form').classList.toggle('hidden', !isLogin);
      $('#register-form').classList.toggle('hidden', isLogin);
    });
  });

  document.querySelectorAll('.demo-btn').forEach((button) => {
    button.addEventListener('click', () => {
      $('#login-form').email.value = button.dataset.email;
      $('#login-form').password.value = 'Senha@123';
    });
  });

  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const result = await run(() =>
      API.auth.login({ email: form.email.value, password: form.password.value }),
    );
    if (!result) return;
    API.setSession(result.data.user, result.data.token);
    state.user = result.data.user;
    await showApp();
  });

  $('#register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const result = await run(
      () =>
        API.auth.register({
          name: form.name.value,
          email: form.email.value,
          password: form.password.value,
        }),
      'Conta criada com sucesso!',
    );
    if (!result) return;
    API.setSession(result.data.user, result.data.token);
    state.user = result.data.user;
    await showApp();
  });

  $('#logout-btn').addEventListener('click', () => {
    API.clearSession();
    state.user = null;
    showAuth();
  });

  window.addEventListener('session-expired', () => {
    toast('Sua sessao expirou. Faca login novamente.', 'error');
    state.user = null;
    showAuth();
  });
}

// =========================================================== ROUTER =======
function navigate(view, params = {}) {
  state.view = view;
  Object.assign(state, params);

  document.querySelectorAll('#main-nav .nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === view);
  });

  container().innerHTML = '<div class="loading">Carregando...</div>';

  const views = {
    tickets: renderTicketList,
    'ticket-detail': renderTicketDetail,
    'new-ticket': renderNewTicket,
    dashboard: renderDashboard,
    categories: renderCategories,
    users: renderUsers,
  };

  (views[view] || renderTicketList)().catch((error) => {
    container().innerHTML = `<div class="card empty">${esc(error.message)}</div>`;
  });
}

// ==================================================== LISTA DE TICKETS ====
async function renderTicketList() {
  const { filters } = state;
  const response = await API.tickets.list({
    page: filters.page,
    limit: 10,
    status: filters.status || undefined,
    priority: filters.priority || undefined,
    categoryId: filters.categoryId || undefined,
    search: filters.search || undefined,
  });

  const tickets = response.data;
  const meta = response.meta;

  container().innerHTML = `
    <div class="page-header">
      <div>
        <h2>Chamados</h2>
        <p>${meta.total} chamado(s) — ordenados por prioridade (urgentes primeiro)</p>
      </div>
      ${!isStaff() || isAdmin()
        ? '<button class="btn btn-primary" id="btn-new">Novo chamado</button>'
        : ''}
    </div>

    <div class="filters">
      <label>Buscar
        <input type="search" id="f-search" placeholder="Título ou descrição" value="${esc(filters.search)}" />
      </label>
      <label>Status
        <select id="f-status">
          <option value="">Todos</option>
          ${Object.entries(STATUS_LABEL)
            .map(([value, label]) =>
              `<option value="${value}" ${filters.status === value ? 'selected' : ''}>${label}</option>`)
            .join('')}
        </select>
      </label>
      <label>Prioridade
        <select id="f-priority">
          <option value="">Todas</option>
          ${['URGENTE', 'ALTA', 'MEDIA', 'BAIXA']
            .map((p) => `<option value="${p}" ${filters.priority === p ? 'selected' : ''}>${PRIORITY_LABEL[p]}</option>`)
            .join('')}
        </select>
      </label>
      <label>Categoria
        <select id="f-category">
          <option value="">Todas</option>
          ${state.categories
            .map((c) => `<option value="${c.id}" ${String(filters.categoryId) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`)
            .join('')}
        </select>
      </label>
      <button class="btn btn-secondary" id="btn-clear">Limpar</button>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th><th>Título</th><th>Status</th><th>Prioridade</th>
            <th>Categoria</th><th>Cliente</th><th>Atendente</th><th>Criado</th>
          </tr>
        </thead>
        <tbody>
          ${tickets.length === 0
            ? '<tr><td colspan="8" class="empty">Nenhum chamado encontrado.</td></tr>'
            : tickets.map((ticket) => `
              <tr class="clickable" data-id="${ticket.id}">
                <td class="mono">#${ticket.id}</td>
                <td>
                  <div class="cell-title">${esc(ticket.title)}</div>
                  <div class="cell-sub">${esc(ticket.description.slice(0, 70))}${ticket.description.length > 70 ? '…' : ''}</div>
                </td>
                <td>${statusBadge(ticket.status)}</td>
                <td>${priorityTag(ticket.priority)}</td>
                <td>${esc(ticket.category.name)}</td>
                <td>${esc(ticket.client.name)}</td>
                <td>${ticket.agent ? esc(ticket.agent.name) : '<span class="cell-sub">Na fila</span>'}</td>
                <td class="mono">${formatDate(ticket.createdAt)}</td>
              </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="pagination">
      <span>Página ${meta.page} de ${Math.max(meta.totalPages, 1)}</span>
      <button class="btn btn-secondary btn-sm" id="prev" ${meta.hasPreviousPage ? '' : 'disabled'}>Anterior</button>
      <button class="btn btn-secondary btn-sm" id="next" ${meta.hasNextPage ? '' : 'disabled'}>Próxima</button>
    </div>`;

  document.querySelectorAll('tbody tr.clickable').forEach((row) => {
    row.addEventListener('click', () => navigate('ticket-detail', { ticketId: row.dataset.id }));
  });

  $('#btn-new')?.addEventListener('click', () => navigate('new-ticket'));

  const applyFilter = (key, value) => {
    state.filters[key] = value;
    state.filters.page = 1;
    navigate('tickets');
  };

  $('#f-status').addEventListener('change', (e) => applyFilter('status', e.target.value));
  $('#f-priority').addEventListener('change', (e) => applyFilter('priority', e.target.value));
  $('#f-category').addEventListener('change', (e) => applyFilter('categoryId', e.target.value));
  $('#f-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyFilter('search', e.target.value);
  });
  $('#btn-clear').addEventListener('click', () => {
    state.filters = { page: 1, status: '', priority: '', categoryId: '', search: '' };
    navigate('tickets');
  });

  $('#prev').addEventListener('click', () => { state.filters.page -= 1; navigate('tickets'); });
  $('#next').addEventListener('click', () => { state.filters.page += 1; navigate('tickets'); });
}

// ================================================== DETALHE DO TICKET =====
async function renderTicketDetail() {
  const id = state.ticketId;
  const [ticketResponse, messagesResponse] = await Promise.all([
    API.tickets.get(id),
    API.tickets.messages(id, { limit: 100 }),
  ]);

  const ticket = ticketResponse.data;
  const messages = messagesResponse.data;
  const closed = ticket.status === 'FECHADO';

  container().innerHTML = `
    <div class="page-header">
      <div>
        <button class="btn btn-ghost btn-sm" id="back">&larr; Voltar</button>
        <h2 style="margin-top:8px">#${ticket.id} — ${esc(ticket.title)}</h2>
        <p>Aberto por ${esc(ticket.client.name)} em ${formatDate(ticket.createdAt)}</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        ${statusBadge(ticket.status)} ${priorityTag(ticket.priority)}
      </div>
    </div>

    <div class="detail-grid">
      <div>
        <div class="card">
          <div class="card-title">Conversa (${messages.length})</div>
          <div class="thread" id="thread">
            ${messages.length === 0
              ? '<div class="empty">Nenhuma mensagem ainda.</div>'
              : messages.map((message) => `
                <div class="msg ${message.author.id === state.user.id ? 'own' : ''} ${message.isInternal ? 'internal' : ''}">
                  <div class="msg-body">
                    <div class="msg-head">
                      <strong>${esc(message.author.name)}</strong>
                      <span class="badge badge-${message.author.role}">${message.author.role}</span>
                      ${message.isInternal ? '<span class="internal-tag">NOTA INTERNA</span>' : ''}
                      <span class="msg-time">${formatDate(message.createdAt)}</span>
                    </div>
                    <div class="msg-content">${esc(message.content)}</div>
                  </div>
                </div>`).join('')}
          </div>

          ${closed
            ? '<div class="reply-box"><div class="empty">Este chamado está FECHADO e não aceita novas mensagens.</div></div>'
            : `<div class="reply-box">
                 <textarea id="reply" placeholder="Escreva sua resposta..."></textarea>
                 <div class="reply-actions">
                   ${isStaff()
                     ? '<label class="checkbox"><input type="checkbox" id="internal" /> Nota interna (invisível para o cliente)</label>'
                     : '<span></span>'}
                   <button class="btn btn-primary" id="send">Enviar</button>
                 </div>
               </div>`}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Detalhes</div>
        <div class="meta-list">
          <div class="meta-item"><span class="meta-label">Categoria</span><span>${esc(ticket.category.name)}</span></div>
          <div class="meta-item"><span class="meta-label">Cliente</span><span>${esc(ticket.client.name)}<br /><small class="cell-sub">${esc(ticket.client.email)}</small></span></div>
          <div class="meta-item"><span class="meta-label">Atendente</span><span>${ticket.agent ? esc(ticket.agent.name) : '<span class="cell-sub">Não atribuído</span>'}</span></div>
          <div class="meta-item"><span class="meta-label">Última atualização</span><span class="mono">${formatDate(ticket.updatedAt)}</span></div>
          ${ticket.resolvedAt ? `<div class="meta-item"><span class="meta-label">Resolvido em</span><span class="mono">${formatDate(ticket.resolvedAt)}</span></div>` : ''}
          ${ticket.closedAt ? `<div class="meta-item"><span class="meta-label">Fechado em</span><span class="mono">${formatDate(ticket.closedAt)}</span></div>` : ''}
        </div>

        <div class="card-title" style="margin-top:22px">Ações</div>
        <div class="actions-stack">${renderActions(ticket)}</div>
      </div>
    </div>`;

  $('#back').addEventListener('click', () => navigate('tickets'));
  const thread = $('#thread');
  if (thread) thread.scrollTop = thread.scrollHeight;

  $('#send')?.addEventListener('click', async () => {
    const content = $('#reply').value.trim();
    if (!content) return toast('Escreva uma mensagem antes de enviar.', 'error');

    const sent = await run(
      () => API.tickets.sendMessage(id, { content, isInternal: $('#internal')?.checked ?? false }),
      'Mensagem enviada',
    );
    if (sent) navigate('ticket-detail', { ticketId: id });
  });

  bindTicketActions(ticket);
}

/** Botoes exibidos conforme role + status. O backend valida tudo de novo. */
function renderActions(ticket) {
  const buttons = [];
  const closed = ticket.status === 'FECHADO';

  if (closed) return '<div class="cell-sub">Chamado encerrado. Nenhuma ação disponível.</div>';

  if (isStaff()) {
    if (!ticket.agent) {
      buttons.push('<button class="btn btn-primary" data-action="claim">Assumir chamado</button>');
    }
    if (ticket.status === 'EM_ATENDIMENTO') {
      buttons.push('<button class="btn btn-secondary" data-action="resolve">Marcar como resolvido</button>');
    }
    if (ticket.status === 'ABERTO' && ticket.agent) {
      buttons.push('<button class="btn btn-secondary" data-action="start">Iniciar atendimento</button>');
    }

    buttons.push(`
      <label>Prioridade
        <select data-action="priority">
          ${['BAIXA', 'MEDIA', 'ALTA', 'URGENTE']
            .map((p) => `<option value="${p}" ${ticket.priority === p ? 'selected' : ''}>${PRIORITY_LABEL[p]}</option>`)
            .join('')}
        </select>
      </label>`);

    if (isAdmin()) {
      buttons.push(`
        <label>Atribuir a
          <select data-action="assign">
            <option value="">— Devolver à fila —</option>
            ${state.agents
              .map((a) => `<option value="${a.id}" ${ticket.agent?.id === a.id ? 'selected' : ''}>${esc(a.name)}</option>`)
              .join('')}
          </select>
        </label>`);
      buttons.push('<button class="btn btn-danger" data-action="delete">Excluir chamado</button>');
    }
  }

  if (ticket.status === 'RESOLVIDO') {
    buttons.push('<button class="btn btn-secondary" data-action="reopen">Reabrir chamado</button>');
  }
  buttons.push('<button class="btn btn-danger" data-action="close">Fechar chamado</button>');

  return buttons.join('');
}

function bindTicketActions(ticket) {
  const id = ticket.id;
  const reload = () => navigate('ticket-detail', { ticketId: id });

  document.querySelectorAll('[data-action]').forEach((element) => {
    const action = element.dataset.action;

    if (element.tagName === 'SELECT') {
      element.addEventListener('change', async (event) => {
        const value = event.target.value;
        if (action === 'priority') {
          await run(() => API.tickets.updatePriority(id, value), 'Prioridade atualizada');
        } else if (action === 'assign') {
          await run(() => API.tickets.assign(id, value ? Number(value) : null), 'Atribuição atualizada');
        }
        reload();
      });
      return;
    }

    element.addEventListener('click', async () => {
      const actions = {
        claim: () => API.tickets.claim(id),
        start: () => API.tickets.updateStatus(id, 'EM_ATENDIMENTO'),
        resolve: () => API.tickets.updateStatus(id, 'RESOLVIDO'),
        reopen: () => API.tickets.updateStatus(id, 'EM_ATENDIMENTO'),
        close: () => API.tickets.updateStatus(id, 'FECHADO'),
        delete: () => API.tickets.remove(id),
      };

      if (action === 'delete' && !confirm('Excluir permanentemente este chamado e todas as suas mensagens?')) return;
      if (action === 'close' && !confirm('Fechar o chamado? Depois disso ele não aceita mais mensagens.')) return;

      const result = await run(actions[action], 'Ação executada com sucesso');
      if (!result) return;
      if (action === 'delete') navigate('tickets');
      else reload();
    });
  });
}

// ======================================================= NOVO TICKET ======
async function renderNewTicket() {
  const clients = isAdmin() ? await API.users.list({ role: 'CLIENTE', limit: 100 }) : null;

  container().innerHTML = `
    <div class="page-header">
      <div><h2>Abrir novo chamado</h2><p>Descreva o problema com o máximo de detalhes possível.</p></div>
    </div>

    <div class="card" style="max-width:640px">
      <form id="ticket-form" class="form-grid">
        <label>Título<input name="title" required minlength="5" maxlength="150" placeholder="Resumo do problema" /></label>
        <label>Categoria
          <select name="categoryId" required>
            <option value="">Selecione...</option>
            ${state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
          </select>
        </label>
        ${isAdmin() ? `
          <label>Cliente
            <select name="clientId" required>
              <option value="">Selecione o cliente...</option>
              ${clients.data.map((u) => `<option value="${u.id}">${esc(u.name)} — ${esc(u.email)}</option>`).join('')}
            </select>
          </label>
          <label>Prioridade
            <select name="priority">
              <option value="MEDIA">Média</option><option value="BAIXA">Baixa</option>
              <option value="ALTA">Alta</option><option value="URGENTE">Urgente</option>
            </select>
          </label>` : ''}
        <label>Descrição
          <textarea name="description" required minlength="10" maxlength="5000" placeholder="Explique o que aconteceu, quando começou e o que você já tentou..."></textarea>
        </label>
        <div style="display:flex;gap:9px">
          <button type="submit" class="btn btn-primary">Abrir chamado</button>
          <button type="button" class="btn btn-secondary" id="cancel">Cancelar</button>
        </div>
      </form>
    </div>`;

  $('#cancel').addEventListener('click', () => navigate('tickets'));

  $('#ticket-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const body = {
      title: form.title.value,
      description: form.description.value,
      categoryId: Number(form.categoryId.value),
    };
    if (form.clientId) body.clientId = Number(form.clientId.value);
    if (form.priority) body.priority = form.priority.value;

    const result = await run(() => API.tickets.create(body), 'Chamado aberto com sucesso!');
    if (result) navigate('ticket-detail', { ticketId: result.data.id });
  });
}

// ========================================================= DASHBOARD ======
async function renderDashboard() {
  if (!isAdmin()) return renderAgentDashboard();

  const { data } = await API.dashboard.admin({ days: 14 });
  const { resumo, porCategoria, porAtendente, metricas, ticketsPorDia } = data;
  const maxCategory = Math.max(1, ...porCategoria.map((c) => c.total));
  const maxDay = Math.max(1, ...ticketsPorDia.map((d) => d.total));

  container().innerHTML = `
    <div class="page-header">
      <div><h2>Dashboard</h2><p>Visão geral da operação — últimos 14 dias na série temporal</p></div>
    </div>

    <div class="stat-grid">
      ${statCard('Total de chamados', resumo.total)}
      ${statCard('Abertos', resumo.abertos)}
      ${statCard('Em atendimento', resumo.emAtendimento)}
      ${statCard('Resolvidos', resumo.resolvidos)}
      ${statCard('Fechados', resumo.fechados)}
      ${statCard('Urgentes', resumo.urgentes, 'danger')}
      ${statCard('Na fila (sem dono)', resumo.naFila)}
      ${statCard('Taxa de resolução', `${metricas.taxaResolucaoPercentual}%`, 'accent')}
    </div>

    <div class="stat-grid">
      ${statCard('Tempo médio de resolução', metricas.tempoMedioHoras !== null ? `${metricas.tempoMedioHoras}h` : '—', 'accent', `${metricas.totalResolvidos} chamado(s) resolvido(s)`)}
      ${statCard('Resolução mais rápida', metricas.tempoMinimoHoras !== null ? `${metricas.tempoMinimoHoras}h` : '—')}
      ${statCard('Resolução mais lenta', metricas.tempoMaximoHoras !== null ? `${metricas.tempoMaximoHoras}h` : '—')}
      ${statCard('Destaque', metricas.atendenteDestaque?.agent ?? '—', 'accent', metricas.atendenteDestaque ? `${metricas.atendenteDestaque.concluidos} concluídos` : '')}
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">Chamados por categoria</div>
        ${porCategoria.map((c) => `
          <div class="bar-row">
            <span>${esc(c.category)}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${(c.total / maxCategory) * 100}%"></div></div>
            <span class="bar-value">${c.total}</span>
          </div>`).join('') || '<div class="empty">Sem dados.</div>'}
      </div>

      <div class="card">
        <div class="card-title">Chamados por dia</div>
        ${ticketsPorDia.map((d) => `
          <div class="bar-row">
            <span class="mono">${String(d.dia).slice(5)}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${(d.total / maxDay) * 100}%"></div></div>
            <span class="bar-value">${d.total}</span>
          </div>`).join('') || '<div class="empty">Nenhum chamado no período.</div>'}
      </div>
    </div>

    <div class="card">
      <div class="card-title">Desempenho por atendente</div>
      <div class="table-wrap" style="box-shadow:none;border:0">
        <table>
          <thead><tr><th>Atendente</th><th>Atribuídos</th><th>Em atendimento</th><th>Concluídos</th><th>Tempo médio</th></tr></thead>
          <tbody>
            ${porAtendente.map((a) => `
              <tr>
                <td class="cell-title">${esc(a.agent)}</td>
                <td class="mono">${a.totalAtribuidos}</td>
                <td class="mono">${a.emAtendimento}</td>
                <td class="mono">${a.concluidos}</td>
                <td class="mono">${a.tempoMedioResolucaoMinutos !== null ? `${(a.tempoMedioResolucaoMinutos / 60).toFixed(1)}h` : '—'}</td>
              </tr>`).join('') || '<tr><td colspan="5" class="empty">Sem atendentes cadastrados.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function renderAgentDashboard() {
  const { data } = await API.dashboard.me();
  container().innerHTML = `
    <div class="page-header"><div><h2>Meu painel</h2><p>Seus números como atendente</p></div></div>
    <div class="stat-grid">
      ${statCard('Chamados atribuídos', data.totalAtribuidos)}
      ${statCard('Em atendimento', data.emAtendimento, 'accent')}
      ${statCard('Concluídos', data.concluidos)}
      ${statCard('Urgentes pendentes', data.urgentesPendentes, 'danger')}
    </div>`;
}

function statCard(label, value, variant = '', hint = '') {
  return `
    <div class="stat">
      <div class="stat-label">${label}</div>
      <div class="stat-value ${variant}">${esc(value)}</div>
      ${hint ? `<div class="stat-hint">${esc(hint)}</div>` : ''}
    </div>`;
}

// ======================================================== CATEGORIAS ======
async function renderCategories() {
  const { data } = await API.categories.list({ includeInactive: 'true' });

  container().innerHTML = `
    <div class="page-header">
      <div><h2>Categorias</h2><p>Categorias com chamados vinculados são desativadas, não excluídas.</p></div>
      <button class="btn btn-primary" id="new-category">Nova categoria</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Nome</th><th>Descrição</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${data.map((c) => `
            <tr>
              <td class="mono">${c.id}</td>
              <td class="cell-title">${esc(c.name)}</td>
              <td class="cell-sub">${esc(c.description || '—')}</td>
              <td>${c.is_active ? '<span class="badge badge-RESOLVIDO">Ativa</span>' : '<span class="badge badge-FECHADO">Inativa</span>'}</td>
              <td style="text-align:right">
                <button class="btn btn-secondary btn-sm" data-edit="${c.id}">Editar</button>
                <button class="btn btn-danger btn-sm" data-del="${c.id}">Remover</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  $('#new-category').addEventListener('click', () => categoryModal());
  document.querySelectorAll('[data-edit]').forEach((button) =>
    button.addEventListener('click', () =>
      categoryModal(data.find((c) => c.id === Number(button.dataset.edit)))));
  document.querySelectorAll('[data-del]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!confirm('Remover esta categoria?')) return;
      await run(() => API.categories.remove(button.dataset.del), 'Categoria removida/desativada');
      navigate('categories');
    }));
}

function categoryModal(category = null) {
  openModal(`
    <h3>${category ? 'Editar' : 'Nova'} categoria</h3>
    <form id="category-form" class="form-grid">
      <label>Nome<input name="name" required minlength="3" maxlength="80" value="${esc(category?.name ?? '')}" /></label>
      <label>Descrição<input name="description" maxlength="255" value="${esc(category?.description ?? '')}" /></label>
      ${category ? `<label class="checkbox"><input type="checkbox" name="isActive" ${category.is_active ? 'checked' : ''} /> Categoria ativa</label>` : ''}
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" id="cancel-modal">Cancelar</button>
        <button type="submit" class="btn btn-primary">Salvar</button>
      </div>
    </form>`);

  $('#cancel-modal').addEventListener('click', closeModal);
  $('#category-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const body = { name: form.name.value, description: form.description.value || null };
    if (category) body.isActive = form.isActive.checked;

    const result = await run(
      () => (category ? API.categories.update(category.id, body) : API.categories.create(body)),
      'Categoria salva',
    );
    if (result) { closeModal(); navigate('categories'); }
  });
}

// ========================================================== USUARIOS ======
async function renderUsers() {
  const { data, meta } = await API.users.list({ limit: 50 });

  container().innerHTML = `
    <div class="page-header">
      <div><h2>Usuários</h2><p>${meta.total} usuário(s) cadastrado(s)</p></div>
      <button class="btn btn-primary" id="new-user">Novo usuário</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th><th>Cadastro</th><th></th></tr></thead>
        <tbody>
          ${data.map((u) => `
            <tr>
              <td class="mono">${u.id}</td>
              <td class="cell-title">${esc(u.name)}</td>
              <td class="cell-sub">${esc(u.email)}</td>
              <td>
                <select data-role-for="${u.id}" ${u.id === state.user.id ? 'disabled' : ''}>
                  ${['CLIENTE', 'ATENDENTE', 'ADMIN']
                    .map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
                </select>
              </td>
              <td>${u.is_active ? '<span class="badge badge-RESOLVIDO">Ativo</span>' : '<span class="badge badge-FECHADO">Inativo</span>'}</td>
              <td class="mono">${formatDate(u.created_at)}</td>
              <td style="text-align:right">
                ${u.id === state.user.id
                  ? '<span class="cell-sub">você</span>'
                  : `<button class="btn btn-danger btn-sm" data-del-user="${u.id}">Remover</button>`}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  document.querySelectorAll('[data-role-for]').forEach((select) =>
    select.addEventListener('change', async (event) => {
      await run(
        () => API.users.updateRole(select.dataset.roleFor, event.target.value),
        'Permissão atualizada',
      );
      navigate('users');
    }));

  document.querySelectorAll('[data-del-user]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!confirm('Remover este usuário? Se ele tiver histórico, será apenas desativado.')) return;
      await run(() => API.users.remove(button.dataset.delUser), 'Usuário removido/desativado');
      navigate('users');
    }));

  $('#new-user').addEventListener('click', () => {
    openModal(`
      <h3>Novo usuário</h3>
      <form id="user-form" class="form-grid">
        <label>Nome<input name="name" required minlength="3" /></label>
        <label>E-mail<input type="email" name="email" required /></label>
        <label>Senha<input type="password" name="password" required />
          <small>Mínimo 8 caracteres, com maiúscula, minúscula e número.</small></label>
        <label>Perfil
          <select name="role">
            <option value="CLIENTE">CLIENTE</option>
            <option value="ATENDENTE">ATENDENTE</option>
            <option value="ADMIN">ADMIN</option>
          </select>
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="cancel-modal">Cancelar</button>
          <button type="submit" class="btn btn-primary">Criar</button>
        </div>
      </form>`);

    $('#cancel-modal').addEventListener('click', closeModal);
    $('#user-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target;
      const result = await run(
        () => API.users.create({
          name: form.name.value,
          email: form.email.value,
          password: form.password.value,
          role: form.role.value,
        }),
        'Usuário criado',
      );
      if (result) { closeModal(); navigate('users'); }
    });
  });
}

// ============================================================= BOOT =======
document.querySelectorAll('#main-nav .nav-item').forEach((item) => {
  item.addEventListener('click', () => navigate(item.dataset.view));
});

bindAuthScreen();

/**
 * Ao carregar a pagina, se ha token salvo, validamos com GET /auth/me.
 * Nao confiamos no usuario guardado no localStorage: ele pode estar velho
 * (a role pode ter mudado) ou ter sido editado manualmente pelo usuario.
 * Quem manda e sempre a resposta do servidor.
 */
(async function boot() {
  if (!API.getToken()) return showAuth();
  try {
    const { data } = await API.auth.me();
    state.user = data;
    await showApp();
  } catch {
    API.clearSession();
    showAuth();
  }
})();
