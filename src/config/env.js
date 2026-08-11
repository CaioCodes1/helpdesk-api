/**
 * Ponto UNICO de leitura de variaveis de ambiente.
 *
 * Regra do projeto: nenhum outro arquivo usa `process.env` diretamente.
 * Motivos:
 *  1. Se uma variavel obrigatoria faltar, a aplicacao morre AGORA, no boot,
 *     com mensagem clara - e nao daqui a duas horas, no meio de um login.
 *  2. Conversao de tipo acontece num lugar so (process.env e sempre string).
 *  3. Da para ver, em um arquivo, tudo que o sistema precisa para rodar.
 */
import 'dotenv/config';

function required(key) {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(
      `Variavel de ambiente obrigatoria ausente: ${key}. ` +
        'Copie .env.example para .env e preencha os valores.',
    );
  }
  return value;
}

function optional(key, fallback) {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const nodeEnv = optional('NODE_ENV', 'development');

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: toInt(optional('PORT', '3000'), 3000),

  db: {
    host: optional('DB_HOST', 'localhost'),
    port: toInt(optional('DB_PORT', '3306'), 3306),
    user: optional('DB_USER', 'root'),
    password: optional('DB_PASSWORD', ''),
    name: optional('DB_NAME', 'helpdesk'),
    connectionLimit: toInt(optional('DB_CONNECTION_LIMIT', '10'), 10),
  },

  jwt: {
    // Sem fallback de proposito: um segredo default seria um buraco de
    // seguranca que ninguem percebe ate ir para producao.
    secret: required('JWT_SECRET'),
    expiresIn: optional('JWT_EXPIRES_IN', '8h'),
  },

  bcryptSaltRounds: toInt(optional('BCRYPT_SALT_ROUNDS', '10'), 10),

  corsOrigin: optional('CORS_ORIGIN', '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  logLevel: optional('LOG_LEVEL', 'info'),
};
