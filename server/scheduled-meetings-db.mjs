import { pool, safeTableName } from './db.mjs';
import {
  getNotificationTemplateById,
  listNotificationTemplates,
} from './notification-templates-db.mjs';
import {
  computeScheduledAt,
  meetingAtFromBr,
  recipientLabel,
  resolveRecipientPhone,
} from './notification-schedule.mjs';
import { buildMessageTemplateVars, renderMessageTemplate } from './message-render.mjs';
import { sendEvolutionText } from './evolution-send.mjs';
import { formatDateToBr, normalizeIsoDate } from './date-format.mjs';
import { MEETING_STATUS, NOTIFICATION_STATUS } from './schedule-constants.mjs';
import { canManageScheduledMeeting, normalizeLogin } from './schedule-auth.mjs';

const MEETINGS_TABLE = safeTableName(process.env.PG_SCHEDULED_MEETINGS_TABLE, 'scheduled_meetings');
const NOTIFICATIONS_TABLE = safeTableName(
  process.env.PG_SCHEDULED_NOTIFICATIONS_TABLE,
  'scheduled_notifications'
);

const parseExternalEvents = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const mapMeetingRow = (row) => ({
  id: row.id,
  assessor: row.assessor,
  cliente: row.cliente,
  meetingDate: normalizeIsoDate(row.meeting_date),
  meetingTime: row.meeting_time,
  meetingAt: row.meeting_at,
  phoneCliente: row.phone_cliente,
  phoneAssessor: row.phone_assessor,
  source: row.source,
  createdBy: row.created_by,
  createdByUserId: row.created_by_user_id ?? null,
  externalEvents: parseExternalEvents(row.external_events),
  status: row.status,
  createdAt: row.created_at,
});

const mapNotificationRow = (row) => ({
  id: row.id,
  meetingId: row.meeting_id,
  templateId: row.template_id,
  title: row.title,
  recipient: row.recipient,
  recipientLabel: recipientLabel(row.recipient),
  phoneNumber: row.phone_number,
  messageBody: row.message_body,
  scheduledAt: row.scheduled_at,
  status: row.status,
  sentAt: row.sent_at,
  errorMessage: row.error_message,
  meetingAt: row.meeting_at,
  assessor: row.assessor,
  cliente: row.cliente,
  meetingDate: normalizeIsoDate(row.meeting_date),
  meetingTime: row.meeting_time,
  meetingStatus: row.meeting_status ?? null,
  createdAt: row.created_at,
});

const formatWhatsappDisplay = (normalizedDigits = '') => {
  if (!normalizedDigits) return '';
  const digits = normalizedDigits.startsWith('55')
    ? normalizedDigits.slice(2)
    : normalizedDigits;
  const ddd = digits.slice(0, 2);
  const partA = digits.length >= 10 ? digits.slice(2, 7) : digits.slice(2, 6);
  const partB = digits.length >= 10 ? digits.slice(7, 11) : digits.slice(6, 10);
  return `+55 (${ddd}) ${partA}-${partB}`;
};

