-- ===========================================================================
--  HELP DESK - SCHEMA MySQL 8+
-- ===========================================================================
--  Convencoes adotadas:
--   * Nomes de tabela no plural e em snake_case.
--   * Toda tabela tem PK numerica AUTO_INCREMENT (chave substituta / surrogate).
--   * Toda tabela tem created_at e updated_at gerenciados pelo proprio MySQL.
--   * Exclusao logica (is_active) em users e categories: nunca apagamos
--     fisicamente registros referenciados por tickets, senao perdemos historico.
--   * InnoDB + utf8mb4 (suporta acentos e emojis corretamente).
-- ===========================================================================

CREATE DATABASE IF NOT EXISTS helpdesk
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE helpdesk;

-- Ordem de DROP e inversa a de criacao por causa das foreign keys.
DROP TABLE IF EXISTS ticket_messages;
DROP TABLE IF EXISTS tickets;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS users;

-- ---------------------------------------------------------------------------
-- USERS
-- ---------------------------------------------------------------------------
-- Por que existe: e a tabela de identidade. Cliente, atendente e admin sao a
-- MESMA entidade com papeis diferentes (Single Table Inheritance), porque os
-- tres compartilham exatamente os mesmos atributos (nome, email, senha).
-- Criar tabelas separadas (clients/agents/admins) obrigaria a UNION em toda
-- consulta e quebraria a FK de tickets, que precisa apontar para "um usuario".
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(120)  NOT NULL,
  email         VARCHAR(160)  NOT NULL,
  password_hash VARCHAR(255)  NOT NULL,
  role          ENUM('CLIENTE', 'ATENDENTE', 'ADMIN') NOT NULL DEFAULT 'CLIENTE',
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  -- UNIQUE e o que garante "nao existem dois usuarios com o mesmo email".
  -- Validar isso apenas no codigo nao basta: duas requisicoes simultaneas
  -- passariam pela checagem antes de qualquer INSERT acontecer.
  -- O banco e a ultima linha de defesa contra corrida (race condition).
  UNIQUE KEY uq_users_email (email),

  -- Indice para filtrar atendentes rapidamente (ex.: listar quem pode assumir).
  KEY idx_users_role_active (role, is_active)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- CATEGORIES
