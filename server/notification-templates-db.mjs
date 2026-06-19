import { pool, safeTableName } from './db.mjs';

const DEFAULT_TABLE = 'event_notification_templates';
const TABLE_NAME = safeTableName(process.env.PG_NOTIFICATION_TEMPLATES_TABLE, DEFAULT_TABLE);

export const DEFAULT_NOTIFICATION_TEMPLATES = [
  {
    title: 'Lembrete 1 dia antes — Cliente',
    notification_type: 'event',
    offset_days: 1,
    offset_hours: 0,
    offset_minutes: 0,
    moment: 'before',
    recipient: 'cliente',
    message_body: `Olá {{primeiro_nome_lead}}

Lembrete: sua reunião com o assessor {{nome_assessor}} está marcada para amanhã, {{data_reuniao}}, às {{horario_reuniao}}.`,
    third_party_phone: null,
    is_active: true,
    sort_order: 10,
  },
  {
    title: 'Lembrete 1h antes — Assessor',
    notification_type: 'event',
    offset_days: 0,
    offset_hours: 1,
    offset_minutes: 0,
    moment: 'before',
    recipient: 'assessor',
    message_body: `Olá {{nome_assessor}}

Em 1 hora você tem reunião com {{nome_lead}} ({{whatsapp_lead}}) — {{data_reuniao}}, {{horario_reuniao}}.`,
    third_party_phone: null,
    is_active: true,
    sort_order: 20,
  },
];

