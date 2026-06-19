const STORAGE_KEYS = Object.freeze({
  token: 'authToken',
  userId: 'authUserId',
  login: 'authLogin',
  name: 'authUser',
  role: 'authRole',
});

export const getAuthSession = () => ({
  token: localStorage.getItem(STORAGE_KEYS.token) || '',
  userId: localStorage.getItem(STORAGE_KEYS.userId) || '',
  login: localStorage.getItem(STORAGE_KEYS.login) || '',
  name: localStorage.getItem(STORAGE_KEYS.name) || '',
  role: localStorage.getItem(STORAGE_KEYS.role) || '',
});

export const setAuthSession = ({ token, user }) => {
  localStorage.setItem(STORAGE_KEYS.token, token || '');
  localStorage.setItem(STORAGE_KEYS.userId, user?.id != null ? String(user.id) : '');
  localStorage.setItem(STORAGE_KEYS.login, user?.login || '');
  localStorage.setItem(STORAGE_KEYS.name, user?.name || user?.login || '');
  localStorage.setItem(STORAGE_KEYS.role, user?.role || 'user');
};

export const clearAuthSession = () => {
  Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
};

export const isAdminSession = (session = getAuthSession()) => session.role === 'admin';
