/**
 * Camada de acesso a API.
 *
 * Mesma ideia do "repository" do backend: TODA chamada HTTP passa por aqui.
 * Assim, o token, o tratamento de erro e o formato de resposta ficam num lugar
 * so - nenhuma tela precisa saber como o backend responde.
 */
const API = (() => {
  const BASE_URL = '/api';
  const TOKEN_KEY = 'helpdesk_token';
  const USER_KEY = 'helpdesk_user';

  /**
   * O token vive no localStorage por simplicidade de demonstracao.
   * Em producao, o ideal seria um cookie httpOnly + SameSite, porque o
   * localStorage e legivel por qualquer script injetado na pagina (XSS).
   * E um trade-off consciente - vale citar isso numa entrevista.
   */
  const getToken = () => localStorage.getItem(TOKEN_KEY);
  const getUser = () => JSON.parse(localStorage.getItem(USER_KEY) || 'null');

  function setSession(user, token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  async function request(path, { method = 'GET', body, params } = {}) {
    const url = new URL(BASE_URL + path, window.location.origin);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, value);
        }
      }
    }

    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 204) return { success: true, data: null };

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      // 401 = sessao morreu (token expirado ou usuario desativado).
      // Limpamos e voltamos para o login em vez de deixar a tela quebrada.
      if (response.status === 401 && getToken()) {
        clearSession();
        window.dispatchEvent(new CustomEvent('session-expired'));
      }

      const message = payload?.error?.message || `Erro ${response.status}`;
      const details = payload?.error?.details;
      const error = new Error(
        details?.length ? `${message}: ${details.map((d) => d.message).join('; ')}` : message,
      );
      error.status = response.status;
      throw error;
    }

    return payload;
  }

  return {
    getToken, getUser, setSession, clearSession,

    auth: {
      login: (body) => request('/auth/login', { method: 'POST', body }),
      register: (body) => request('/auth/register', { method: 'POST', body }),
      me: () => request('/auth/me'),
    },

    tickets: {
      list: (params) => request('/tickets', { params }),
      get: (id) => request(`/tickets/${id}`),
      create: (body) => request('/tickets', { method: 'POST', body }),
      update: (id, body) => request(`/tickets/${id}`, { method: 'PUT', body }),
      updateStatus: (id, status) => request(`/tickets/${id}/status`, { method: 'PATCH', body: { status } }),
      updatePriority: (id, priority) => request(`/tickets/${id}/priority`, { method: 'PATCH', body: { priority } }),
      assign: (id, agentId) => request(`/tickets/${id}/assign`, { method: 'PATCH', body: { agentId } }),
      claim: (id) => request(`/tickets/${id}/claim`, { method: 'POST' }),
      remove: (id) => request(`/tickets/${id}`, { method: 'DELETE' }),
      messages: (id, params) => request(`/tickets/${id}/messages`, { params }),
      sendMessage: (id, body) => request(`/tickets/${id}/messages`, { method: 'POST', body }),
    },

    categories: {
      list: (params) => request('/categories', { params }),
      create: (body) => request('/categories', { method: 'POST', body }),
      update: (id, body) => request(`/categories/${id}`, { method: 'PUT', body }),
      remove: (id) => request(`/categories/${id}`, { method: 'DELETE' }),
    },

    users: {
      list: (params) => request('/users', { params }),
      agents: () => request('/users/agents'),
      create: (body) => request('/users', { method: 'POST', body }),
      updateRole: (id, role) => request(`/users/${id}/role`, { method: 'PATCH', body: { role } }),
      update: (id, body) => request(`/users/${id}`, { method: 'PUT', body }),
      remove: (id) => request(`/users/${id}`, { method: 'DELETE' }),
    },

    dashboard: {
      admin: (params) => request('/dashboard', { params }),
      me: () => request('/dashboard/me'),
    },
  };
})();
