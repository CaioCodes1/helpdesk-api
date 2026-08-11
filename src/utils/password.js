/**
 * Hashing de senhas com bcrypt.
 *
 * POR QUE HASH E NAO CRIPTOGRAFIA?
 * Criptografia e reversivel - existe uma chave que devolve o texto original.
 * Se a chave vazar junto com o banco, todas as senhas vazam. Hash e de mao
 * unica: nao existe funcao inversa. Para conferir a senha, nos hasheamos a
 * tentativa e comparamos os hashes. O sistema NUNCA sabe a senha real.
 *
 * POR QUE BCRYPT E NAO SHA-256/MD5?
 * SHA-256 foi feito para ser RAPIDO - uma GPU calcula bilhoes por segundo, o
 * que e otimo para forca bruta. Bcrypt foi feito para ser LENTO e ter custo
 * ajustavel (saltRounds). Cada +1 em saltRounds DOBRA o tempo de calculo:
 * 10 rounds ~ 100ms. Imperceptivel num login, proibitivo para quem tenta
 * milhoes de senhas.
 *
 * E O SALT?
 * Bcrypt gera um salt aleatorio por senha e o embute no proprio hash. Por isso
 * duas pessoas com a senha "123456" ficam com hashes DIFERENTES no banco - e
 * um atacante nao consegue usar rainbow tables (tabelas pre-computadas).
 *
 * Formato do hash gerado:  $2a$10$N9qo8uLOickgx2ZMRZoMy.MH...
 *                           │  │  └── salt (22 chars) + digest
 *                           │  └───── custo (rounds)
 *                           └──────── versao do algoritmo
 */
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

export async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, env.bcryptSaltRounds);
}

/**
 * Compara a senha digitada com o hash guardado.
 * `bcrypt.compare` extrai o salt do proprio hash, refaz o calculo e compara em
 * tempo constante (nao retorna cedo na primeira diferenca), o que evita
 * ataques de temporizacao.
 */
export async function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}
