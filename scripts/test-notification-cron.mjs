#!/usr/bin/env node
/**
 * Bateria de testes: fuso Brasília, agendamento de follow-ups e cron.
 * Uso: node scripts/test-notification-cron.mjs
 *      BASE_URL=http://127.0.0.1:3006 node scripts/test-notification-cron.mjs
 */
import './../server/load-env.mjs';
import { pool } from '../server/db.mjs';
import {
  meetingAtFromBr,
  computeScheduledAt,
  offsetToMs,
  resolveRecipientPhone,
} from '../server/notification-schedule.mjs';
import { formatDateToBr, normalizeIsoDate } from '../server/date-format.mjs';
import { NOTIFICATION_STATUS } from '../server/schedule-constants.mjs';
import {
  cancelScheduledMeetingForUser,
  initScheduledMeetingStore,
  createScheduledMeetingWithNotifications,
  getScheduledMeetingById,
  listScheduledMeetings,
  processPendingNotifications,
  listScheduledNotifications,
} from '../server/scheduled-meetings-db.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3006';
const LOGIN = process.env.SMOKE_LOGIN || process.env.ADMIN_BOOTSTRAP_LOGIN || 'sdrfarol';
const PASS = process.env.SMOKE_PASS || process.env.ADMIN_BOOTSTRAP_PASSWORD || 'mudar123';

let passed = 0;
let failed = 0;

const ok = (name) => {
  passed += 1;
  console.log(`  ✓ ${name}`);
};

const fail = (name, detail) => {
  failed += 1;
  console.log(`  ✗ ${name}`);
  if (detail) console.log(`    → ${detail}`);
};

const assertEq = (actual, expected, name) => {
  if (actual === expected) ok(name);
  else fail(name, `esperado ${expected}, obteve ${actual}`);
};

const brParts = (date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
};

async function testTimezoneUnit() {
  console.log('\n[Unit] Fuso Brasília (America/Sao_Paulo, UTC-3)');

  const meeting = meetingAtFromBr('2026-06-15', '14:00');
  assertEq(meeting.toISOString(), '2026-06-15T17:00:00.000Z', '14:00 BRT → 17:00 UTC');

  const br = brParts(meeting);
  assertEq(br.date, '2026-06-15', 'data exibida em Brasília');
  assertEq(br.time, '14:00', 'horário exibido em Brasília');

  const oneDayBefore = computeScheduledAt(meeting, {
    offset_days: 1,
    offset_hours: 0,
    offset_minutes: 0,
    moment: 'before',
  });
  assertEq(oneDayBefore.toISOString(), '2026-06-14T17:00:00.000Z', '1 dia antes às 14:00 BRT');

  const oneHourBefore = computeScheduledAt(meeting, {
    offset_days: 0,
    offset_hours: 1,
    offset_minutes: 0,
    moment: 'before',
  });
  assertEq(oneHourBefore.toISOString(), '2026-06-15T16:00:00.000Z', '1 hora antes às 14:00 BRT');

  const after30m = computeScheduledAt(meeting, {
    offset_days: 0,
    offset_hours: 0,
    offset_minutes: 30,
    moment: 'after',
  });
  assertEq(after30m.toISOString(), '2026-06-15T17:30:00.000Z', '30 min depois da reunião');

  assertEq(
    offsetToMs({ offsetDays: 1, offsetHours: 1, offsetMinutes: 15 }),
    ((24 + 1) * 60 + 15) * 60 * 1000,
    'offsetToMs composto (1d + 1h + 15min)'
  );

  try {
    meetingAtFromBr('', '14:00');
    fail('data inválida deveria lançar erro');
  } catch {
    ok('data inválida lança erro');
  }
}

function testDateFormat() {
  console.log('\n[Unit] Formatação de datas');
  assertEq(normalizeIsoDate(new Date('2026-06-02T03:00:00.000Z')), '2026-06-02', 'Date → YYYY-MM-DD');
  assertEq(normalizeIsoDate('2026-06-02T03:00:00.000Z'), '2026-06-02', 'ISO → YYYY-MM-DD');
  assertEq(formatDateToBr('2026-06-02T03:00:00.000Z'), '02/06/2026', 'formatDateToBr com ISO completo');
}

