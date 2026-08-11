/**
 * Pool de conexoes MySQL.
 *
 * Por que POOL e nao uma conexao unica?
 * Abrir conexao TCP + autenticar custa dezenas de milissegundos. Se cada
 * requisicao abrisse a sua, a API ficaria lenta e o MySQL estouraria o limite
 * de conexoes. O pool mantem N conexoes prontas e as empresta/devolve.
 *
 * Por que `pool.execute` e nao `pool.query`?
 * `execute` usa PREPARED STATEMENTS: o SQL e enviado ao servidor separado dos
 * valores. O banco entao NAO consegue interpretar um valor como comando -
 * e essa e a defesa real contra SQL injection. Concatenar string em SQL
 * (`WHERE email = '` + email + `'`) e o bug classico que derruba sistemas.
 */
import mysql from 'mysql2/promise';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.name,
  waitForConnections: true,
  connectionLimit: env.db.connectionLimit,
  queueLimit: 0,
  // Datas voltam como string 'YYYY-MM-DD HH:mm:ss' em vez de Date do JS,
  // evitando conversao implicita de fuso horario entre o MySQL e o Node.
  dateStrings: true,
  // Desligado de proposito: impede que uma eventual injecao encadeie
  // um segundo comando com ";".
  multipleStatements: false,
  timezone: 'Z',
});

/**
 * Atalho para SELECT/INSERT/UPDATE/DELETE parametrizados.
 * @param {string} sql        SQL com placeholders `?`
 * @param {Array}  params     valores dos placeholders
 */
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * Executa uma funcao dentro de uma TRANSACAO.
 *
 * Usado quando duas ou mais escritas precisam acontecer "tudo ou nada" -
 * por exemplo: criar o ticket E gravar a primeira mensagem. Se a segunda
 * falhar, o rollback desfaz a primeira e o banco nao fica inconsistente.
 *
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<any>} callback
 */
export async function withTransaction(callback) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    // `finally` garante a devolucao da conexao ao pool mesmo em caso de erro.
    // Esquecer o release() e a causa numero 1 de "a API travou depois de um tempo".
    connection.release();
  }
}

export async function testConnection() {
  const connection = await pool.getConnection();
  try {
    await connection.ping();
    logger.info(`Banco conectado: ${env.db.user}@${env.db.host}:${env.db.port}/${env.db.name}`);
  } finally {
    connection.release();
  }
}

export async function closePool() {
  await pool.end();
  logger.info('Pool de conexoes encerrado');
}
