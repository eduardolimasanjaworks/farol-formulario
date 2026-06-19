const authHeaders = () => {
  const token = localStorage.getItem('authToken');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

export const fetchMessageTemplates = async () => {
  const response = await fetch('/api/message-templates', {
    headers: authHeaders(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Erro ao carregar copys (${response.status})`);
  }
  return data.templates;
};

export const saveMessageTemplates = async (templates) => {
  const response = await fetch('/api/message-templates', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(templates),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Erro ao salvar copys (${response.status})`);
  }
  return data.templates;
};
