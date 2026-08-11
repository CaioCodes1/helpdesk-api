/**
 * Especificacao OpenAPI 3.0 escrita como um objeto JavaScript.
 *
 * Por que assim, e nao com `swagger-jsdoc` (anotacoes em comentario)?
 *  - Um arquivo unico e a fonte da verdade; nao ha spec espalhada em 30 lugares.
 *  - Sem plugin de build para manter.
 *  - Editor entende objeto JS: autocomplete e erro de sintaxe na hora.
 * O custo e ter que lembrar de atualizar aqui ao criar um endpoint - e por isso
 * que o Swagger vive no fim do roadmap, quando a API ja esta estavel.
 */
import { env } from '../config/env.js';

const bearerAuth = [{ bearerAuth: [] }];

const paginationParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 } },
];

const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'integer', minimum: 1 },
};

/** Respostas de erro reaproveitadas por quase todos os endpoints. */
const errorResponses = {
  400: { description: 'Requisição inválida', content: errorContent() },
  401: { description: 'Não autenticado (token ausente, inválido ou expirado)', content: errorContent() },
  403: { description: 'Autenticado, mas sem permissão para esta ação', content: errorContent() },
  404: { description: 'Recurso não encontrado', content: errorContent() },
  409: { description: 'Conflito com o estado atual (ex.: transição de status inválida)', content: errorContent() },
  422: { description: 'Falha de validação dos dados enviados', content: errorContent() },
};

function errorContent() {
  return { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } };
}

function pick(...codes) {
  return Object.fromEntries(codes.map((code) => [code, errorResponses[code]]));
}

