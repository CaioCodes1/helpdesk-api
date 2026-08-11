/**
 * Logger minimalista.
 *
 * Por que nao usar `console.log` direto?
 *  - Nao da para desligar logs de debug em producao.
 *  - Nao ha timestamp nem nivel, entao o log nao serve para investigar nada.
 *  - `console.log` escreve em stdout ate para erros; erro deve ir para stderr.
 *
 * Por que nao usar winston/pino? Seria a escolha certa num sistema grande.
 * Aqui, 40 linhas resolvem e mantem o projeto viavel para uma pessoa.
 */
import { env } from '../config/env.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[env.logLevel] ?? LEVELS.info;

function write(level, message, meta) {
  if (LEVELS[level] > currentLevel) return;

  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  const stream = level === 'error' ? console.error : console.log;

  if (meta !== undefined) {
    stream(line, typeof meta === 'object' ? JSON.stringify(meta) : meta);
  } else {
    stream(line);
  }
}

export const logger = {
  error: (message, meta) => write('error', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  info: (message, meta) => write('info', message, meta),
  debug: (message, meta) => write('debug', message, meta),
};
