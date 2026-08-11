/**
 * Executa o schema.sql contra o MySQL configurado no .env.
 *
 * Conecta SEM selecionar um database (o proprio script faz o CREATE DATABASE)
 * e usa `multipleStatements: true` porque o arquivo tem varios comandos.
 * Isso e seguro AQUI porque o SQL vem de um arquivo nosso, nunca do usuario -
 * na aplicacao, `multipleStatements` fica desligado justamente para dificultar
 * SQL injection encadeado.
 *
 * Uso: npm run db:migrate
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { env } from '../src/config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = await readFile(path.join(__dirname, 'schema.sql'), 'utf8');

  const connection = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true,
  });

  console.log(`[migrate] conectado em ${env.db.host}:${env.db.port}`);
  await connection.query(sql);
  console.log(`[migrate] schema aplicado no database "${env.db.name}"`);
  await connection.end();
}

migrate().catch((error) => {
  console.error('[migrate] falhou:', error.message);
  process.exit(1);
});
