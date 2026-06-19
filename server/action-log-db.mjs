import { pool, isPostgresConfigured, safeTableName } from './db.mjs';

const DEFAULT_TABLE = 'sdr_action_logs';
const TABLE_NAME = safeTableName(process.env.PG_LOG_TABLE, DEFAULT_TABLE);

export const initActionLogStore = async () => {
  if (!pool) return false;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id BIGSERIAL PRIMARY KEY,
      action_type TEXT NOT NULL,
      action_status TEXT NOT NULL,
      assessor TEXT,
      cliente TEXT,
      schedule_date DATE,
      schedule_time TEXT,
      source TEXT,
      phone_cliente TEXT,
      phone_assessor TEXT,
      detail JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  return true;
};

export const insertActionLog = async (payload = {}) => {
  if (!pool) {
    throw new Error('PostgreSQL não configurado. Defina DATABASE_URL ou variáveis PG*.');
  }

  const {
    actionType = 'sdr_submit',
    actionStatus = 'unknown',
    assessor = null,
    cliente = null,
    scheduleDate = null,
    scheduleTime = null,
    source = null,
    phoneCliente = null,
    phoneAssessor = null,
    detail = null,
  } = payload;

  const result = await pool.query(
    `
    INSERT INTO ${TABLE_NAME}
      (action_type, action_status, assessor, cliente, schedule_date, schedule_time, source, phone_cliente, phone_assessor, detail)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
    RETURNING id, created_at
    `,
    [
      actionType,
      actionStatus,
      assessor,
      cliente,
      scheduleDate,
      scheduleTime,
      source,
      phoneCliente,
      phoneAssessor,
      detail ? JSON.stringify(detail) : null,
    ]
  );

  return result.rows[0];
};

export const listRecentActionLogs = async (limit = 100) => {
  if (!pool) {
    throw new Error('PostgreSQL não configurado. Defina DATABASE_URL ou variáveis PG*.');
  }

  const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const result = await pool.query(
    `
    SELECT id, action_type, action_status, assessor, cliente, schedule_date, schedule_time, source, phone_cliente, phone_assessor, detail, created_at
    FROM ${TABLE_NAME}
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [boundedLimit]
  );

  return result.rows;
};
