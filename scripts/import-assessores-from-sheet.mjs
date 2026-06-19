#!/usr/bin/env node
/**
 * Importa assessores da planilha Google (uma vez) para o PostgreSQL.
 * Uso: node scripts/import-assessores-from-sheet.mjs
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

const { initAssessorStore, listAssessores, createAssessor, updateAssessor, normalizePhone } =
  await import('../server/assessor-db.mjs');

const normalizeSheetCsvUrl = (url = '') => {
  if (!url) return '';
  if (url.includes('tqx=out:csv')) return url;
  const match = url.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match?.[1]) return url;
  const gidMatch = url.match(/[?&#]gid=(\d+)/);
  const gid = gidMatch?.[1] || '0';
  return `https://docs.google.com/spreadsheets/d/${match[1]}/gviz/tq?tqx=out:csv&gid=${gid}`;
};

const SHEET_URL = normalizeSheetCsvUrl(
  process.env.IMPORT_SHEET_URL ||
    process.env.VITE_SHEET_ASSESSORES_LINK ||
    'https://docs.google.com/spreadsheets/d/1tzlUYB6boC8gesjTZ83TGBVBDx2GXZJLY4he9Qc8OtM/gviz/tq?tqx=out:csv&gid=0'
);

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
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      continue;
    }
    current += char;
  }
  if (current || row.length) {
    row.push(current.trim());
    if (row.some((c) => c !== '')) rows.push(row);
  }
  return rows;
};

const normalizeKey = (v = '') =>
  v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

const extractPhone = (value = '') => {
  let raw = String(value || '').trim();
  if (/^\d+(\.\d+)?e\+\d+$/i.test(raw)) {
    const num = Number(raw);
    if (Number.isFinite(num)) raw = Math.trunc(num).toString();
  }
  return normalizePhone(raw);
};

async function main() {
  const ok = await initAssessorStore();
  if (!ok) {
    console.error('PostgreSQL não configurado.');
    process.exit(1);
  }

  const res = await fetch(SHEET_URL);
  if (!res.ok) throw new Error(`Falha ao baixar planilha (${res.status})`);
  const text = await res.text();
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('Planilha vazia');

  const headers = rows[0];
  const nomeIdx = headers.findIndex((h) => /nome completo/i.test(h));
  const emailIdx = headers.findIndex((h) => /email/i.test(h));
  const telIdx = headers.findIndex((h) => /telefone|whatsapp|celular/i.test(h));

  const existing = await listAssessores({ includeInactive: true });
  const byPhone = new Map(existing.map((a) => [a.phone, a]));
  const byName = new Map(existing.map((a) => [normalizeKey(a.name), a]));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows.slice(1)) {
    const name = (row[nomeIdx >= 0 ? nomeIdx : 0] || '').trim();
    const email = (row[emailIdx >= 0 ? emailIdx : 2] || '').trim();
    const phone = extractPhone(row[telIdx >= 0 ? telIdx : 3] || '');

    if (!name) {
      skipped += 1;
      continue;
    }

    const hit = (phone && byPhone.get(phone)) || byName.get(normalizeKey(name));

    if (hit) {
      await updateAssessor(hit.id, {
        name,
        ...(phone ? { phone } : {}),
        email,
        isActive: true,
      });
      updated += 1;
      byPhone.set(phone || hit.phone, { ...hit, name, phone: phone || hit.phone });
      byName.set(normalizeKey(name), hit);
      continue;
    }

    if (!phone || phone.length < 12) {
      console.warn(`  ⚠ Sem telefone válido, ignorado: ${name}`);
      skipped += 1;
      continue;
    }

    const rowDb = await createAssessor({ name, phone, email });
    created += 1;
    byPhone.set(rowDb.phone, rowDb);
    byName.set(normalizeKey(rowDb.name), rowDb);
  }

  const total = await listAssessores();
  console.log(`Importação concluída.`);
  console.log(`  Criados: ${created}`);
  console.log(`  Atualizados: ${updated}`);
  console.log(`  Ignorados: ${skipped}`);
  console.log(`  Total ativos no banco: ${total.length}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