export const initScheduledMeetingStore = async () => {
  if (!pool) return false;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MEETINGS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      assessor TEXT NOT NULL,
      cliente TEXT NOT NULL,
      meeting_date DATE NOT NULL,
      meeting_time TEXT NOT NULL,
      meeting_at TIMESTAMPTZ NOT NULL,
      phone_cliente TEXT NOT NULL,
      phone_assessor TEXT NOT NULL,
      source TEXT,
      created_by TEXT,
      created_by_user_id BIGINT,
      status TEXT NOT NULL DEFAULT '${MEETING_STATUS.SCHEDULED}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE ${MEETINGS_TABLE}
    ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT
  `);

  await pool.query(`
    ALTER TABLE ${MEETINGS_TABLE}
    ADD COLUMN IF NOT EXISTS external_events JSONB NOT NULL DEFAULT '[]'::jsonb
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${NOTIFICATIONS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      meeting_id BIGINT NOT NULL REFERENCES ${MEETINGS_TABLE}(id) ON DELETE CASCADE,
      template_id BIGINT,
      title TEXT NOT NULL,
      recipient TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      message_body TEXT NOT NULL,
      scheduled_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT '${NOTIFICATION_STATUS.PENDING}',
      sent_at TIMESTAMPTZ,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_pending
    ON ${NOTIFICATIONS_TABLE} (scheduled_at)
    WHERE status = '${NOTIFICATION_STATUS.PENDING}'
  `);

  return true;
};

const buildVarsForMeeting = (meeting) =>
  buildMessageTemplateVars({
    assessor: meeting.assessor,
    cliente: meeting.cliente,
    whatsappAssessor: formatWhatsappDisplay(meeting.phone_assessor),
    whatsappClienteFmt: formatWhatsappDisplay(meeting.phone_cliente),
    dataFormatada: formatDateToBr(meeting.meeting_date),
    horarioTexto: meeting.meeting_time,
  });

export const createScheduledMeetingWithNotifications = async (payload = {}) => {
  if (!pool) throw new Error('PostgreSQL não configurado.');

  const {
    assessor,
    cliente,
    meetingDate,
    meetingTime,
    phoneCliente,
    phoneAssessor,
    source = 'Farol SDR',
    createdBy = null,
    createdByUserId = null,
    externalEvents = [],
  } = payload;

  if (!assessor || !cliente || !meetingDate || !meetingTime || !phoneCliente || !phoneAssessor) {
    throw new Error('Dados incompletos para salvar o agendamento.');
  }

  const meetingAt = meetingAtFromBr(meetingDate, meetingTime);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const meetingResult = await client.query(
      `
      INSERT INTO ${MEETINGS_TABLE}
        (
          assessor,
          cliente,
          meeting_date,
          meeting_time,
          meeting_at,
          phone_cliente,
          phone_assessor,
          source,
          created_by,
          created_by_user_id,
          external_events
        )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
      RETURNING *
      `,
      [
        assessor,
        cliente,
        meetingDate,
        meetingTime,
        meetingAt.toISOString(),
        String(phoneCliente).replace(/\D/g, ''),
        String(phoneAssessor).replace(/\D/g, ''),
        source,
        createdBy,
        createdByUserId,
        JSON.stringify(Array.isArray(externalEvents) ? externalEvents : []),
      ]
    );

    const meeting = meetingResult.rows[0];
    const templates = await listNotificationTemplates({ activeOnly: true });
    const vars = buildVarsForMeeting(meeting);
    const notifications = [];
    const now = Date.now();

    for (const template of templates) {
      const phone = resolveRecipientPhone(
        {
          recipient: template.recipient,
          third_party_phone: template.thirdPartyPhone,
        },
        meeting
      );

      if (!phone) {
        notifications.push({
          templateId: template.id,
          title: template.title,
          recipient: template.recipient,
          status: NOTIFICATION_STATUS.SKIPPED,
          reason: 'Telefone do destinatário ausente.',
        });
        continue;
      }

      const scheduledAt = computeScheduledAt(meetingAt, {
        offset_days: template.offsetDays,
        offset_hours: template.offsetHours,
        offset_minutes: template.offsetMinutes,
        moment: template.moment,
      });

      const messageBody = renderMessageTemplate(template.messageBody, vars);
      const status =
        scheduledAt.getTime() < now - 60_000 ? NOTIFICATION_STATUS.SKIPPED : NOTIFICATION_STATUS.PENDING;

      const insertResult = await client.query(
        `
        INSERT INTO ${NOTIFICATIONS_TABLE}
          (meeting_id, template_id, title, recipient, phone_number, message_body, scheduled_at, status, error_message)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
        `,
        [
          meeting.id,
          template.id,
          template.title,
          template.recipient,
          phone,
          messageBody,
          scheduledAt.toISOString(),
          status,
          status === NOTIFICATION_STATUS.SKIPPED
            ? 'Horário de envio já passou no momento do agendamento.'
            : null,
        ]
      );

      notifications.push(mapNotificationRow({
        ...insertResult.rows[0],
        meeting_at: meeting.meeting_at,
        assessor: meeting.assessor,
        cliente: meeting.cliente,
        meeting_date: meeting.meeting_date,
        meeting_time: meeting.meeting_time,
      }));
    }

    await client.query('COMMIT');

    return {
      meeting: mapMeetingRow(meeting),
      notifications,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const getScheduledMeetingById = async (id) => {
  if (!pool) throw new Error('PostgreSQL não configurado.');
  const meetingId = Number(id);
  if (!Number.isFinite(meetingId) || meetingId <= 0) return null;

  const result = await pool.query(
    `SELECT * FROM ${MEETINGS_TABLE} WHERE id = $1`,
    [meetingId]
  );

  return result.rows[0] ? mapMeetingRow(result.rows[0]) : null;
};

const cancelScheduledMeetingRecord = async (meetingId, client = pool) => {
  const meetingResult = await client.query(
    `
    UPDATE ${MEETINGS_TABLE}
    SET status = $2
    WHERE id = $1 AND status = $3
    RETURNING *
    `,
    [meetingId, MEETING_STATUS.CANCELLED, MEETING_STATUS.SCHEDULED]
  );

  if (!meetingResult.rows[0]) return null;

  await client.query(
    `
    UPDATE ${NOTIFICATIONS_TABLE}
    SET status = $2, error_message = 'Reunião cancelada.'
    WHERE meeting_id = $1 AND status = $3
    `,
    [meetingId, NOTIFICATION_STATUS.CANCELLED, NOTIFICATION_STATUS.PENDING]
  );

  return mapMeetingRow(meetingResult.rows[0]);
};

const buildVisibilityPredicate = (user = {}, startIndex = 1, alias = '') => {
  if (user?.role === 'admin') {
    return { sql: 'TRUE', values: [] };
  }

  const prefix = alias ? `${alias}.` : '';
  const values = [];
  const predicates = [];
  let index = startIndex;

  const userId = Number(user?.sub);
  if (Number.isFinite(userId) && userId > 0) {
    predicates.push(`${prefix}created_by_user_id = $${index++}`);
    values.push(userId);
  }

  const login = normalizeLogin(user?.login);
  if (login) {
    predicates.push(`LOWER(${prefix}created_by) = $${index++}`);
    values.push(login);
  }

  if (!predicates.length) {
    return { sql: 'FALSE', values: [] };
  }

  return {
    sql: `(${predicates.join(' OR ')})`,
    values,
  };
};

export const cancelScheduledMeetingForUser = async (id, user = {}, options = {}) => {
  if (!pool) throw new Error('PostgreSQL não configurado.');

  const meetingId = Number(id);
  if (!Number.isFinite(meetingId) || meetingId <= 0) {
    return { ok: false, code: 'NOT_FOUND', error: 'Reunião não encontrada.' };
  }

  const meeting = await getScheduledMeetingById(meetingId);
  if (!meeting) {
    return { ok: false, code: 'NOT_FOUND', error: 'Reunião não encontrada.' };
  }

  if (meeting.status === MEETING_STATUS.CANCELLED) {
    return { ok: false, code: 'ALREADY_CANCELLED', error: 'Esta reunião já foi cancelada.' };
  }

  if (meeting.status !== MEETING_STATUS.SCHEDULED) {
    return { ok: false, code: 'NOT_CANCELLABLE', error: 'Esta reunião não pode mais ser cancelada.' };
  }

  if (!canManageScheduledMeeting(meeting, user)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      error: 'Apenas o admin ou o SDR que criou o agendamento pode cancelar.',
    };
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    if (typeof options.beforeCommit === 'function') {
      await options.beforeCommit(meeting, dbClient);
    }
    const cancelled = await cancelScheduledMeetingRecord(meetingId, dbClient);
    if (!cancelled) {
      await dbClient.query('ROLLBACK');
      return { ok: false, code: 'CONFLICT', error: 'Não foi possível cancelar a reunião.' };
    }
    await dbClient.query('COMMIT');
    return { ok: true, meeting: cancelled };
  } catch (error) {
    await dbClient.query('ROLLBACK');
    throw error;
  } finally {
    dbClient.release();
  }
};

const reschedulePendingNotifications = async (meetingRow, meetingAt, client) => {
  const vars = buildVarsForMeeting(meetingRow);
  const now = Date.now();
  const pendingResult = await client.query(
    `
    SELECT *
    FROM ${NOTIFICATIONS_TABLE}
    WHERE meeting_id = $1 AND status = $2
    `,
    [meetingRow.id, NOTIFICATION_STATUS.PENDING]
  );

  for (const notif of pendingResult.rows) {
    const template = notif.template_id
      ? await getNotificationTemplateById(notif.template_id, client)
      : null;

    let scheduledAt = new Date(notif.scheduled_at);
    let messageBody = notif.message_body;
    let status = NOTIFICATION_STATUS.PENDING;
    let errorMessage = null;

    if (template) {
      scheduledAt = computeScheduledAt(meetingAt, {
        offset_days: template.offsetDays,
        offset_hours: template.offsetHours,
        offset_minutes: template.offsetMinutes,
        moment: template.moment,
      });
      messageBody = renderMessageTemplate(template.messageBody, vars);
    }

    if (scheduledAt.getTime() < now - 60_000) {
      status = NOTIFICATION_STATUS.SKIPPED;
      errorMessage = 'Horário de envio já passou após a remarcação.';
    }

    await client.query(
      `
      UPDATE ${NOTIFICATIONS_TABLE}
      SET scheduled_at = $2, message_body = $3, status = $4, error_message = $5
      WHERE id = $1
      `,
      [notif.id, scheduledAt.toISOString(), messageBody, status, errorMessage]
    );
  }
};

export const rescheduleScheduledMeetingForUser = async (id, payload = {}, user = {}, options = {}) => {
  if (!pool) throw new Error('PostgreSQL não configurado.');

  const meetingId = Number(id);
  const meetingDate = normalizeIsoDate(payload.meetingDate);
  const meetingTime = String(payload.meetingTime || '').trim();

  if (!Number.isFinite(meetingId) || meetingId <= 0) {
    return { ok: false, code: 'NOT_FOUND', error: 'Reunião não encontrada.' };
  }

  if (!meetingDate || !meetingTime) {
    return { ok: false, code: 'INVALID', error: 'Informe data e horário válidos.' };
  }

  const meeting = await getScheduledMeetingById(meetingId);
  if (!meeting) {
    return { ok: false, code: 'NOT_FOUND', error: 'Reunião não encontrada.' };
  }

  if (meeting.status !== MEETING_STATUS.SCHEDULED) {
    return { ok: false, code: 'NOT_RESCHEDULABLE', error: 'Apenas reuniões ativas podem ser remarcadas.' };
  }

  if (!canManageScheduledMeeting(meeting, user)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      error: 'Apenas o admin ou o SDR que criou o agendamento pode remarcar.',
    };
  }

  const meetingAt = meetingAtFromBr(meetingDate, meetingTime);
  const dbClient = await pool.connect();

  try {
    await dbClient.query('BEGIN');

    const meetingResult = await dbClient.query(
      `
      UPDATE ${MEETINGS_TABLE}
      SET meeting_date = $2, meeting_time = $3, meeting_at = $4
      WHERE id = $1 AND status = $5
      RETURNING *
      `,
      [meetingId, meetingDate, meetingTime, meetingAt.toISOString(), MEETING_STATUS.SCHEDULED]
    );

    if (!meetingResult.rows[0]) {
      await dbClient.query('ROLLBACK');
      return { ok: false, code: 'CONFLICT', error: 'Não foi possível remarcar a reunião.' };
    }

    if (typeof options.beforeCommit === 'function') {
      const syncResult = await options.beforeCommit(
        meeting,
        {
          meetingDate,
          meetingTime,
          meetingAt,
        },
        dbClient
      );

      if (Array.isArray(syncResult?.externalEvents)) {
        await dbClient.query(
          `
          UPDATE ${MEETINGS_TABLE}
          SET external_events = $2::jsonb
          WHERE id = $1
          `,
          [meetingId, JSON.stringify(syncResult.externalEvents)]
        );
        meetingResult.rows[0].external_events = syncResult.externalEvents;
      }
    }

    await reschedulePendingNotifications(meetingResult.rows[0], meetingAt, dbClient);
    await dbClient.query('COMMIT');

    return { ok: true, meeting: mapMeetingRow(meetingResult.rows[0]) };
  } catch (error) {
    await dbClient.query('ROLLBACK');
    throw error;
  } finally {
    dbClient.release();
  }
};

export const updateScheduledMeetingExternalEvents = async (id, externalEvents = [], client = pool) => {
  const result = await client.query(
    `
    UPDATE ${MEETINGS_TABLE}
    SET external_events = $2::jsonb
    WHERE id = $1
    RETURNING *
    `,
    [Number(id), JSON.stringify(Array.isArray(externalEvents) ? externalEvents : [])]
  );

  return result.rows[0] ? mapMeetingRow(result.rows[0]) : null;
};

export const listScheduledMeetings = async ({
  limit = 100,
  status = MEETING_STATUS.SCHEDULED,
  user = {},
} = {}) => {
  if (!pool) throw new Error('PostgreSQL não configurado.');
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const values = [];
  let index = 1;
  const conditions = [];

  if (status) {
    conditions.push(`status = $${index++}`);
    values.push(status);
  }

  const visibility = buildVisibilityPredicate(user, index);
  conditions.push(visibility.sql);
  values.push(...visibility.values);
  index += visibility.values.length;

  const result = await pool.query(
    `
    SELECT *
    FROM ${MEETINGS_TABLE}
    WHERE ${conditions.join(' AND ')}
    ORDER BY meeting_at ASC
    LIMIT $${index}
    `,
    [...values, boundedLimit]
  );

  return result.rows.map(mapMeetingRow);
};

export const listScheduledNotifications = async ({ limit = 200, status = null, user = {} } = {}) => {
  if (!pool) throw new Error('PostgreSQL não configurado.');
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 200, 500));
  const values = [];
  let index = 1;
  const conditions = [];

  if (status) {
    conditions.push(`n.status = $${index++}`);
    values.push(status);
  }

  const visibility = buildVisibilityPredicate(user, index, 'm');
  conditions.push(visibility.sql);
  values.push(...visibility.values);
  index += visibility.values.length;

  const result = await pool.query(
    `
    SELECT n.*, m.meeting_at, m.assessor, m.cliente, m.meeting_date, m.meeting_time, m.status AS meeting_status
    FROM ${NOTIFICATIONS_TABLE} n
    JOIN ${MEETINGS_TABLE} m ON m.id = n.meeting_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY n.scheduled_at ASC
    LIMIT $${index}
    `,
    [...values, boundedLimit]
  );

  return result.rows.map(mapNotificationRow);
};

export const processPendingNotifications = async ({ batchSize = 20 } = {}) => {
  if (!pool) return { processed: 0, sent: 0, failed: 0, skipped: 0 };

  const boundedBatch = Math.max(1, Math.min(Number(batchSize) || 20, 50));
  const result = await pool.query(
    `
    SELECT n.*, m.assessor, m.cliente, m.meeting_date, m.meeting_time, m.meeting_at, m.status AS meeting_status
    FROM ${NOTIFICATIONS_TABLE} n
    JOIN ${MEETINGS_TABLE} m ON m.id = n.meeting_id
    WHERE n.status = $2
      AND n.scheduled_at <= NOW()
      AND m.status = $3
    ORDER BY n.scheduled_at ASC
    LIMIT $1
    `,
    [boundedBatch, NOTIFICATION_STATUS.PENDING, MEETING_STATUS.SCHEDULED]
  );

  let sent = 0;
  let failed = 0;

  for (const row of result.rows) {
    if (row.meeting_status !== MEETING_STATUS.SCHEDULED) {
      await pool.query(
        `UPDATE ${NOTIFICATIONS_TABLE} SET status = $2, error_message = $3 WHERE id = $1`,
        [row.id, NOTIFICATION_STATUS.CANCELLED, 'Reunião cancelada ou encerrada.']
      );
      continue;
    }

    try {
      await sendEvolutionText(row.phone_number, row.message_body);
      await pool.query(
        `UPDATE ${NOTIFICATIONS_TABLE} SET status = $2, sent_at = NOW(), error_message = NULL WHERE id = $1`,
        [row.id, NOTIFICATION_STATUS.SENT]
      );
      sent += 1;
    } catch (error) {
      await pool.query(
        `UPDATE ${NOTIFICATIONS_TABLE} SET status = $2, error_message = $3 WHERE id = $1`,
        [row.id, NOTIFICATION_STATUS.FAILED, error?.message || String(error)]
      );
      failed += 1;
    }
  }

  return {
    processed: result.rows.length,
    sent,
    failed,
  };
};