const mapRow = (row) => ({
  id: row.id,
  title: row.title,
  notificationType: row.notification_type,
  offsetDays: row.offset_days,
  offsetHours: row.offset_hours,
  offsetMinutes: row.offset_minutes,
  moment: row.moment,
  recipient: row.recipient,
  messageBody: row.message_body,
  thirdPartyPhone: row.third_party_phone,
  isActive: row.is_active,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const validateTemplateInput = (input = {}, { partial = false } = {}) => {
  const title = input.title !== undefined ? String(input.title).trim() : undefined;
  const messageBody = input.messageBody !== undefined ? String(input.messageBody).trim() : undefined;
  const recipient = input.recipient !== undefined ? String(input.recipient).trim() : undefined;
  const moment = input.moment !== undefined ? String(input.moment).trim() : undefined;

  if (!partial || title !== undefined) {
    if (!title) throw new Error('Título da notificação é obrigatório.');
  }
  if (!partial || messageBody !== undefined) {
    if (!messageBody) throw new Error('Texto da mensagem é obrigatório.');
  }
  if (!partial || recipient !== undefined) {
    if (!['cliente', 'assessor', 'terceiro'].includes(recipient)) {
      throw new Error('Destinatário inválido. Use cliente, assessor ou terceiro.');
    }
  }
  if (!partial || moment !== undefined) {
    if (!['before', 'after'].includes(moment)) {
      throw new Error('Momento inválido. Use before ou after.');
    }
  }

  const offsetDays = input.offsetDays !== undefined ? Math.max(0, Number(input.offsetDays) || 0) : undefined;
  const offsetHours = input.offsetHours !== undefined ? Math.max(0, Number(input.offsetHours) || 0) : undefined;
  const offsetMinutes = input.offsetMinutes !== undefined ? Math.max(0, Number(input.offsetMinutes) || 0) : undefined;

  if (!partial) {
    const totalOffset = (offsetDays || 0) + (offsetHours || 0) + (offsetMinutes || 0);
    if (totalOffset <= 0) {
      throw new Error('Defina pelo menos 1 minuto de antecedência ou atraso.');
    }
    if (recipient === 'terceiro') {
      const phone = String(input.thirdPartyPhone || '').replace(/\D/g, '');
      if (!phone) throw new Error('Informe o WhatsApp do terceiro.');
    }
  }

  return {
    title,
    notificationType: input.notificationType !== undefined ? String(input.notificationType || 'event').trim() : undefined,
    offsetDays,
    offsetHours,
    offsetMinutes,
    moment,
    recipient,
    messageBody,
    thirdPartyPhone:
      input.thirdPartyPhone !== undefined ? String(input.thirdPartyPhone || '').replace(/\D/g, '') || null : undefined,
    isActive: input.isActive !== undefined ? Boolean(input.isActive) : undefined,
    sortOrder: input.sortOrder !== undefined ? Number(input.sortOrder) || 0 : undefined,
  };
};

export const initNotificationTemplateStore = async () => {
  if (!pool) return false;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      notification_type TEXT NOT NULL DEFAULT 'event',
      offset_days INTEGER NOT NULL DEFAULT 0,
      offset_hours INTEGER NOT NULL DEFAULT 0,
      offset_minutes INTEGER NOT NULL DEFAULT 0,
      moment TEXT NOT NULL DEFAULT 'before',
      recipient TEXT NOT NULL,
      message_body TEXT NOT NULL,
      third_party_phone TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const existing = await pool.query(`SELECT COUNT(*)::int AS total FROM ${TABLE_NAME}`);
  if ((existing.rows[0]?.total || 0) === 0) {
    for (const template of DEFAULT_NOTIFICATION_TEMPLATES) {
      await pool.query(
        `
        INSERT INTO ${TABLE_NAME}
          (title, notification_type, offset_days, offset_hours, offset_minutes, moment, recipient, message_body, third_party_phone, is_active, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          template.title,
          template.notification_type,
          template.offset_days,
          template.offset_hours,
          template.offset_minutes,
          template.moment,
          template.recipient,
          template.message_body,
          template.third_party_phone,
          template.is_active,
          template.sort_order,
        ]
      );
    }
  }

  return true;
};

export const listNotificationTemplates = async ({ activeOnly = false } = {}) => {
  if (!pool) throw new Error('PostgreSQL não configurado.');
  const result = await pool.query(
    `
    SELECT *
    FROM ${TABLE_NAME}
    ${activeOnly ? 'WHERE is_active = TRUE' : ''}
    ORDER BY sort_order ASC, id ASC
    `
  );
  return result.rows.map(mapRow);
};

export const getNotificationTemplateById = async (id, client = pool) => {
  if (!client) return null;
  const templateId = Number(id);
  if (!Number.isFinite(templateId) || templateId <= 0) return null;

  const result = await client.query(
    `SELECT * FROM ${TABLE_NAME} WHERE id = $1 LIMIT 1`,
    [templateId]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
};

export const createNotificationTemplate = async (input = {}) => {
  if (!pool) throw new Error('PostgreSQL não configurado.');
  const data = validateTemplateInput(input);

  const result = await pool.query(
    `
    INSERT INTO ${TABLE_NAME}
      (title, notification_type, offset_days, offset_hours, offset_minutes, moment, recipient, message_body, third_party_phone, is_active, sort_order)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
    `,
    [
      data.title,
      data.notificationType || 'event',
      data.offsetDays,
      data.offsetHours,
      data.offsetMinutes,
      data.moment,
      data.recipient,
      data.messageBody,
      data.thirdPartyPhone,
      data.isActive !== false,
      data.sortOrder || 0,
    ]
  );

  return mapRow(result.rows[0]);
};

export const updateNotificationTemplate = async (id, input = {}) => {
  if (!pool) throw new Error('PostgreSQL não configurado.');
  const data = validateTemplateInput(input, { partial: true });

  const fields = [];
  const values = [];
  let idx = 1;

  const push = (column, value) => {
    if (value === undefined) return;
    fields.push(`${column} = $${idx}`);
    values.push(value);
    idx += 1;
  };

  push('title', data.title);
  push('notification_type', data.notificationType);
  push('offset_days', data.offsetDays);
  push('offset_hours', data.offsetHours);
  push('offset_minutes', data.offsetMinutes);
  push('moment', data.moment);
  push('recipient', data.recipient);
  push('message_body', data.messageBody);
  push('third_party_phone', data.thirdPartyPhone);
  push('is_active', data.isActive);
  push('sort_order', data.sortOrder);

  if (!fields.length) throw new Error('Nenhum campo para atualizar.');

  fields.push('updated_at = NOW()');
  values.push(Number(id));

  const result = await pool.query(
    `UPDATE ${TABLE_NAME} SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  if (!result.rows[0]) return null;
  return mapRow(result.rows[0]);
};

export const deleteNotificationTemplate = async (id) => {
  if (!pool) throw new Error('PostgreSQL não configurado.');
  const result = await pool.query(`DELETE FROM ${TABLE_NAME} WHERE id = $1 RETURNING id`, [Number(id)]);
  return result.rows[0] || null;
};