async function testRecipientPhone() {
  console.log('\n[Unit] Destinatário do follow-up');
  const meeting = {
    phone_cliente: '5511999887766',
    phone_assessor: '5511988776655',
  };
  assertEq(
    resolveRecipientPhone({ recipient: 'cliente' }, meeting),
    '5511999887766',
    'cliente → phone_cliente'
  );
  assertEq(
    resolveRecipientPhone({ recipient: 'assessor' }, meeting),
    '5511988776655',
    'assessor → phone_assessor'
  );
  assertEq(
    resolveRecipientPhone({ recipient: 'terceiro', third_party_phone: '(11) 97777-6666' }, meeting),
    '11977776666',
    'terceiro → third_party_phone normalizado'
  );
}

async function testDbScheduling() {
  console.log('\n[DB] Agendamento + horários dos follow-ups');

  if (!pool) {
    fail('PostgreSQL não configurado — pule testes de integração');
    return null;
  }

  await initScheduledMeetingStore();

  const meetingDate = '2099-12-20';
  const meetingTime = '10:30';
  const meetingAt = meetingAtFromBr(meetingDate, meetingTime);

  const result = await createScheduledMeetingWithNotifications({
    assessor: 'Assessor Teste Cron',
    cliente: 'Lead Teste Cron',
    meetingDate,
    meetingTime,
    phoneCliente: '5511999001122',
    phoneAssessor: '5511988001122',
    source: 'test-notification-cron',
    createdBy: 'test-script',
  });

  const meetingId = result.meeting?.id;
  if (!meetingId) {
    fail('createScheduledMeetingWithNotifications retornou meeting.id');
    return null;
  }
  ok(`reunião criada (id=${meetingId})`);

  const pending = (result.notifications || []).filter((n) => n.status === 'pending');
  if (pending.length >= 2) ok(`gerou ${pending.length} follow-ups pendentes`);
  else fail('deveria gerar ao menos 2 follow-ups pendentes', JSON.stringify(result.notifications?.map((n) => n.status)));

  const clienteNotif = pending.find((n) => n.recipient === 'cliente');
  const assessorNotif = pending.find((n) => n.recipient === 'assessor');

  if (clienteNotif) {
    const expectedCliente = computeScheduledAt(meetingAt, {
      offset_days: 1,
      offset_hours: 0,
      offset_minutes: 0,
      moment: 'before',
    });
    if (new Date(clienteNotif.scheduledAt).toISOString() === expectedCliente.toISOString()) {
      ok('follow-up cliente: 1 dia antes em horário de Brasília');
    } else {
      fail(
        'follow-up cliente horário',
        `esperado ${expectedCliente.toISOString()}, obteve ${new Date(clienteNotif.scheduledAt).toISOString()}`
      );
    }
  } else {
    fail('follow-up cliente não encontrado');
  }

  if (assessorNotif) {
    const expectedAssessor = computeScheduledAt(meetingAt, {
      offset_days: 0,
      offset_hours: 1,
      offset_minutes: 0,
      moment: 'before',
    });
    if (new Date(assessorNotif.scheduledAt).toISOString() === expectedAssessor.toISOString()) {
      ok('follow-up assessor: 1h antes em horário de Brasília');
    } else {
      fail(
        'follow-up assessor horário',
        `esperado ${expectedAssessor.toISOString()}, obteve ${new Date(assessorNotif.scheduledAt).toISOString()}`
      );
    }
  } else {
    fail('follow-up assessor não encontrado');
  }

  return meetingId;
}

async function testDbCancel(meetingId) {
  console.log('\n[DB] Cancelamento determinístico');

  if (!pool || !meetingId) {
    fail('sem meetingId para teste de cancelamento');
    return;
  }

  const forbidden = await cancelScheduledMeetingForUser(meetingId, {
    role: 'user',
    login: 'outro-usuario',
    sub: 999,
  });
  if (!forbidden.ok && forbidden.code === 'FORBIDDEN') ok('usuário sem permissão recebe FORBIDDEN');
  else fail('cancelamento sem permissão', JSON.stringify(forbidden));

  const allowed = await cancelScheduledMeetingForUser(meetingId, {
    role: 'user',
    login: 'test-script',
    sub: 1,
  });
  if (allowed.ok && allowed.meeting?.status === 'cancelled') ok('criador cancela reunião');
  else fail('cancelamento pelo criador', JSON.stringify(allowed));

  const meeting = await getScheduledMeetingById(meetingId);
  if (meeting?.status === 'cancelled') ok('reunião permanece cancelada no banco');
  else fail('status da reunião após cancelamento', JSON.stringify(meeting));

  const notifs = await listScheduledNotifications({ limit: 20 });
  const related = notifs.filter((row) => row.meetingId === meetingId);
  const pendingLeft = related.filter((row) => row.status === NOTIFICATION_STATUS.PENDING);
  if (pendingLeft.length === 0) ok('nenhum follow-up pendente após cancelamento');
  else fail('follow-ups pendentes após cancelamento', JSON.stringify(pendingLeft.map((row) => row.status)));

  const again = await cancelScheduledMeetingForUser(meetingId, { role: 'admin', login: 'admin', sub: 1 });
  if (!again.ok && again.code === 'ALREADY_CANCELLED') ok('segundo cancelamento retorna ALREADY_CANCELLED');
  else fail('idempotência do cancelamento', JSON.stringify(again));
}

