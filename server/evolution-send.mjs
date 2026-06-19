const EVOLUTION_API_BASE = (process.env.EVOLUTION_API_BASE_URL || 'http://135.181.144.117:8091').replace(
  /\/$/,
  ''
);
const EVOLUTION_API_KEY = process.env.TOKENEVOLUTION || '';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'farol-chatwoot';

export const isEvolutionConfigured = () => Boolean(EVOLUTION_API_KEY);

export const normalizePhoneDigits = (value = '') => String(value || '').replace(/\D/g, '');

export const sendEvolutionText = async (phoneNumber, textContent) => {
  if (process.env.EVOLUTION_DRY_RUN === '1' || process.env.EVOLUTION_DRY_RUN === 'true') {
    const number = normalizePhoneDigits(phoneNumber);
    const text = String(textContent ?? '').trim();
    if (!number || !text) {
      throw new Error('Número e texto são obrigatórios para envio Evolution.');
    }
    return { dryRun: true, number, textLength: text.length };
  }

  if (!EVOLUTION_API_KEY) {
    throw new Error('TOKENEVOLUTION não configurado no servidor.');
  }

  const number = normalizePhoneDigits(phoneNumber);
  const text = String(textContent ?? '').trim();
  if (!number || !text) {
    throw new Error('Número e texto são obrigatórios para envio Evolution.');
  }

  const url = `${EVOLUTION_API_BASE}/message/sendText/${EVOLUTION_INSTANCE}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: EVOLUTION_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      number,
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
    const message = data?.message || data?.error || 'Falha ao enviar mensagem via Evolution.';
    const error = new Error(message);
    error.detail = data;
    error.status = response.status;
    throw error;
  }

  return data;
};
