#!/usr/bin/env node
/**
 * Envia duas mensagens de teste via Evolution API (sendText).
 * Uso: node scripts/test-whatsapp-send.mjs [telefone]
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

const EVOLUTION_API_BASE = (process.env.EVOLUTION_API_BASE_URL || 'http://135.181.144.117:8091').replace(/\/$/, '');
const EVOLUTION_API_KEY = process.env.TOKENEVOLUTION || '';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'farol-chatwoot';
const phone = (process.argv[2] || '5512997918525').replace(/\D/g, '');

const messages = [
  '[Farol SDR] Teste 1/2 — mensagem simulando o lead (cliente).',
  '[Farol SDR] Teste 2/2 — mensagem simulando o assessor.',
];

async function sendOne(text) {
  const url = `${EVOLUTION_API_BASE}/message/sendText/${EVOLUTION_INSTANCE}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: EVOLUTION_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      number: phone,
      text,
      linkPreview: true,
    }),
  });

  const responseText = await response.text();
  let data = {};
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = { raw: responseText };
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  if (!EVOLUTION_API_KEY) {
    console.error('TOKENEVOLUTION ausente no .env');
    process.exit(1);
  }

  console.log(`Enviando para ${phone} via Evolution (${EVOLUTION_INSTANCE}) ...`);
  for (let i = 0; i < messages.length; i += 1) {
    const result = await sendOne(messages[i]);
    console.log(`  ✓ Mensagem ${i + 1}:`, JSON.stringify(result));
    if (i < messages.length - 1) await new Promise((r) => setTimeout(r, 1500));
  }
  console.log('Concluído.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