async function testVisibilityByUser() {
  console.log('\n[DB] Visibilidade por perfil');

  if (!pool) {
    fail('PostgreSQL não configurado — pule teste de visibilidade');
    return;
  }

  const createdIds = [];
  const suffix = Date.now();

  try {
    const createdA = await createScheduledMeetingWithNotifications({
      assessor: 'Assessor Visibilidade A',
      cliente: `Lead Visibilidade A ${suffix}`,
      meetingDate: '2099-12-21',
      meetingTime: '09:00',
      phoneCliente: '5511999002211',
      phoneAssessor: '5511988002211',
      source: 'test-visibility',
      createdBy: 'sdr-a',
      createdByUserId: 101,
    });
    createdIds.push(createdA.meeting.id);

    const createdB = await createScheduledMeetingWithNotifications({
      assessor: 'Assessor Visibilidade B',
      cliente: `Lead Visibilidade B ${suffix}`,
      meetingDate: '2099-12-21',
      meetingTime: '10:00',
      phoneCliente: '5511999003311',
      phoneAssessor: '5511988003311',
      source: 'test-visibility',
      createdBy: 'sdr-b',
      createdByUserId: 202,
    });
    createdIds.push(createdB.meeting.id);

    const rowsUserA = await listScheduledMeetings({
      limit: 50,
      status: null,
      user: { role: 'user', login: 'sdr-a', sub: 101 },
    });
    const idsUserA = rowsUserA.map((item) => item.id);
    if (idsUserA.includes(createdA.meeting.id) && !idsUserA.includes(createdB.meeting.id)) {
      ok('SDR vê apenas as próprias reuniões');
    } else {
      fail('filtro de reuniões por SDR', JSON.stringify(idsUserA));
    }

    const notifUserA = await listScheduledNotifications({
      limit: 100,
      user: { role: 'user', login: 'sdr-a', sub: 101 },
    });
    const meetingIdsUserA = [...new Set(notifUserA.map((item) => item.meetingId))];
    if (meetingIdsUserA.includes(createdA.meeting.id) && !meetingIdsUserA.includes(createdB.meeting.id)) {
      ok('SDR vê apenas os próprios follow-ups');
    } else {
      fail('filtro de follow-ups por SDR', JSON.stringify(meetingIdsUserA));
    }

    const rowsAdmin = await listScheduledMeetings({
      limit: 50,
      status: null,
      user: { role: 'admin', login: 'admin', sub: 1 },
    });
    const idsAdmin = rowsAdmin.map((item) => item.id);
    if (idsAdmin.includes(createdA.meeting.id) && idsAdmin.includes(createdB.meeting.id)) {
      ok('admin vê reuniões de todos os SDRs');
    } else {
      fail('filtro de reuniões para admin', JSON.stringify(idsAdmin));
    }
  } finally {
    for (const id of createdIds) {
      await cleanupTestMeeting(id);
    }
  }
}

