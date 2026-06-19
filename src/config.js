export const config = {
  calendarEnabled: import.meta.env.VITE_CALENDAR_ENABLED !== 'false',
  calendarProxyPrefix: import.meta.env.VITE_CALENDAR_PROXY_PREFIX || '/api/calendar',
};
