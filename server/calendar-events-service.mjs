import './load-env.mjs';

const API_BASE = (process.env.CALENDAR_API_BASE_URL || '').replace(/\/$/, '');
const API_TOKEN = process.env.CALENDAR_API_TOKEN || '';

const toPositiveInt = (value) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : null;
};

const normalizeGuests = (guests) => {
  if (!Array.isArray(guests)) return [];
  return [...new Set(guests.map((item) => String(item || '').trim()).filter(Boolean))];
};

const brDateTimeToUnixMs = (isoDate = '', time = '', durationMinutes = 30) => {
  const [year, month, day] = String(isoDate).split('-').map(Number);
  const [hour, minute] = String(time).split(':').map(Number);
  const duration = Math.max(1, Number(durationMinutes) || 30);
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error('Data ou horario invalido para sincronizacao de calendario.');
  }

  const dateStart = Date.UTC(year, month - 1, day, hour + 3, minute, 0, 0);
  const dateEnd = dateStart + duration * 60 * 1000;
  return { dateStart, dateEnd, duration };
};

const extractEventId = (payload) => {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = extractEventId(item);
      if (found) return found;
    }
    return null;
  }

  if (!payload || typeof payload !== 'object') return null;

  for (const key of ['id', 'event_id', 'eventId']) {
    const value = toPositiveInt(payload[key]);
    if (value) return value;
  }

  for (const value of Object.values(payload)) {
    const found = extractEventId(value);
    if (found) return found;
  }

  return null;
};

const requestCalendarApi = async (method, path, body) => {
  if (!API_BASE || !API_TOKEN) {
    throw new Error('API de calendario nao configurada no servidor.');
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Calendario HTTP ${response.status}`);
  }

  return payload;
};

const buildStoredExternalEvent = (event, fallback = {}) => {
  const eventId = extractEventId(event) || toPositiveInt(fallback.eventId);
  const calendarId = toPositiveInt(event?.calendar) || toPositiveInt(fallback.calendarId);
  if (!eventId || !calendarId) {
    throw new Error('Nao foi possivel identificar o ID do evento externo criado.');
  }

  return {
    provider: String(fallback.provider || 'softwareai'),
    label: String(fallback.label || 'Calendario'),
    calendarId,
    eventId,
    title: String(fallback.title || ''),
    description: String(fallback.description || ''),
    guests: normalizeGuests(fallback.guests),
    durationMinutes: Math.max(1, Number(fallback.durationMinutes) || 30),
    notificationEnabled: Boolean(fallback.notificationEnabled),
    meetingUrl: String(fallback.meetingUrl || ''),
    privateFileUrl: Array.isArray(fallback.privateFileUrl) ? fallback.privateFileUrl : [],
    color: String(fallback.color || ''),
  };
};

const buildEventPayload = (event, meetingDate, meetingTime, eventIdOverride = null) => {
  const { dateStart, dateEnd, duration } = brDateTimeToUnixMs(
    meetingDate,
    meetingTime,
    event.durationMinutes
  );

  return {
    calendar: toPositiveInt(event.calendarId),
    notificationEnabled: Boolean(event.notificationEnabled),
    event_id: eventIdOverride != null ? toPositiveInt(eventIdOverride) || 0 : toPositiveInt(event.eventId) || 0,
    informations: {
      meetingUrl: String(event.meetingUrl || ''),
      description: String(event.description || ''),
      title: String(event.title || 'Reuniao Farol SDR'),
      guests: normalizeGuests(event.guests),
      dateStart,
      dateEnd,
      duration,
      privateFileUrl: Array.isArray(event.privateFileUrl) ? event.privateFileUrl : [],
      color: String(event.color || ''),
    },
  };
};

export const createCalendarEvents = async (calendarPlan = [], meetingDate, meetingTime) => {
  if (!Array.isArray(calendarPlan) || calendarPlan.length === 0) return [];

  const created = [];
  for (const item of calendarPlan) {
    const payload = buildEventPayload(item, meetingDate, meetingTime, 0);
    const response = await requestCalendarApi('POST', '/calendar/events', payload);
    created.push(buildStoredExternalEvent(response, item));
  }
  return created;
};

export const deleteCalendarEvents = async (externalEvents = []) => {
  const eventIds = [...new Set(
    (externalEvents || [])
      .map((item) => toPositiveInt(item?.eventId))
      .filter(Boolean)
  )];

  if (!eventIds.length) return [];
  await requestCalendarApi('DELETE', '/calendar/events', { events_id: eventIds });
  return eventIds;
};

export const rescheduleCalendarEvents = async (externalEvents = [], meetingDate, meetingTime) => {
  if (!Array.isArray(externalEvents) || !externalEvents.length) return [];

  const synced = [];
  for (const item of externalEvents) {
    const payload = buildEventPayload(item, meetingDate, meetingTime);
    try {
      const response = await requestCalendarApi('POST', '/calendar/events', payload);
      synced.push(buildStoredExternalEvent(response, item));
      continue;
    } catch (error) {
      const recreatedResponse = await requestCalendarApi(
        'POST',
        '/calendar/events',
        buildEventPayload(item, meetingDate, meetingTime, 0)
      );
      const recreated = buildStoredExternalEvent(recreatedResponse, item);
      synced.push(recreated);
      try {
        await deleteCalendarEvents([item]);
      } catch {
        // The new event was created and persisted below; ignore best-effort deletion failures.
      }
      continue;
    }
  }

  return synced;
};

export const rollbackCreatedCalendarEvents = async (externalEvents = []) => {
  try {
    await deleteCalendarEvents(externalEvents);
  } catch (error) {
    console.error('[calendar-events-service] Falha ao desfazer eventos externos:', error?.message || error);
  }
};
