#!/usr/bin/env node
/**
 * Descobre calendários na API e gera src/data/calendar-map.json
 * Uso: CALENDAR_API_TOKEN=... node scripts/discover-calendars.mjs
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

const API_BASE = (process.env.CALENDAR_API_BASE_URL || 'https://xltw-api6-8lww.b2.xano.io/api:5ONttZdQ').replace(/\/$/, '');
const TOKEN = process.env.CALENDAR_API_TOKEN || '';
const SHEET_URL = process.env.VITE_SHEET_ASSESSORES_LINK || '';
const TECHFALA_HINT = (process.env.CALENDAR_TECHFALA_TITLE_HINT || 'techfala').toLowerCase();

const normalize = (value = '') =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

const parseCsv = (text = '') => {
  const rows = [];
  let current = '';
  let row = [];
  let insideQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];
    if (char === '"' && insideQuotes && nextChar === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }
    if (char === ',' && !insideQuotes) {
      row.push(current.trim());
      current = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') i += 1;
      row.push(current.trim());
      current = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      continue;
    }
    current += char;
  }
  if (current || row.length) {
    row.push(current.trim());
    if (row.some((cell) => cell !== '')) rows.push(row);
  }
  return rows;
};

const normalizeSheetCsvUrl = (url = '') => {
  if (!url) return '';
  if (url.includes('tqx=out:csv')) return url;
  const match = url.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match?.[1]) return url;
  const gidMatch = url.match(/[?&]gid=(\d+)/);
  const gid = gidMatch?.[1] || '0';
  return `https://docs.google.com/spreadsheets/d/${match[1]}/gviz/tq?tqx=out:csv&gid=${gid}`;
};

async function fetchAllCalendars() {
  const calendars = [];
  let page = 1;
  let pageTotal = 1;

  while (page <= pageTotal) {
    const url = `${API_BASE}/calendar?page=${page}&perPage=100`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GET /calendar falhou (${res.status}): ${body}`);
    }
    const data = await res.json();
    calendars.push(...(data.items || []));
    pageTotal = data.pageTotal || 1;
    page += 1;
  }

  return calendars;
}

async function fetchAssessoresFromSheet() {
  const csvUrl = normalizeSheetCsvUrl(SHEET_URL);
  if (!csvUrl) return [];

  const res = await fetch(csvUrl);
  if (!res.ok) throw new Error(`Falha ao baixar planilha de assessores (${res.status})`);
  const text = await res.text();
  const rows = parseCsv(text);
  if (!rows.length) return [];

  const headers = rows[0];
  const nomeIdx = headers.findIndex((h) => /nome completo/i.test(h));
  const sistemaIdx = headers.findIndex((h) => /nome no sistema/i.test(h));
  const emailIdx = headers.findIndex((h) => /email/i.test(h));

  return rows.slice(1).map((row) => ({
    nomeCompleto: (row[nomeIdx >= 0 ? nomeIdx : 0] || '').trim(),
    nomeSistema: (row[sistemaIdx >= 0 ? sistemaIdx : 1] || '').trim(),
    email: (row[emailIdx >= 0 ? emailIdx : 2] || '').trim(),
  })).filter((a) => a.nomeCompleto);
}

const calendarNamePart = (title = '') => String(title).split(' - ')[0].trim();

const nameTokens = (value = '') =>
  value
    .split(/\s+/)
    .map((p) => normalize(p))
    .filter((p) => p.length > 2 && !['dos', 'das', 'de', 'da', 'do'].includes(p));

const emailTokens = (email = '') => {
  const local = String(email).split('@')[0] || '';
  return local.split(/[._-]+/).map(normalize).filter((t) => t.length > 2);
};

function scoreMatch(assessor, calendarTitle) {
  const calPart = calendarNamePart(calendarTitle);
  const calNorm = normalize(calPart);
  const calTokens = nameTokens(calPart);
  if (!calNorm) return 0;

  let best = 0;
  const candidates = [assessor.nomeCompleto, assessor.nomeSistema].filter(Boolean);

  for (const candidate of candidates) {
    const candNorm = normalize(candidate);
    if (candNorm === calNorm) best = Math.max(best, 100);

    const candTokens = nameTokens(candidate);
    const surnameHits = candTokens.filter((t) => calTokens.includes(t)).length;
    const firstName = candTokens[0];
    const firstHit = firstName && calTokens.includes(firstName);

    if (surnameHits >= 2) best = Math.max(best, 95);
    else if (surnameHits === 1 && firstHit) best = Math.max(best, 85);
    else if (surnameHits === 1) best = Math.max(best, 70);
    else if (firstHit && candidate === assessor.nomeSistema && assessor.nomeSistema.length > 2) {
      best = Math.max(best, 75);
    }
  }

  const mailTokens = emailTokens(assessor.email);
  const mailHits = mailTokens.filter((t) => calTokens.includes(t)).length;
  if (mailHits >= 2) best = Math.max(best, 90);
  else if (mailHits === 1 && best < 70) best = Math.max(best, 55);

  return best;
}

function loadOverrides() {
  const path = new URL('./calendar-overrides.json', import.meta.url);
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return { assessores: {}, techfalaCalendarId: null };
  }
}

async function main() {
  if (!TOKEN) {
    console.error('Defina CALENDAR_API_TOKEN antes de executar.');
    process.exit(1);
  }

  const [calendars, assessores] = await Promise.all([
    fetchAllCalendars(),
    fetchAssessoresFromSheet(),
  ]);

  const overrides = loadOverrides();
  const techfalaFromEnv = process.env.CALENDAR_TECHFALA_ID
    ? Number(process.env.CALENDAR_TECHFALA_ID)
    : null;

  const techfalaCalendar =
    (techfalaFromEnv && calendars.find((c) => c.id === techfalaFromEnv)) ||
    (overrides.techfalaCalendarId &&
      calendars.find((c) => c.id === overrides.techfalaCalendarId)) ||
    calendars.find((c) =>
      normalize(c?.informations?.title || '').includes(normalize(TECHFALA_HINT))
    );

  const pairs = [];
  for (const assessor of assessores) {
    for (const calendar of calendars) {
      const title = calendar?.informations?.title || '';
      const score = scoreMatch(assessor, title);
      if (score >= 65) {
        pairs.push({ assessor, calendar, score });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const assignedAssessors = new Set();
  const assignedCalendars = new Set();
  const assessoresMap = {};

  for (const { assessor, calendar, score } of pairs) {
    const key = assessor.nomeCompleto;
    if (assignedAssessors.has(key) || assignedCalendars.has(calendar.id)) continue;
    assessoresMap[key] = {
      calendarId: calendar.id,
      calendarTitle: calendar.informations?.title || '',
      email: assessor.email,
      matchScore: score,
      aliases: [assessor.nomeSistema].filter(Boolean),
      source: 'auto',
    };
    assignedAssessors.add(key);
    assignedCalendars.add(calendar.id);
  }

  for (const assessor of assessores) {
    const key = assessor.nomeCompleto;
    if (assessoresMap[key]) continue;
    assessoresMap[key] = {
      calendarId: null,
      calendarTitle: null,
      email: assessor.email,
      matchScore: 0,
      aliases: [assessor.nomeSistema].filter(Boolean),
      source: 'unmatched',
    };
  }

  for (const [name, calendarId] of Object.entries(overrides.assessores || {})) {
    if (calendarId === null) {
      assessoresMap[name] = {
        ...(assessoresMap[name] || { email: '', aliases: [] }),
        calendarId: null,
        calendarTitle: null,
        matchScore: 0,
        source: 'override-none',
      };
      continue;
    }
    const cal = calendars.find((c) => c.id === calendarId);
    if (!cal) continue;
    assessoresMap[name] = {
      ...(assessoresMap[name] || { email: '', aliases: [] }),
      calendarId: cal.id,
      calendarTitle: cal.informations?.title || '',
      matchScore: 100,
      source: 'override',
    };
  }

  const unmatchedAssessores = Object.entries(assessoresMap)
    .filter(([, v]) => !v.calendarId)
    .map(([k]) => k);

  const usedIds = new Set(
    Object.values(assessoresMap)
      .map((v) => v.calendarId)
      .filter(Boolean)
  );
  const unmatchedCalendars = calendars
    .filter((c) => !usedIds.has(c.id))
    .map((c) => ({ id: c.id, title: c.informations?.title || '' }));

  const output = {
    generatedAt: new Date().toISOString(),
    apiBase: API_BASE,
    techfala: techfalaCalendar
      ? { calendarId: techfalaCalendar.id, calendarTitle: techfalaCalendar.informations?.title || '' }
      : { calendarId: null, calendarTitle: null },
    assessores: assessoresMap,
    calendars: calendars.map((c) => ({
      id: c.id,
      title: c?.informations?.title || '',
      interval: c?.informations?.interval || 30,
    })),
    unmatchedAssessores,
    unmatchedCalendars: unmatchedCalendars.map((c) => ({
      id: c.id,
      title: c?.informations?.title || '',
    })),
  };

  const outPath = path.join(ROOT, 'src/data/calendar-map.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log(`Calendários encontrados: ${calendars.length}`);
  console.log(`Assessores mapeados: ${Object.values(assessoresMap).filter((a) => a.calendarId).length}`);
  console.log(`Assessores sem calendário: ${unmatchedAssessores.length}`);
  console.log(`Techfala: ${output.techfala.calendarId || 'NÃO ENCONTRADO'}`);
  console.log(`Arquivo gerado: ${outPath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
