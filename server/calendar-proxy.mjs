import './load-env.mjs';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createOutlookEvent, isOutlookGraphConfigured } from './outlook-graph.mjs';
import {
  initActionLogStore,
  insertActionLog,
  listRecentActionLogs,
} from './action-log-db.mjs';
import { isPostgresConfigured } from './db.mjs';
import {
  createUser,
  deleteUser,
  ensureBootstrapAdmin,
  findUserByLogin,
  initUserStore,
  listUsers,
  updateUser,
} from './user-db.mjs';
import {
  createAssessor,
  deleteAssessor,
  initAssessorStore,
  listAssessores,
  updateAssessor,
} from './assessor-db.mjs';
import {
  getMessageTemplates,
  initMessageTemplateStore,
  updateMessageTemplates,
} from './message-templates-db.mjs';
import {
  createNotificationTemplate,
  deleteNotificationTemplate,
  initNotificationTemplateStore,
  listNotificationTemplates,
  updateNotificationTemplate,
} from './notification-templates-db.mjs';
import {
  cancelScheduledMeetingForUser,
  createScheduledMeetingWithNotifications,
  initScheduledMeetingStore,
  listScheduledMeetings,
  listScheduledNotifications,
  processPendingNotifications,
  rescheduleScheduledMeetingForUser,
} from './scheduled-meetings-db.mjs';
import {
  createCalendarEvents,
  deleteCalendarEvents,
  rescheduleCalendarEvents,
  rollbackCreatedCalendarEvents,
} from './calendar-events-service.mjs';
import { MEETING_STATUS } from './schedule-constants.mjs';
import { normalizeLogin, withMeetingPermissions } from './schedule-auth.mjs';
import { sendEvolutionText, isEvolutionConfigured } from './evolution-send.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3006);
const API_BASE = (process.env.CALENDAR_API_BASE_URL || 'https://xltw-api6-8lww.b2.xano.io/api:5ONttZdQ').replace(/\/$/, '');
const API_TOKEN = process.env.CALENDAR_API_TOKEN || '';
const EVOLUTION_API_BASE = (process.env.EVOLUTION_API_BASE_URL || 'http://135.181.144.117:8091').replace(/\/$/, '');
const EVOLUTION_API_KEY = process.env.TOKENEVOLUTION || '';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'farol-chatwoot';
const OUTLOOK_ENABLED =
  process.env.MS_GRAPH_ENABLED !== 'false' && isOutlookGraphConfigured();
const JWT_SECRET = process.env.JWT_SECRET || '';
const NOTIFICATION_CRON_MS = Math.max(15_000, Number(process.env.NOTIFICATION_CRON_MS || 60_000));

const app = express();
app.use(express.json({ limit: '1mb' }));

const signToken = (user) =>
  jwt.sign(
    {
      sub: user.id,
      login: user.login,
      role: user.role,
      name: user.name,
    },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );

const authRequired = (req, res, next) => {
  if (!JWT_SECRET) {
    return res.status(503).json({ error: 'JWT_SECRET não configurado no servidor.' });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Token ausente.' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
};

const adminRequired = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso permitido apenas para admin.' });
  }
  return next();
};

