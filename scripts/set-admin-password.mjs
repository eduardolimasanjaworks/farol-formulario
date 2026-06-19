#!/usr/bin/env node
/**
 * Define/atualiza o usuário admin (login + senha).
 * Uso: node scripts/set-admin-password.mjs
 * Lê ADMIN_BOOTSTRAP_LOGIN e ADMIN_BOOTSTRAP_PASSWORD do .env
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const loadEnvFile = () => {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
};

loadEnvFile();

const { initUserStore, findUserByLogin, createUser, updateUser, listUsers } = await import(
  '../server/user-db.mjs'
);

const login = String(process.env.ADMIN_BOOTSTRAP_LOGIN || '').trim().toLowerCase();
const password = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || '').trim();
const name = String(process.env.ADMIN_BOOTSTRAP_NAME || 'Administrador SDR').trim();

if (!login || !password) {
  console.error('Defina ADMIN_BOOTSTRAP_LOGIN e ADMIN_BOOTSTRAP_PASSWORD no .env');
  process.exit(1);
}

if (password.length < 6) {
  console.error('Senha deve ter no mínimo 6 caracteres.');
  process.exit(1);
}

const ok = await initUserStore();
if (!ok) {
  console.error('PostgreSQL não configurado (DATABASE_URL ou PGHOST no .env).');
  process.exit(1);
}

let user = await findUserByLogin(login);

if (!user) {
  const all = await listUsers();
  const admin = all.find((u) => u.role === 'admin');
  if (admin) {
    user = await updateUser(admin.id, { login, password, name, role: 'admin', isActive: true });
    console.log(`Admin atualizado: id=${user.id} login=${user.login}`);
  } else {
    user = await createUser({ login, name, password, role: 'admin', isActive: true });
    console.log(`Admin criado: id=${user.id} login=${user.login}`);
  }
} else {
  user = await updateUser(user.id, { password, name, role: 'admin', isActive: true });
  console.log(`Senha atualizada para login=${user.login}`);
}

console.log('Pronto. Use esse login na tela de entrada.');
