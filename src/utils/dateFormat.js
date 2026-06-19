export const normalizeIsoDate = (value) => {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  return str;
};

export const formatDateToBr = (isoDate = '') => {
  const normalized = normalizeIsoDate(isoDate);
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-');
  if (!year || !month || !day) return normalized;
  return `${day}/${month}/${year}`;
};

export const formatDateTimeBr = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};