const forward = async (req, res, method, targetPath, body) => {
  if (!API_TOKEN) {
    return res.status(503).json({
      error: 'CALENDAR_API_TOKEN não configurado no servidor.',
    });
  }

  const url = new URL(`${API_BASE}${targetPath}`);
  for (const [key, value] of Object.entries(req.query || {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    let payload = text;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    return res.status(response.status).json(payload);
  } catch (error) {
    return res.status(502).json({
      error: 'Falha ao comunicar com a API de calendário.',
      detail: error?.message || String(error),
    });
  }
};

app.get('/api/calendar/health', (_req, res) => {
  res.json({
    ok: true,
    hasToken: Boolean(API_TOKEN),
    apiBase: API_BASE,
    outlookGraph: OUTLOOK_ENABLED,
    postgresLogs: isPostgresConfigured(),
    jwtConfigured: Boolean(JWT_SECRET),
    evolution: {
      baseUrl: EVOLUTION_API_BASE,
      instance: EVOLUTION_INSTANCE,
      configured: Boolean(EVOLUTION_API_KEY),
    },
  });
});

app.post('/api/auth/login', async (req, res) => {
  if (!isPostgresConfigured()) {
    return res.status(503).json({ error: 'PostgreSQL não configurado no servidor.' });
  }
  if (!JWT_SECRET) {
    return res.status(503).json({ error: 'JWT_SECRET não configurado no servidor.' });
  }

  const login = String(req.body?.login || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!login || !password) {
    return res.status(400).json({ error: 'Login e senha são obrigatórios.' });
  }

  const user = await findUserByLogin(login);
  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'Credenciais inválidas.' });
  }

  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) {
    return res.status(401).json({ error: 'Credenciais inválidas.' });
  }

  const token = signToken(user);
  return res.json({
    ok: true,
    token,
    user: { id: user.id, login: user.login, name: user.name, role: user.role },
  });
});

app.get('/api/auth/me', authRequired, async (req, res) => {
  const user = await findUserByLogin(req.user?.login);
  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'Usuário inválido.' });
  }

  return res.json({
    ok: true,
    user: { id: user.id, login: user.login, name: user.name, role: user.role },
  });
});

/** Convite nativo Outlook/Teams (Microsoft Graph) */
app.post('/api/outlook/invite', async (req, res) => {
  if (!OUTLOOK_ENABLED) {
    return res.status(503).json({
      error: 'Microsoft Graph não configurado. Defina MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID e MS_GRAPH_CLIENT_SECRET no servidor.',
      setup: 'https://learn.microsoft.com/en-us/graph/auth-v2-service',
    });
  }

  try {
    const event = await createOutlookEvent(req.body || {});
    return res.status(201).json(event);
  } catch (error) {
    return res.status(502).json({
      error: error?.message || 'Falha ao criar evento no Outlook',
    });
  }
});

app.get('/api/calendar/list', (req, res) => forward(req, res, 'GET', '/calendar'));
app.get('/api/calendar/events', (req, res) => forward(req, res, 'GET', '/calendar/events'));
app.get('/api/calendar/available-slots', (req, res) => forward(req, res, 'GET', '/calendar/avaibleTimeSlots'));
app.post('/api/calendar/events', (req, res) => forward(req, res, 'POST', '/calendar/events', req.body));
app.delete('/api/calendar/events', (req, res) => forward(req, res, 'DELETE', '/calendar/events', req.body));

app.post('/api/actions/log', async (req, res) => {
  try {
    const row = await insertActionLog(req.body || {});
    return res.status(201).json({ ok: true, id: row.id, createdAt: row.created_at });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error?.message || 'Falha ao salvar log de ação no PostgreSQL.',
    });
  }
});

app.get('/api/actions/logs', async (req, res) => {
  try {
    const rows = await listRecentActionLogs(req.query.limit);
    return res.json({ ok: true, count: rows.length, rows });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error?.message || 'Falha ao consultar logs no PostgreSQL.',
    });
  }
});

app.get('/api/users', authRequired, adminRequired, async (_req, res) => {
  try {
    const rows = await listUsers();
    return res.json({ ok: true, rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || 'Erro ao listar usuários.' });
  }
});

app.post('/api/users', authRequired, adminRequired, async (req, res) => {
  try {
    const row = await createUser(req.body || {});
    return res.status(201).json({ ok: true, row });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error?.message || 'Erro ao criar usuário.' });
  }
});

app.put('/api/users/:id', authRequired, adminRequired, async (req, res) => {
  try {
    const row = await updateUser(req.params.id, req.body || {});
    if (!row) return res.status(404).json({ ok: false, error: 'Usuário não encontrado.' });
    return res.json({ ok: true, row });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error?.message || 'Erro ao atualizar usuário.' });
  }
});