export const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Help Desk API',
    version: '1.0.0',
    description: [
      'API REST para gerenciamento de chamados de suporte.',
      '',
      '### Como autenticar',
      '1. `POST /api/auth/login` com email e senha.',
      '2. Copie o `data.token` da resposta.',
      '3. Clique em **Authorize** (cadeado no topo) e cole o token.',
      '',
      '### Usuários de demonstração (senha: `Senha@123`)',
      '| E-mail | Perfil |',
      '|---|---|',
      '| admin@helpdesk.com | ADMIN |',
      '| bruno@helpdesk.com | ATENDENTE |',
      '| diego@cliente.com | CLIENTE |',
      '',
      '### Fluxo de status',
      '`ABERTO -> EM_ATENDIMENTO -> RESOLVIDO -> FECHADO`',
      '',
      'Transições fora desse fluxo retornam **409 Conflict**. `FECHADO` é final.',
    ].join('\n'),
    contact: { name: 'Repositório', url: 'https://github.com/CaioCodes1/helpdesk-api' },
    license: { name: 'MIT' },
  },
  servers: [{ url: `http://localhost:${env.port}`, description: 'Ambiente local' }],
  tags: [
    { name: 'Health', description: 'Verificação de disponibilidade' },
    { name: 'Auth', description: 'Cadastro, login e perfil' },
    { name: 'Tickets', description: 'Ciclo de vida dos chamados' },
    { name: 'Mensagens', description: 'Histórico de conversa de um ticket' },
    { name: 'Categorias', description: 'Configuração de categorias (ADMIN)' },
    { name: 'Usuários', description: 'Gestão de usuários e permissões (ADMIN)' },
    { name: 'Dashboard', description: 'Métricas e indicadores' },
  ],

  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Envie o header `Authorization: Bearer <token>`',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              message: { type: 'string', example: 'Ticket nao encontrado' },
              details: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    field: { type: 'string', example: 'title' },
                    message: { type: 'string', example: 'title deve ter no minimo 5 caracteres' },
                  },
                },
              },
            },
          },
        },
      },
      Meta: {
        type: 'object',
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 10 },
          total: { type: 'integer', example: 42 },
          totalPages: { type: 'integer', example: 5 },
          hasPreviousPage: { type: 'boolean' },
          hasNextPage: { type: 'boolean' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 4 },
          name: { type: 'string', example: 'Diego Cliente' },
          email: { type: 'string', format: 'email', example: 'diego@cliente.com' },
          role: { type: 'string', enum: ['CLIENTE', 'ATENDENTE', 'ADMIN'] },
          is_active: { type: 'integer', example: 1 },
          created_at: { type: 'string', example: '2026-08-07 10:00:00' },
        },
      },
      Category: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 3 },
          name: { type: 'string', example: 'Entrega' },
          description: { type: 'string', nullable: true },
          is_active: { type: 'integer', example: 1 },
        },
      },
      Ticket: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          title: { type: 'string', example: 'Meu pedido ainda nao chegou' },
          description: { type: 'string' },
          status: {
            type: 'string',
            enum: ['ABERTO', 'EM_ATENDIMENTO', 'RESOLVIDO', 'FECHADO'],
          },
          priority: { type: 'string', enum: ['BAIXA', 'MEDIA', 'ALTA', 'URGENTE'] },
          category: {
            type: 'object',
            properties: { id: { type: 'integer' }, name: { type: 'string' } },
          },
          client: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              name: { type: 'string' },
              email: { type: 'string' },
            },
          },
          agent: {
            type: 'object',
            nullable: true,
            description: 'null quando o ticket ainda nao foi assumido',
            properties: {
              id: { type: 'integer' },
              name: { type: 'string' },
              email: { type: 'string' },
            },
          },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' },
          resolvedAt: { type: 'string', nullable: true },
          closedAt: { type: 'string', nullable: true },
        },
      },
      Message: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          ticketId: { type: 'integer' },
          content: { type: 'string', example: 'Ola! Vou verificar o status do pedido.' },
          isInternal: {
            type: 'boolean',
            description: 'Nota interna: nunca retornada para usuarios CLIENTE',
          },
          author: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              name: { type: 'string' },
              role: { type: 'string' },
            },
          },
          createdAt: { type: 'string' },
        },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string' },
          data: {
            type: 'object',
            properties: {
              user: { $ref: '#/components/schemas/User' },
              token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            },
          },
        },
      },
    },
  },

  paths: {
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'Verifica se a API e o banco estão no ar',
        security: [],
        responses: {
          200: { description: 'Aplicacao saudavel' },
          503: { description: 'Banco de dados inacessivel' },
        },
      },
    },

    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Cadastra um novo usuário (sempre com perfil CLIENTE)',
        description:
          'A role NAO pode ser enviada: o cadastro publico cria apenas CLIENTE. ' +
          'Promocoes acontecem em PATCH /api/users/{id}/role.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string', minLength: 3, example: 'Joao da Silva' },
                  email: { type: 'string', format: 'email', example: 'joao@exemplo.com' },
                  password: {
                    type: 'string',
                    minLength: 8,
                    description: 'Minimo 8 caracteres, com maiuscula, minuscula e numero',
                    example: 'Senha@123',
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Usuario criado',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } },
            },
          },
          ...pick(409, 422),
        },
      },
    },

    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Autentica e retorna o token JWT',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', example: 'admin@helpdesk.com' },
                  password: { type: 'string', example: 'Senha@123' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Autenticado',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } },
            },
          },
          ...pick(401, 422),
        },
      },
    },

    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Dados do usuário autenticado',
        security: bearerAuth,
        responses: { 200: { description: 'Perfil do usuario' }, ...pick(401) },
      },
    },

    '/api/auth/password': {
      patch: {
        tags: ['Auth'],
        summary: 'Altera a própria senha',
        security: bearerAuth,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['currentPassword', 'newPassword'],
                properties: {
                  currentPassword: { type: 'string' },
                  newPassword: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Senha alterada' }, ...pick(401, 409, 422) },
      },
    },

    '/api/tickets': {
      get: {
        tags: ['Tickets'],
        summary: 'Lista tickets (escopo automático por perfil)',
        description:
          'CLIENTE recebe apenas os proprios tickets - o filtro e forcado no servidor. ' +
          'ATENDENTE e ADMIN veem todos. Ordenacao padrao: prioridade URGENTE primeiro.',
        security: bearerAuth,
        parameters: [
          ...paginationParams,
          {
            name: 'status',
            in: 'query',
            description: 'Aceita multiplos separados por virgula',
            schema: { type: 'string', example: 'ABERTO,EM_ATENDIMENTO' },
          },
          { name: 'priority', in: 'query', schema: { type: 'string', example: 'URGENTE,ALTA' } },
          { name: 'categoryId', in: 'query', schema: { type: 'integer' } },
          { name: 'agentId', in: 'query', schema: { type: 'integer' } },
          {
            name: 'assignedToMe',
            in: 'query',
            description: 'Atalho para "tickets atribuidos a mim"',
            schema: { type: 'string', enum: ['true', 'false'] },
          },
          {
            name: 'unassigned',
            in: 'query',
            description: 'Somente tickets ainda sem responsavel (a fila)',
            schema: { type: 'string', enum: ['true', 'false'] },
          },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'createdFrom', in: 'query', schema: { type: 'string', example: '2026-08-01' } },
          { name: 'createdTo', in: 'query', schema: { type: 'string', example: '2026-08-31' } },
          {
            name: 'sortBy',
            in: 'query',
            schema: { type: 'string', enum: ['createdAt', 'updatedAt', 'priority', 'status'] },
          },
          { name: 'sortOrder', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
        ],
        responses: {
          200: {
            description: 'Lista paginada',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/Ticket' } },
                    meta: { $ref: '#/components/schemas/Meta' },
                  },
                },
              },
            },
          },
          ...pick(401, 422),
        },
      },
      post: {
        tags: ['Tickets'],
        summary: 'Abre um novo ticket',
        description:
          'CLIENTE abre para si mesmo. ADMIN pode informar `clientId` para abrir em nome de ' +
          'um cliente. ATENDENTE nao abre chamados. Prioridade URGENTE enviada por CLIENTE ' +
          'e rebaixada para ALTA.',
        security: bearerAuth,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'description', 'categoryId'],
                properties: {
                  title: { type: 'string', minLength: 5, example: 'Meu pedido ainda nao chegou' },
                  description: { type: 'string', minLength: 10 },
                  categoryId: { type: 'integer', example: 3 },
                  priority: { type: 'string', enum: ['BAIXA', 'MEDIA', 'ALTA', 'URGENTE'] },
                  clientId: { type: 'integer', description: 'Somente ADMIN' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Ticket criado',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Ticket' } },
            },
          },
          ...pick(400, 401, 403, 404, 422),
        },
      },
    },

    '/api/tickets/{id}': {
      get: {
        tags: ['Tickets'],
        summary: 'Detalha um ticket',
        description:
          'Um CLIENTE que tentar acessar ticket de outra pessoa recebe 404 (e nao 403), ' +
          'para nao revelar que o recurso existe.',
        security: bearerAuth,
        parameters: [idParam],
        responses: { 200: { description: 'Ticket' }, ...pick(401, 404) },
      },
      put: {
        tags: ['Tickets'],
        summary: 'Edita título/descrição/categoria/prioridade',
        description:
          'CLIENTE so edita titulo e descricao, e somente enquanto o status for ABERTO.',
        security: bearerAuth,
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  categoryId: { type: 'integer' },
                  priority: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Ticket atualizado' }, ...pick(401, 403, 404, 409, 422) },
      },
      delete: {
        tags: ['Tickets'],
        summary: 'Exclui um ticket (somente ADMIN)',
        description: 'As mensagens sao removidas em cascata pelo banco.',
        security: bearerAuth,
        parameters: [idParam],
        responses: { 204: { description: 'Removido' }, ...pick(401, 403, 404) },
      },
    },

    '/api/tickets/{id}/status': {
      patch: {
        tags: ['Tickets'],
        summary: 'Altera o status respeitando a máquina de estados',
        description:
          'Transicoes validas:\n' +
          '- ABERTO -> EM_ATENDIMENTO, FECHADO\n' +
          '- EM_ATENDIMENTO -> RESOLVIDO, ABERTO, FECHADO\n' +
          '- RESOLVIDO -> FECHADO, EM_ATENDIMENTO (reabertura)\n' +
          '- FECHADO -> (nenhuma: estado final)\n\n' +
          'CLIENTE so pode FECHAR ou reabrir um ticket RESOLVIDO.',
        security: bearerAuth,
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: {
                    type: 'string',
                    enum: ['ABERTO', 'EM_ATENDIMENTO', 'RESOLVIDO', 'FECHADO'],
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Status alterado' }, ...pick(401, 403, 404, 409, 422) },
      },
    },

    '/api/tickets/{id}/priority': {
      patch: {
        tags: ['Tickets'],
        summary: 'Altera a prioridade (ATENDENTE/ADMIN)',
        security: bearerAuth,
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['priority'],
                properties: {
                  priority: { type: 'string', enum: ['BAIXA', 'MEDIA', 'ALTA', 'URGENTE'] },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Prioridade alterada' }, ...pick(401, 403, 404, 409) },
      },
    },

    '/api/tickets/{id}/assign': {
      patch: {
        tags: ['Tickets'],
        summary: 'Atribui ou remove o atendente responsável',
        description:
          '`agentId: null` devolve o ticket para a fila. ATENDENTE so atribui a si mesmo; ' +
          'apenas ADMIN reatribui para terceiros. O responsavel nunca pode ter role CLIENTE.',
        security: bearerAuth,
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['agentId'],
                properties: { agentId: { type: 'integer', nullable: true, example: 2 } },
              },
            },
          },
        },
        responses: { 200: { description: 'Atribuicao atualizada' }, ...pick(400, 401, 403, 404, 409) },
      },
    },

    '/api/tickets/{id}/claim': {
      post: {
        tags: ['Tickets'],
        summary: 'Assume o ticket para si (ATENDENTE/ADMIN)',
        description: 'Se o ticket estava ABERTO, passa automaticamente para EM_ATENDIMENTO.',
        security: bearerAuth,
        parameters: [idParam],
        responses: { 200: { description: 'Ticket assumido' }, ...pick(401, 403, 404, 409) },
      },
    },

    '/api/tickets/{id}/messages': {
      get: {
        tags: ['Mensagens'],
        summary: 'Histórico de mensagens do ticket',
        description: 'Notas internas (`isInternal: true`) nunca aparecem para CLIENTE.',
        security: bearerAuth,
        parameters: [idParam, ...paginationParams],
        responses: {
          200: {
            description: 'Mensagens em ordem cronologica',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/Message' } },
                    meta: { $ref: '#/components/schemas/Meta' },
                  },
                },
              },
            },
          },
          ...pick(401, 404),
        },
      },
      post: {
        tags: ['Mensagens'],
        summary: 'Envia uma mensagem no ticket',
        description:
          'Ticket FECHADO retorna 409. Se um CLIENTE responder um ticket RESOLVIDO, ele ' +
          'volta automaticamente para EM_ATENDIMENTO.',
        security: bearerAuth,
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['content'],
                properties: {
                  content: { type: 'string', example: 'Vou verificar e retorno em breve.' },
                  isInternal: {
                    type: 'boolean',
                    default: false,
                    description: 'Somente ATENDENTE/ADMIN',
                  },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Mensagem criada' }, ...pick(401, 403, 404, 409, 422) },
      },
    },

    '/api/categories': {
      get: {
        tags: ['Categorias'],
        summary: 'Lista categorias ativas',
        security: bearerAuth,
        parameters: [
          {
            name: 'includeInactive',
            in: 'query',
            description: 'Somente ADMIN',
            schema: { type: 'string', enum: ['true', 'false'] },
          },
        ],
        responses: { 200: { description: 'Lista de categorias' }, ...pick(401) },
      },
      post: {
        tags: ['Categorias'],
        summary: 'Cria uma categoria (ADMIN)',
        security: bearerAuth,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', example: 'Financeiro' },
                  description: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Categoria criada' }, ...pick(401, 403, 409, 422) },
      },
    },

    '/api/categories/{id}': {
      get: {
        tags: ['Categorias'],
        summary: 'Detalha uma categoria',
        security: bearerAuth,
        parameters: [idParam],
        responses: { 200: { description: 'Categoria' }, ...pick(401, 404) },
      },
      put: {
        tags: ['Categorias'],
        summary: 'Edita uma categoria (ADMIN)',
        security: bearerAuth,
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string', nullable: true },
                  isActive: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Categoria atualizada' }, ...pick(401, 403, 404, 409, 422) },
      },
      delete: {
        tags: ['Categorias'],
        summary: 'Remove ou desativa uma categoria (ADMIN)',
        description:
          'Se houver tickets vinculados, a categoria e apenas DESATIVADA (200 com mensagem). ' +
          'Sem vinculos, e removida de fato (204).',
        security: bearerAuth,
        parameters: [idParam],
        responses: {
          204: { description: 'Removida' },
          200: { description: 'Desativada (possui tickets vinculados)' },
          ...pick(401, 403, 404),
        },
      },
    },

    '/api/users': {
      get: {
        tags: ['Usuários'],
        summary: 'Lista usuários (ADMIN)',
        security: bearerAuth,
        parameters: [
          ...paginationParams,
          { name: 'role', in: 'query', schema: { type: 'string', enum: ['CLIENTE', 'ATENDENTE', 'ADMIN'] } },
          { name: 'isActive', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Lista paginada' }, ...pick(401, 403) },
      },
      post: {
        tags: ['Usuários'],
        summary: 'Cria um usuário com perfil definido (ADMIN)',
        security: bearerAuth,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string' },
                  password: { type: 'string' },
                  role: { type: 'string', enum: ['CLIENTE', 'ATENDENTE', 'ADMIN'] },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Usuario criado' }, ...pick(401, 403, 409, 422) },
      },
    },

    '/api/users/agents': {
      get: {
        tags: ['Usuários'],
        summary: 'Lista atendentes e admins ativos (para a tela de atribuição)',
        security: bearerAuth,
        responses: { 200: { description: 'Lista de atendentes' }, ...pick(401, 403) },
      },
    },

    '/api/users/{id}': {
      get: {
        tags: ['Usuários'],
        summary: 'Detalha um usuário (ADMIN)',
        security: bearerAuth,
        parameters: [idParam],
        responses: { 200: { description: 'Usuario' }, ...pick(401, 403, 404) },
      },
      put: {
        tags: ['Usuários'],
        summary: 'Edita um usuário (ADMIN)',
        security: bearerAuth,
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string' },
                  role: { type: 'string' },
                  isActive: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Usuario atualizado' }, ...pick(400, 401, 403, 404, 409, 422) },
      },
      delete: {
        tags: ['Usuários'],
        summary: 'Remove ou desativa um usuário (ADMIN)',
        description:
          'Com tickets vinculados, o usuario e apenas desativado para preservar o historico.',
        security: bearerAuth,
        parameters: [idParam],
        responses: {
          204: { description: 'Removido' },
          200: { description: 'Desativado (possui historico)' },
          ...pick(400, 401, 403, 404),
        },
      },
    },

    '/api/users/{id}/role': {
      patch: {
        tags: ['Usuários'],
        summary: 'Altera a permissão de um usuário (ADMIN)',
        description: 'Bloqueado se a operacao deixaria o sistema sem nenhum ADMIN ativo.',
        security: bearerAuth,
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['role'],
                properties: {
                  role: { type: 'string', enum: ['CLIENTE', 'ATENDENTE', 'ADMIN'] },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Role alterada' }, ...pick(400, 401, 403, 404, 409, 422) },
      },
    },

    '/api/users/{id}/password': {
      patch: {
        tags: ['Usuários'],
        summary: 'Redefine a senha de um usuário (ADMIN)',
        security: bearerAuth,
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['newPassword'],
                properties: { newPassword: { type: 'string', minLength: 8 } },
              },
            },
          },
        },
        responses: { 200: { description: 'Senha redefinida' }, ...pick(401, 403, 404, 422) },
      },
    },

    '/api/dashboard': {
      get: {
        tags: ['Dashboard'],
        summary: 'Indicadores gerais da operação (ADMIN)',
        description:
          'Retorna: totais por status, por prioridade, por categoria, por atendente, ' +
          'tempo medio de resolucao, taxa de resolucao, serie diaria e atendente destaque.',
        security: bearerAuth,
        parameters: [
          {
            name: 'days',
            in: 'query',
            description: 'Janela da serie temporal, em dias (1-365)',
            schema: { type: 'integer', default: 14 },
          },
        ],
        responses: { 200: { description: 'Metricas' }, ...pick(401, 403) },
      },
    },

    '/api/dashboard/me': {
      get: {
        tags: ['Dashboard'],
        summary: 'Métricas pessoais do atendente logado',
        security: bearerAuth,
        responses: { 200: { description: 'Metricas pessoais' }, ...pick(401, 403) },
      },
    },
  },
};
