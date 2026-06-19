import { pool, safeTableName } from './db.mjs';

const DEFAULT_TABLE = 'app_assessores';
const TABLE_NAME = safeTableName(process.env.PG_ASSESSORES_TABLE, DEFAULT_TABLE);

export const normalizePhone = (value = '') => {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  digits = digits.replace(/^0+/, '');
  if (digits.startsWith('55')) digits = digits.slice(0, 13);
  else if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  else if (digits.length > 13) digits = digits.slice(0, 13);
  return digits;
};

export const initAssessorStore = async () => {
  if (!pool) return false;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_name ON ${TABLE_NAME} (LOWER(name))
  `);
  return true;
};

export const listAssessores = async ({ includeInactive = false } = {}) => {
  const result = await pool.query(
    `
    SELECT id, name, phone, email, is_active, created_at, updated_at
    FROM ${TABLE_NAME}
    ${includeInactive ? '' : 'WHERE is_active = TRUE'}
    ORDER BY LOWER(name) ASC
    `
  );
  return result.rows;
};

export const findAssessorById = async (id) => {
  const result = await pool.query(
    `
    SELECT id, name, phone, email, is_active, created_at, updated_at
    FROM ${TABLE_NAME}
    WHERE id = $1
    LIMIT 1
    `,
    [Number(id)]
  );
  return result.rows[0] || null;
};

export const createAssessor = async ({ name, phone, email = '' }) => {
  const cleanName = String(name || '').trim();
  const cleanPhone = normalizePhone(phone);
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!cleanName) throw new Error('Nome do assessor é obrigatório.');
  if (!cleanPhone || cleanPhone.length < 12) {
    throw new Error('WhatsApp inválido. Informe DDD + número.');
  }

  const result = await pool.query(
    `
    INSERT INTO ${TABLE_NAME} (name, phone, email, is_active)
    VALUES ($1, $2, $3, TRUE)
    RETURNING id, name, phone, email, is_active, created_at, updated_at
    `,
    [cleanName, cleanPhone, cleanEmail]
  );
  return result.rows[0];
};

export const updateAssessor = async (id, payload = {}) => {
  const updates = [];
  const values = [];
  let index = 1;

  if (payload.name !== undefined) {
    const cleanName = String(payload.name || '').trim();
    if (!cleanName) throw new Error('Nome do assessor é obrigatório.');
    updates.push(`name = $${index++}`);
    values.push(cleanName);
  }
  if (payload.phone !== undefined) {
    const cleanPhone = normalizePhone(payload.phone);
    if (!cleanPhone || cleanPhone.length < 12) {
      throw new Error('WhatsApp inválido. Informe DDD + número.');
    }
    updates.push(`phone = $${index++}`);
    values.push(cleanPhone);
  }
  if (payload.email !== undefined) {
    updates.push(`email = $${index++}`);
    values.push(String(payload.email || '').trim().toLowerCase());
  }
  if (payload.isActive !== undefined) {
    updates.push(`is_active = $${index++}`);
    values.push(Boolean(payload.isActive));
  }

  if (!updates.length) throw new Error('Nenhum campo informado para atualização.');

  updates.push('updated_at = NOW()');
  values.push(Number(id));

  const result = await pool.query(
    `
    UPDATE ${TABLE_NAME}
    SET ${updates.join(', ')}
    WHERE id = $${index}
    RETURNING id, name, phone, email, is_active, created_at, updated_at
    `,
    values
  );
  return result.rows[0] || null;
};

export const deleteAssessor = async (id) => {
  const result = await pool.query(
    `
    UPDATE ${TABLE_NAME}
    SET is_active = FALSE, updated_at = NOW()
    WHERE id = $1 AND is_active = TRUE
    RETURNING id
    `,
    [Number(id)]
  );
  return result.rows[0] || null;
};
