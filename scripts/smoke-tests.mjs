#!/usr/bin/env node
/**
 * Bateria de testes de fumaça (API + utilitários).
 * Uso: BASE_URL=http://127.0.0.1:3006 node scripts/smoke-tests.mjs
 */
import './../server/load-env.mjs';
import { normalizePhone } from '../server/assessor-db.mjs';
import {
  renderMessageTemplate,
  buildMessageTemplateVars,
} from '../src/utils/messageTemplates.js';

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

const request = async (path, options = {}) => {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { response, body, status: response.status };
};

async function testPhoneNormalization() {
  console.log('\n[Unit] Normalização de telefone');
  if (normalizePhone('11999998888') === '5511999998888') ok('DDD sem 55');
  else fail('DDD sem 55', normalizePhone('11999998888'));
  if (normalizePhone('5511987654321') === '5511987654321') ok('já com 55');
  else fail('já com 55');
  if (normalizePhone('') === '') ok('vazio');
  else fail('vazio');
  const short = normalizePhone('123');
  if (short.length < 12) ok('número curto normalizado (< 12 dígitos)');
  else fail('número curto', short);
}

async function testHealth() {
  console.log('\n[API] Health');
  const { status, body } = await request('/api/calendar/health');
  if (status === 200 && body.ok) ok('GET /api/calendar/health');
  else fail('GET /api/calendar/health', JSON.stringify(body));
}

async function testAuth() {
  console.log('\n[API] Autenticação');
  const bad = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'x', password: 'y' }),
  });
  if (bad.status === 401) ok('login inválido retorna 401');
  else fail('login inválido', `status ${bad.status}`);

  const good = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASS }),
  });
  if (good.status === 200 && good.body.token) ok('login válido retorna token');
  else fail('login válido', JSON.stringify(good.body));
  return good.body.token;
}

async function testAssessoresCrud(token) {
  console.log('\n[API] CRUD Assessores');
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const noAuth = await request('/api/assessores');
  if (noAuth.status === 401) ok('GET assessores sem token → 401');
  else fail('GET assessores sem token', `status ${noAuth.status}`);

  const unique = `Smoke Test ${Date.now()}`;
  const created = await request('/api/assessores', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: unique,
      phone: '11987654321',
      email: 'smoke@farol.test',
    }),
  });
  if (created.status === 201 && created.body.row?.id) ok('POST assessor');
  else fail('POST assessor', JSON.stringify(created.body));

  const id = created.body.row?.id;
  const list = await request('/api/assessores', { headers });
  const found = (list.body.rows || []).some((r) => r.name === unique);
  if (list.status === 200 && found) ok('GET lista contém assessor criado');
  else fail('GET lista', JSON.stringify(list.body).slice(0, 120));

  const updated = await request(`/api/assessores/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ name: `${unique} Editado`, phone: '11987654322' }),
  });
  if (updated.status === 200) ok('PUT assessor');
  else fail('PUT assessor', JSON.stringify(updated.body));

  const invalid = await request('/api/assessores', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'X', phone: '123' }),
  });
  if (invalid.status === 400) ok('POST telefone inválido → 400');
  else fail('POST telefone inválido', `status ${invalid.status}`);

  const deleted = await request(`/api/assessores/${id}`, { method: 'DELETE', headers });
  if (deleted.status === 200) ok('DELETE assessor (soft)');
  else fail('DELETE assessor', JSON.stringify(deleted.body));

  const listAfter = await request('/api/assessores', { headers });
  const stillVisible = (listAfter.body.rows || []).some((r) => String(r.id) === String(id));
  if (!stillVisible) ok('assessor removido não aparece na lista');
  else fail('assessor removido ainda na lista');
}

async function testMessageTemplateUtils() {
  console.log('\n[Unit] Templates de mensagem');
  const vars = buildMessageTemplateVars({
    assessor: 'João Silva',
    cliente: 'Maria Souza',
    whatsappAssessor: '+55 (11) 99999-8888',
    whatsappClienteFmt: '+55 (11) 98888-7777',
    dataFormatada: '10/06/2026',
    horarioTexto: '14:00',
  });
  const rendered = renderMessageTemplate(
    'Olá {{primeiro_nome_lead}} — {{nome_assessor}} em {{data_reuniao}} às {{horario_reuniao}}',
    vars
  );
  if (rendered.includes('Maria') && rendered.includes('João Silva') && rendered.includes('10/06/2026')) {
    ok('renderMessageTemplate substitui variáveis');
  } else {
    fail('renderMessageTemplate', rendered);
  }
}

async function testMessageTemplatesApi(token) {
  console.log('\n[API] Copys de mensagem');
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const noAuth = await request('/api/message-templates');
  if (noAuth.status === 401) ok('GET copys sem token → 401');
  else fail('GET copys sem token', `status ${noAuth.status}`);

  const get = await request('/api/message-templates', { headers });
  if (get.status === 200 && get.body.templates?.cliente && get.body.templates?.assessor) {
    ok('GET copys retorna cliente e assessor');
  } else {
    fail('GET copys', JSON.stringify(get.body).slice(0, 120));
    return;
  }

  const marker = `Smoke copy ${Date.now()}`;
  const put = await request('/api/message-templates', {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      cliente: `${marker} cliente {{assessor}}`,
      assessor: `${marker} assessor {{nome_lead}}`,
    }),
  });
  if (put.status === 200 && put.body.templates?.cliente?.includes(marker)) {
    ok('PUT copys (admin) persiste no servidor');
  } else {
    fail('PUT copys', JSON.stringify(put.body).slice(0, 120));
  }

  const getAfter = await request('/api/message-templates', { headers });
  if (getAfter.body.templates?.cliente?.includes(marker)) {
    ok('GET copys após PUT reflete alteração');
  } else {
    fail('GET copys após PUT', JSON.stringify(getAfter.body).slice(0, 120));
  }

  await request('/api/message-templates', {
    method: 'PUT',
    headers,
    body: JSON.stringify(get.body.templates),
  });
}

async function testOutlookRoute() {
  console.log('\n[API] Rotas Outlook (não confundir com /api/calendar)');
  const wrongPath = await request('/api/calendar/outlook/invite', { method: 'POST' });
  if (wrongPath.status === 404 || wrongPath.status === 405) {
    ok('/api/calendar/outlook/invite não existe (correto)');
  } else {
    fail('path errado deveria 404', `status ${wrongPath.status}`);
  }

  const rightPath = await request('/api/outlook/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (rightPath.status === 503 || rightPath.status === 502) {
    ok('/api/outlook/invite existe (Graph não configurado ou erro esperado)');
  } else if (rightPath.status === 400 || rightPath.status === 201) {
    ok('/api/outlook/invite roteado');
  } else {
    fail('/api/outlook/invite', `status ${rightPath.status}`);
  }
}

async function main() {
  console.log(`Smoke tests → ${BASE}`);
  await testPhoneNormalization();
  await testMessageTemplateUtils();
  await testHealth();
  const token = await testAuth();
  if (token) {
    await testAssessoresCrud(token);
    await testMessageTemplatesApi(token);
  }
  await testOutlookRoute();

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Passou: ${passed} | Falhou: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