async function testCronDryRun(meetingId) {
  console.log('\n[DB] Cron processPendingNotifications (dry-run)');

  if (!pool || !meetingId) {
    fail('sem meetingId para teste de cron');
    return;
  }

  const insert = await pool.query(
    `
    INSERT INTO scheduled_notifications
      (meeting_id, template_id, title, recipient, phone_number, message_body, scheduled_at, status)
    VALUES ($1, NULL, $2, 'cliente', $3, $4, NOW() - INTERVAL '2 minutes', 'pending')
    RETURNING id
    `,
    [meetingId, 'Teste cron dry-run', '5511999001122', 'Mensagem de teste cron — ignorar']
  );
  const notifId = insert.rows[0]?.id;
  if (!notifId) {
    fail('não inseriu notificação de teste');
    return;
  }

  const prevDry = process.env.EVOLUTION_DRY_RUN;
  process.env.EVOLUTION_DRY_RUN = '1';

  try {
    const result = await processPendingNotifications({ batchSize: 5 });
    if (result.processed >= 1 && result.sent >= 1) {
      ok(`cron processou e marcou enviado (processed=${result.processed}, sent=${result.sent})`);
    } else {
      fail('cron deveria enviar notificação vencida', JSON.stringify(result));
    }

    const row = await pool.query(`SELECT status, sent_at FROM scheduled_notifications WHERE id = $1`, [notifId]);
    if (row.rows[0]?.status === 'sent' && row.rows[0]?.sent_at) {
      ok('notificação marcada como sent no banco');
    } else {
      fail('status após cron', JSON.stringify(row.rows[0]));
    }
  } finally {
    if (prevDry === undefined) delete process.env.EVOLUTION_DRY_RUN;
    else process.env.EVOLUTION_DRY_RUN = prevDry;
  }
}

async function cleanupTestMeeting(meetingId) {
  if (!pool || !meetingId) return;
  await pool.query(`DELETE FROM scheduled_meetings WHERE id = $1`, [meetingId]);
}

async function testCronScript() {
  console.log('\n[Script] run-notification-cron.mjs');

  const prevDry = process.env.EVOLUTION_DRY_RUN;
  process.env.EVOLUTION_DRY_RUN = '1';

  try {
    const { spawnSync } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const run = spawnSync('node', ['scripts/run-notification-cron.mjs'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, EVOLUTION_DRY_RUN: '1' },
    });
    if (run.status === 0) ok('run-notification-cron.mjs executa sem erro');
    else fail('run-notification-cron.mjs', run.stderr || run.stdout || `exit ${run.status}`);
  } finally {
    if (prevDry === undefined) delete process.env.EVOLUTION_DRY_RUN;
    else process.env.EVOLUTION_DRY_RUN = prevDry;
  }
}

async function testNotificationApis(token) {
  console.log('\n[API] Rotas de follow-ups');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const templates = await fetch(`${BASE}/api/notification-templates`, { headers });
  const templatesBody = await templates.json();
  if (templates.status === 200 && Array.isArray(templatesBody.rows) && templatesBody.rows.length >= 1) {
    ok('GET /api/notification-templates');
  } else {
    fail('GET /api/notification-templates', JSON.stringify(templatesBody).slice(0, 120));
  }

  const meetings = await fetch(`${BASE}/api/scheduled-meetings?limit=5`, { headers });
  const meetingsBody = await meetings.json();
  if (meetings.status === 200 && Array.isArray(meetingsBody.rows)) {
    ok('GET /api/scheduled-meetings');
  } else {
    fail('GET /api/scheduled-meetings', JSON.stringify(meetingsBody).slice(0, 120));
  }

  const notifs = await fetch(`${BASE}/api/scheduled-notifications?limit=5`, { headers });
  const notifsBody = await notifs.json();
  if (notifs.status === 200 && Array.isArray(notifsBody.rows)) {
    ok('GET /api/scheduled-notifications');
  } else {
    fail('GET /api/scheduled-notifications', JSON.stringify(notifsBody).slice(0, 120));
  }

  const noAuth = await fetch(`${BASE}/api/scheduled-notifications`);
  if (noAuth.status === 401) ok('GET scheduled-notifications sem token → 401');
  else fail('auth em scheduled-notifications', `status ${noAuth.status}`);
}

async function login() {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASS }),
  });
  const body = await response.json();
  return body.token || null;
}

async function main() {
  console.log(`Testes de cron e fuso → ${BASE}`);
  process.env.EVOLUTION_DRY_RUN = '1';

  await testTimezoneUnit();
  testDateFormat();
  await testRecipientPhone();

  let meetingId = null;
  try {
    meetingId = await testDbScheduling();
    await testCronDryRun(meetingId);
    await testDbCancel(meetingId);
    await testVisibilityByUser();
    await testCronScript();
  } finally {
    await cleanupTestMeeting(meetingId);
    if (pool) await pool.end();
  }

  const token = await login();
  if (token) await testNotificationApis(token);
  else fail('login para testes de API');

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Passou: ${passed} | Falhou: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
