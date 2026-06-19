const authHeaders = () => {
  const token = localStorage.getItem('authToken');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const request = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Erro HTTP ${response.status}`);
  }
  return data;
};

export const fetchNotificationTemplates = () => request('/api/notification-templates');

export const createNotificationTemplate = (payload) =>
  request('/api/notification-templates', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateNotificationTemplate = (id, payload) =>
  request(`/api/notification-templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

export const deleteNotificationTemplate = (id) =>
  request(`/api/notification-templates/${id}`, { method: 'DELETE' });
