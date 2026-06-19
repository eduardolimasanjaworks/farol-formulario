import { getAuthSession } from '../utils/authSession';

const authHeaders = () => {
  const { token } = getAuthSession();
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

export const fetchScheduledMeetings = (params = {}) => {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.status) query.set('status', params.status);
  const suffix = query.toString() ? `?${query}` : '';
  return request(`/api/scheduled-meetings${suffix}`);
};

export const fetchScheduledNotifications = (params = {}) => {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.status) query.set('status', params.status);
  const suffix = query.toString() ? `?${query}` : '';
  return request(`/api/scheduled-notifications${suffix}`);
};

export const createScheduledMeeting = (payload) =>
  request('/api/scheduled-meetings', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const cancelScheduledMeeting = (id) =>
  request(`/api/scheduled-meetings/${id}/cancel`, {
    method: 'POST',
  });

export const rescheduleScheduledMeeting = (id, payload) =>
  request(`/api/scheduled-meetings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
