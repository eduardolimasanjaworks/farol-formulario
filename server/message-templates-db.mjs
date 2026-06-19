import { pool, safeTableName } from './db.mjs';

const DEFAULT_TABLE = 'app_message_templates';
const TABLE_NAME = safeTableName(process.env.PG_MESSAGE_TEMPLATES_TABLE, DEFAULT_TABLE);

export const DEFAULT_TEMPLATES = {
  cliente: `Olá {{primeiro_nome_lead}}

Conforme conversamos, você será atendido pelo assessor {{nome_assessor}}, se quiser tirar uma dúvida, esse é o número dele:
{{whatsapp_assessor}}

A reunião ficou marcada para {{data_reuniao}}, {{horario_reuniao}}.`,
  assessor: `Olá {{nome_assessor}}

Agendada uma nova reunião com o lead {{nome_lead}} (WhatsApp: {{whatsapp_lead}}), para a data {{data_reuniao}}, {{horario_reuniao}}.

Já está vinculado na sua agenda.`,
};

export const initMessageTemplateStore = async () => {
  if (!pool) return false;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      template_key TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  for (const [templateKey, body] of Object.entries(DEFAULT_TEMPLATES)) {
    await pool.query(
      `
      INSERT INTO ${TABLE_NAME} (template_key, body)
      VALUES ($1, $2)
      ON CONFLICT (template_key) DO NOTHING
      `,
      [templateKey, body]
    );
  }

  return true;
};

export const getMessageTemplates = async () => {
  const result = await pool.query(
    `
    SELECT template_key, body, updated_at
    FROM ${TABLE_NAME}
    WHERE template_key IN ('cliente', 'assessor')
    ORDER BY template_key ASC
    `
  );

  const templates = { ...DEFAULT_TEMPLATES };
  for (const row of result.rows) {
    templates[row.template_key] = row.body;
  }
  return templates;
};

export const updateMessageTemplates = async ({ cliente, assessor }) => {
  const clienteBody = String(cliente ?? '').trim();
  const assessorBody = String(assessor ?? '').trim();

  if (!clienteBody || !assessorBody) {
    throw new Error('As duas copys são obrigatórias.');
  }

  await pool.query('BEGIN');
  try {
    await pool.query(
      `
      INSERT INTO ${TABLE_NAME} (template_key, body, updated_at)
      VALUES ('cliente', $1, NOW())
      ON CONFLICT (template_key)
      DO UPDATE SET body = EXCLUDED.body, updated_at = NOW()
      `,
      [clienteBody]
    );
    await pool.query(
      `
      INSERT INTO ${TABLE_NAME} (template_key, body, updated_at)
      VALUES ('assessor', $1, NOW())
      ON CONFLICT (template_key)
      DO UPDATE SET body = EXCLUDED.body, updated_at = NOW()
      `,
      [assessorBody]
    );
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }

  return getMessageTemplates();
};