-- ---------------------------------------------------------------------------
-- Por que existe: a categoria poderia ser um ENUM dentro de tickets, mas o
-- requisito diz que o ADMIN cria/edita/remove categorias em runtime. Alterar
-- um ENUM exige ALTER TABLE (DDL), o que nao se faz por requisicao HTTP.
-- Logo, categoria vira tabela propria e o ticket guarda apenas a FK.
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80)  NOT NULL,
  description VARCHAR(255) NULL,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                           ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_name (name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- TICKETS
-- ---------------------------------------------------------------------------
-- Por que existe: e a entidade central do dominio.
--
-- RELACIONAMENTOS (o ponto mais importante do modelo):
--
--  users (1) ──< (N) tickets    via client_id
--     "Um cliente abre muitos tickets; cada ticket pertence a UM cliente."
--     NOT NULL: ticket orfao nao faz sentido de negocio.
--     ON DELETE RESTRICT: o banco recusa apagar um cliente que tem tickets.
--
--  users (1) ──< (N) tickets    via agent_id
--     "Um atendente cuida de muitos tickets; cada ticket tem no maximo UM."
--     NULL: ticket recem-aberto ainda nao foi assumido por ninguem.
--     ON DELETE SET NULL: se o atendente sair da empresa, o ticket volta
--     para a fila em vez de ser apagado junto.
--
--  >>> Repare que ha DUAS FKs para a mesma tabela `users`. Isso e normal e se
--      chama auto-relacionamento multiplo. E por isso que toda query precisa
--      de dois JOINs com ALIAS diferentes (c e a) na tabela users.
--
--  categories (1) ──< (N) tickets  via category_id
--     ON DELETE RESTRICT: nunca deixamos um ticket apontar para o vazio.
--     Por isso o "delete" de categoria na API e logico (is_active = 0).
-- ---------------------------------------------------------------------------
CREATE TABLE tickets (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title       VARCHAR(150) NOT NULL,
  description TEXT         NOT NULL,

  status      ENUM('ABERTO', 'EM_ATENDIMENTO', 'RESOLVIDO', 'FECHADO')
              NOT NULL DEFAULT 'ABERTO',
  priority    ENUM('BAIXA', 'MEDIA', 'ALTA', 'URGENTE')
              NOT NULL DEFAULT 'MEDIA',

  category_id INT UNSIGNED NOT NULL,
  client_id   INT UNSIGNED NOT NULL,
  agent_id    INT UNSIGNED NULL,

  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                       ON UPDATE CURRENT_TIMESTAMP,
  -- Colunas de metrica: preenchidas pela aplicacao no momento da transicao.
  -- Guardamos o INSTANTE do evento em vez de calcular depois, porque o
  -- historico de status nao e armazenado (evitamos uma tabela de auditoria
  -- para nao complicar o projeto).
  resolved_at DATETIME NULL,
  closed_at   DATETIME NULL,

  PRIMARY KEY (id),

  CONSTRAINT fk_tickets_category
    FOREIGN KEY (category_id) REFERENCES categories (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,

  CONSTRAINT fk_tickets_client
    FOREIGN KEY (client_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,

  CONSTRAINT fk_tickets_agent
    FOREIGN KEY (agent_id) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,

  -- INDICES: cada um existe por causa de uma query real da aplicacao.
  --
  -- "meus tickets, mais recentes primeiro" (tela do cliente)
  KEY idx_tickets_client_created (client_id, created_at DESC),
  -- "tickets atribuidos a mim" (tela do atendente)
  KEY idx_tickets_agent_status (agent_id, status),
  -- "fila de trabalho: filtra por status, ordena por prioridade"
  KEY idx_tickets_status_priority (status, priority),
  -- "tickets por categoria" (dashboard)
  KEY idx_tickets_category (category_id),
  -- "tickets criados no periodo X" (metricas)
  KEY idx_tickets_created (created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- TICKET_MESSAGES
-- ---------------------------------------------------------------------------
-- Por que existe: a conversa e uma lista que cresce sem limite. Guardar tudo
-- num campo TEXT do ticket impediria saber QUEM escreveu e QUANDO, e tornaria
-- impossivel paginar ou buscar dentro do historico.
--
--  tickets (1) ──< (N) ticket_messages
--     ON DELETE CASCADE: mensagem nao existe sem o ticket. Se o admin apagar
--     o ticket, as mensagens vao junto automaticamente (o banco cuida disso;
--     nao precisamos de DELETE manual no repository).
--
--  users (1) ──< (N) ticket_messages
--     ON DELETE RESTRICT: a autoria e parte do historico. Nunca apagamos um
--     usuario que ja falou em algum ticket - desativamos (is_active = 0).
--
-- NAO ha coluna updated_at aqui de proposito: mensagem e um evento imutavel.
-- Historico que pode ser editado nao serve como historico.
-- ---------------------------------------------------------------------------
CREATE TABLE ticket_messages (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id   INT UNSIGNED NOT NULL,
  user_id     INT UNSIGNED NOT NULL,
  content     TEXT         NOT NULL,
  -- Nota interna: visivel apenas para ATENDENTE e ADMIN. E o tipo de detalhe
  -- que separa um sistema real de um CRUD de demonstracao.
  is_internal TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  CONSTRAINT fk_messages_ticket
    FOREIGN KEY (ticket_id) REFERENCES tickets (id)
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT fk_messages_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,

  -- Indice composto: a query "mensagens do ticket X em ordem cronologica"
  -- e resolvida inteiramente por este indice, sem ordenacao extra em memoria.
  KEY idx_messages_ticket_created (ticket_id, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
