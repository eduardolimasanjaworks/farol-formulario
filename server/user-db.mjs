import bcrypt from 'bcryptjs';
import { pool, safeTableName } from './db.mjs';

const DEFAULT_TABLE = 'app_users';
const TABLE_NAME = safeTableName(process.env.PG_USERS_TABLE, DEFAULT_TABLE);

const normalizeLogin = (value = '') => String(value || '').trim().toLowerCase();

export const initUserStore = async () => {
  if (!pool) return false;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id BIGSERIAL PRIMARY KEY,
      login TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  return true;
};

export const ensureBootstrapAdmin = async () => {
  if (!pool) return false;

  const login = normalizeLogin(process.env.ADMIN_BOOTSTRAP_LOGIN);
  const password = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || '').trim();
  const name = String(process.env.ADMIN_BOOTSTRAP_NAME || 'Administrador').trim();

  if (!login || !password) return false;

  const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM ${TABLE_NAME}`);
  if ((countResult.rows[0]?.total || 0) > 0) return false;

  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    `
    INSERT INTO ${TABLE_NAME} (login, name, password_hash, role, is_active)
    VALUES ($1, $2, $3, 'admin', TRUE)
    `,
    [login, name, passwordHash]
  );
  return true;
};

export const findUserByLogin = async (login) => {
  const cleanLogin = normalizeLogin(login);
  if (!cleanLogin || !pool) return null;

  const result = await pool.query(
    `
    SELECT id, login, name, password_hash, role, is_active, created_at, updated_at
    FROM ${TABLE_NAME}
    WHERE login = $1
    LIMIT 1
    `,
    [cleanLogin]
  );
  return result.rows[0] || null;
};

export const listUsers = async () => {
  const result = await pool.query(
    `
    SELECT id, login, name, role, is_active, created_at, updated_at
    FROM ${TABLE_NAME}
    ORDER BY id ASC
    `
  );
  return result.rows;
};

export const createUser = async ({ login, name, password, role = 'user', isActive = true }) => {
  const cleanLogin = normalizeLogin(login);
  const cleanName = String(name || '').trim();
  const cleanPassword = String(password || '');
  const cleanRole = role === 'admin' ? 'admin' : 'user';

  if (!cleanLogin || !cleanName || cleanPassword.length < 6) {
    throw new Error('Login, nome e senha (min. 6) são obrigatórios.');
  }

  const passwordHash = await bcrypt.hash(cleanPassword, 12);

  try {
    const result = await pool.query(
      `
      INSERT INTO ${TABLE_NAME} (login, name, password_hash, role, is_active)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, login, name, role, is_active, created_at, updated_at
      `,
      [cleanLogin, cleanName, passwordHash, cleanRole, Boolean(isActive)]
    );
    return result.rows[0];
  } catch (error) {
    if (error?.code === '23505') {
      throw new Error('Este login já está em uso.');
    }
    throw error;
  }
};

export const updateUser = async (id, payload = {}) => {
  const updates = [];
  const values = [];
  let index = 1;

  if (payload.login !== undefined) {
    updates.push(`login = $${index++}`);
    values.push(normalizeLogin(payload.login));
  }
  if (payload.name !== undefined) {
    updates.push(`name = $${index++}`);
    values.push(String(payload.name || '').trim());
  }
  if (payload.role !== undefined) {
    updates.push(`role = $${index++}`);
    values.push(payload.role === 'admin' ? 'admin' : 'user');
  }
  if (payload.isActive !== undefined) {
    updates.push(`is_active = $${index++}`);
    values.push(Boolean(payload.isActive));
  }
  if (payload.password !== undefined) {
    const cleanPassword = String(payload.password || '');
    if (cleanPassword && cleanPassword.length < 6) {
      throw new Error('Senha deve ter no mínimo 6 caracteres.');
    }
    if (cleanPassword) {
      const hash = await bcrypt.hash(cleanPassword, 12);
      updates.push(`password_hash = $${index++}`);
      values.push(hash);
    }
  }

  if (!updates.length) {
    throw new Error('Nenhum campo informado para atualização.');
  }

  updates.push(`updated_at = NOW()`);
  values.push(Number(id));

  const result = await pool.query(
    `
    UPDATE ${TABLE_NAME}
    SET ${updates.join(', ')}
    WHERE id = $${index}
    RETURNING id, login, name, role, is_active, created_at, updated_at
    `
  , values);

  return result.rows[0] || null;
};

export const deleteUser = async (id) => {
  const result = await pool.query(
    `
    DELETE FROM ${TABLE_NAME}
    WHERE id = $1
    RETURNING id
    `,
    [Number(id)]
  );
  return result.rows[0] || null;
};
