export const mapDbAssessorToOption = (row) => ({
  id: `db-${row.id}`,
  dbId: row.id,
  label: row.name,
  phone: row.phone,
  email: row.email || '',
  rowObject: {
    'Nome Completo': row.name,
    Email: row.email || '',
    Telefone: row.phone,
  },
  rowArray: [row.name, '', row.email || '', row.phone],
});

export const getAssessorPhoneFromItem = (item, cleanPhoneValue) => {
  if (!item) return '';
  if (item.phone) return cleanPhoneValue(item.phone);
  const entries = Object.entries(item.rowObject || {});
  const hit = entries.find(([header, value]) => {
    const key = header.toLowerCase();
    return /(whatsapp|telefone|celular|phone)/.test(key) && cleanPhoneValue(value);
  });
  return hit ? cleanPhoneValue(hit[1]) : '';
};

export const getAssessorEmailFromItem = (item) => item?.email || item?.rowObject?.Email || '';