app.delete('/api/users/:id', authRequired, adminRequired, async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (req.user?.sub === targetId) {
      return res.status(400).json({ ok: false, error: 'Você não pode remover seu próprio usuário.' });
    }
    const row = await deleteUser(targetId);
    if (!row) return res.status(404).json({ ok: false, error: 'Usuário não encontrado.' });
    return res.json({ ok: true, id: row.id });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error?.message || 'Erro ao remover usuário.' });
  }
});

app.get('/api/assessores', authRequired, async (_req, res) => {
  if (!isPostgresConfigured()) {
    return res.status(503).json({ ok: false, error: 'PostgreSQL não configurado no servidor.' });
  }
  try {
    const rows = await listAssessores();
    return res.json({ ok: true, rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || 'Erro ao listar assessores.' });
  }
});

app.post('/api/assessores', authRequired, async (req, res) => {
  if (!isPostgresConfigured()) {
    return res.status(503).json({ ok: false, error: 'PostgreSQL não configurado no servidor.' });
  }
  try {
    const row = await createAssessor(req.body || {});
    return res.status(201).json({ ok: true, row });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error?.message || 'Erro ao criar assessor.' });
  }
});

app.put('/api/assessores/:id', authRequired, async (req, res) => {
  if (!isPostgresConfigured()) {
    return res.status(503).json({ ok: false, error: 'PostgreSQL não configurado no servidor.' });
  }
  try {
    const row = await updateAssessor(req.params.id, req.body || {});
    if (!row) return res.status(404).json({ ok: false, error: 'Assessor não encontrado.' });
    return res.json({ ok: true, row });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error?.message || 'Erro ao atualizar assessor.' });
  }
});

app.get('/api/message-templates', authRequired, async (_req, res) => {
  if (!isPostgresConfigured()) {
    return res.status(503).json({ error: 'PostgreSQL não configurado no servidor.' });
  }
  try {
    const templates = await getMessageTemplates();
    return res.json({ ok: true, templates });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Erro ao carregar copys.' });
  }
});

app.put('/api/message-templates', authRequired, adminRequired, async (req, res) => {
  if (!isPostgresConfigured()) {
    return res.status(503).json({ error: 'PostgreSQL não configurado no servidor.' });
  }
  try {
    const templates = await updateMessageTemplates({
      cliente: req.body?.cliente,
      assessor: req.body?.assessor,
    });
    return res.json({ ok: true, templates });
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'Erro ao salvar copys.' });
  }
});

app.post('/api/message/send', authRequired, async (req, res) => {
  if (!isEvolutionConfigured()) {
    return res.status(503).json({ error: 'TOKENEVOLUTION não configurado no servidor.' });
  }

  const body = req.body || {};
  const text = String(body.textContent ?? '').trim();
  const number = String(body.phoneNumber || '').replace(/\D/g, '');

  if (!text || !number) {
    return res.status(400).json({ error: 'textContent e phoneNumber são obrigatórios.' });
  }

  try {
    const data = await sendEvolutionText(number, text);
    return res.status(200).json(data);
  } catch (error) {
    return res.status(error?.status || 502).json({
      error: error?.message || 'Falha ao enviar mensagem via Evolution.',
      detail: error?.detail || null,
    });
  }
});

app.get('/api/notification-templates', authRequired, async (_req, res) => {
  if (!isPostgresConfigured()) {
    return res.status(503).json({ error: 'PostgreSQL não configurado no servidor.' });
  }
  try {
    const rows = await listNotificationTemplates();
    return res.json({ ok: true, rows });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Erro ao listar notificações.' });
  }
});

app.post('/api/notification-templates', authRequired, adminRequired, async (req, res) => {
  if (!isPostgresConfigured()) {
    return res.status(503).json({ error: 'PostgreSQL não configurado no servidor.' });
  }
  try {
    const row = await createNotificationTemplate(req.body || {});
    return res.status(201).json({ ok: true, row });
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'Erro ao criar notificação.' });
  }
});

app.put('/api/notification-templates/:id', authRequired, adminRequired, async (req, res) => {
  if (!isPostgresConfigured()) {
    return res.status(503).json({ error: 'PostgreSQL não configurado no servidor.' });
  }
  try {
    const row = await updateNotificationTemplate(req.params.id, req.body || {});
    if (!row) return res.status(404).json({ error: 'Notificação não encontrada.' });
    return res.json({ ok: true, row });
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'Erro ao atualizar notificação.' });
  }
});

app.delete('/api/notification-templates/:id', authRequired, adminRequired, async (req, res) => {
  if (!isPostgresConfigured()) {
    return res.status(503).json({ error: 'PostgreSQL não configurado no servidor.' });
  }
  try {
    const row = await deleteNotificationTemplate(req.params.id);
    if (!row) return res.status(404).json({ error: 'Notificação não encontrada.' });
    return res.json({ ok: true, id: row.id });
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'Erro ao remover notificação.' });
  }
});

app.get('/api/scheduled-meetings', authRequired, async (req, res) => {
  if (!isPostgresConfigured()) {
    return res.status(503).json({ error: 'PostgreSQL não configurado no servidor.' });
  }
  try {
    const meetingStatus =
      req.query.status === 'all' ? null : (req.query.status || MEETING_STATUS.SCHEDULED);
    const rows = await listScheduledMeetings({
      limit: req.query.limit,
      status: meetingStatus,
      user: req.user,
    });
    return res.json({
      ok: true,
      rows: rows.map((row) => withMeetingPermissions(row, req.user)),
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Erro ao listar reuniões.' });
  }
});

app.get('/api/scheduled-notifications', authRequired, async (req, res) => {
  if (!isPostgresConfigured()) {
    return res.status(503).json({ error: 'PostgreSQL não configurado no servidor.' });
  }
  try {
    const rows = await listScheduledNotifications({
      limit: req.query.limit,
      status: req.query.status || null,
      user: req.user,
    });
    return res.json({ ok: true, rows });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Erro ao listar follow-ups.' });
  }
});

app.post('/api/scheduled-meetings', authRequired, async (req, res) => {
  if (!isPostgresConfigured()) {
    return res.status(503).json({ error: 'PostgreSQL não configurado no servidor.' });
  }
  let externalEvents = [];
  try {
    const { calendarPlan = [], ...body } = req.body || {};
    externalEvents = await createCalendarEvents(calendarPlan, body.meetingDate, body.meetingTime);
    const payload = await createScheduledMeetingWithNotifications({
      ...body,
      externalEvents,
      createdBy: normalizeLogin(req.user?.login),
      createdByUserId: req.user?.sub ?? null,
    });
    return res.status(201).json({ ok: true, ...payload });
  } catch (error) {
    if (externalEvents.length) {
      await rollbackCreatedCalendarEvents(externalEvents);
    }
    return res.status(400).json({ error: error?.message || 'Erro ao salvar agendamento.' });
  }
});

const MEETING_ACTION_HTTP_STATUS = {
  NOT_FOUND: 404,
  ALREADY_CANCELLED: 400,
  NOT_CANCELLABLE: 400,
  NOT_RESCHEDULABLE: 400,
  INVALID: 400,
  FORBIDDEN: 403,
  CONFLICT: 409,
};

app.post('/api/scheduled-meetings/:id/cancel', authRequired, async (req, res) => {
  if (!isPostgresConfigured()) {
    return res.status(503).json({ error: 'PostgreSQL não configurado no servidor.' });
  }

  try {
    const result = await cancelScheduledMeetingForUser(req.params.id, req.user, {
      beforeCommit: async (meeting) => {
        await deleteCalendarEvents(meeting.externalEvents);
      },
    });
    if (!result.ok) {
      const status = MEETING_ACTION_HTTP_STATUS[result.code] || 500;
      return res.status(status).json({ error: result.error });
    }

    return res.json({
      ok: true,
      meeting: withMeetingPermissions({ ...result.meeting, canCancel: false, canReschedule: false }, req.user),
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Erro ao cancelar reunião.' });
  }
});

app.patch('/api/scheduled-meetings/:id', authRequired, async (req, res) => {
  if (!isPostgresConfigured()) {
    return res.status(503).json({ error: 'PostgreSQL não configurado no servidor.' });
  }

  try {
    const result = await rescheduleScheduledMeetingForUser(req.params.id, req.body || {}, req.user, {
      beforeCommit: async (meeting, nextSchedule) => ({
        externalEvents: await rescheduleCalendarEvents(
          meeting.externalEvents,
          nextSchedule.meetingDate,
          nextSchedule.meetingTime
        ),
      }),
    });
    if (!result.ok) {
      const status = MEETING_ACTION_HTTP_STATUS[result.code] || 500;
      return res.status(status).json({ error: result.error });
    }

    return res.json({
      ok: true,
      meeting: withMeetingPermissions(result.meeting, req.user),
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Erro ao remarcar reunião.' });
  }
});

app.delete('/api/assessores/:id', authRequired, async (req, res) => {
  if (!isPostgresConfigured()) {
    return res.status(503).json({ ok: false, error: 'PostgreSQL não configurado no servidor.' });
  }
  try {
    const row = await deleteAssessor(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Assessor não encontrado.' });
    return res.json({ ok: true, id: row.id });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error?.message || 'Erro ao remover assessor.' });
  }
});

const distPath = path.resolve(__dirname, '../dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const startNotificationCron = () => {
  if (!isPostgresConfigured() || !isEvolutionConfigured()) return;

  const tick = async () => {
    try {
      const result = await processPendingNotifications();
      if (result.sent || result.failed) {
        console.log(
          `[notification-cron] processados=${result.processed} enviados=${result.sent} falhas=${result.failed}`
        );
      }
    } catch (error) {
      console.error('[notification-cron] erro:', error?.message || error);
    }
  };

  tick();
  setInterval(tick, NOTIFICATION_CRON_MS);
  console.log(`[notification-cron] ativo a cada ${NOTIFICATION_CRON_MS}ms`);
};

Promise.allSettled([
  initActionLogStore(),
  initUserStore(),
  initAssessorStore(),
  initMessageTemplateStore(),
  initNotificationTemplateStore(),
  initScheduledMeetingStore(),
])
  .then(async ([logsInit, usersInit, assessorsInit, templatesInit, notificationTemplatesInit, scheduledInit]) => {
    if (logsInit.status === 'fulfilled' && logsInit.value) {
      console.log('[calendar-proxy] PostgreSQL de auditoria inicializado.');
    } else {
      console.log('[calendar-proxy] PostgreSQL não configurado. Logs de ação desativados.');
    }

    if (usersInit.status === 'fulfilled' && usersInit.value) {
      const bootstrapped = await ensureBootstrapAdmin();
      if (bootstrapped) {
        console.log('[calendar-proxy] Usuário admin bootstrap criado via variáveis ADMIN_BOOTSTRAP_*.');
      }
    }

    if (assessorsInit.status === 'fulfilled' && assessorsInit.value) {
      console.log('[calendar-proxy] Tabela de assessores inicializada.');
    }

    if (templatesInit.status === 'fulfilled' && templatesInit.value) {
      console.log('[calendar-proxy] Copys de mensagem inicializadas.');
    }

    if (notificationTemplatesInit.status === 'fulfilled' && notificationTemplatesInit.value) {
      console.log('[calendar-proxy] Cadência de notificações inicializada.');
    }

    if (scheduledInit.status === 'fulfilled' && scheduledInit.value) {
      console.log('[calendar-proxy] Agendamentos e follow-ups inicializados.');
    }
  })
  .catch((error) => {
    console.error('[calendar-proxy] Falha ao inicializar auditoria PostgreSQL:', error?.message || error);
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`[calendar-proxy] http://0.0.0.0:${PORT} (evolution: ${EVOLUTION_API_BASE}/${EVOLUTION_INSTANCE})`);
      startNotificationCron();
    });
  });
