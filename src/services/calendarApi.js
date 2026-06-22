import calendarMap from '../data/calendar-map.json';

const API_PREFIX = import.meta.env.VITE_CALENDAR_PROXY_PREFIX || '/api/calendar';

const calendarRequest = async (path, options = {}) => {
  const response = await fetch(`${API_PREFIX}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error || data?.message || `Erro HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
};

const toPositiveInt = (value) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : null;
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

export const getCalendarMap = () => calendarMap;

export const resolveAssessorCalendarId = (assessorName = '') => {
  const direct = calendarMap?.assessores?.[assessorName];
  if (direct?.calendarId) return direct.calendarId;

  const normalized = assessorName.trim().toLowerCase();
  for (const [name, entry] of Object.entries(calendarMap?.assessores || {})) {
    if (entry?.calendarId && name.trim().toLowerCase() === normalized) {
      return entry.calendarId;
    }
    const aliases = entry?.aliases || [];
    if (entry?.calendarId && aliases.some((a) => a.trim().toLowerCase() === normalized)) {
      return entry.calendarId;
    }
  }
  return null;
};

export const getTechfalaCalendarId = () => calendarMap?.techfala?.calendarId || null;

const brDateTimeToUnixMs = (isoDate = '', time = '') => {
  const [year, month, day] = isoDate.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error('Data ou horário inválido para agendamento.');
  }

  // Horário comercial em Brasília (UTC-3 fixo).
  const utcMs = Date.UTC(year, month - 1, day, hour + 3, minute, 0, 0);
  return utcMs;
};

export const buildEventPayload = ({
  calendarId,
  title,
  description,
  guests = [],
  isoDate,
  horario,
  durationMinutes = 30,
  notificationEnabled = true,
}) => {
  const dateStart = brDateTimeToUnixMs(isoDate, horario);
  const dateEnd = dateStart + durationMinutes * 60 * 1000;

  return {
    calendar: calendarId,
    notificationEnabled,
    event_id: 0,
    informations: {
      meetingUrl: '',
      description: description || '',
      title: title || 'Reunião Farol SDR',
      guests,
      dateStart,
      dateEnd,
      duration: durationMinutes,
      privateFileUrl: [],
      color: '',
    },
  };
};

export const createCalendarEvent = (payload) =>
  calendarRequest('/events', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const deleteCalendarEvents = (externalEvents = []) => {
  const eventIds = [...new Set(
    externalEvents
      .map((item) => toPositiveInt(item?.eventId))
      .filter(Boolean)
  )];

  if (!eventIds.length) return Promise.resolve([]);

  return calendarRequest('/events', {
    method: 'DELETE',
    body: JSON.stringify({ events_id: eventIds }),
  });
};

export const fetchAvailableSlots = ({ calendarId, daysToShow = 7, slotSize = 30 }) =>
  calendarRequest(`/available-slots?calendarId=${calendarId}&daysToShow=${daysToShow}&slotSize=${slotSize}`);

const normalizeGuest = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.includes('@')) return raw.toLowerCase();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  return digits.startsWith('+') ? digits : `+${digits}`;
};

export const scheduleMeeting = async ({
  assessorName,
  clienteName,
  clientePhone,
  clienteEmail,
  assessorPhone: _assessorPhone,
  assessorEmail,
  isoDate,
  horario,
  origem = 'Farol SDR',
  durationMinutes = 30,
}) => {
  const assessorCalendarId = resolveAssessorCalendarId(assessorName);
  if (!assessorCalendarId) {
    throw new Error(
      `Assessor "${assessorName}" sem calendário mapeado. Rode: npm run calendars:sync`
    );
  }

  // guests: apenas e-mails (convite Outlook/Teams). WhatsApp exclusivamente via Evolution (/api/message/send).
  const guests = [];
  const pushGuestEmail = (value) => {
    const guest = normalizeGuest(value);
    if (guest && guest.includes('@') && !guests.includes(guest)) guests.push(guest);
  };

  pushGuestEmail(clienteEmail);
  pushGuestEmail(assessorEmail);

  const title = `Reunião SDR — ${clienteName}`;
  const description = [
    `Cliente: ${clienteName}`,
    `Assessor: ${assessorName}`,
    `Origem: ${origem}`,
    clientePhone ? `WhatsApp cliente: ${clientePhone}` : '',
  ].filter(Boolean).join('\n');

  const assessorPayload = buildEventPayload({
    calendarId: assessorCalendarId,
    title,
    description,
    guests,
    isoDate,
    horario,
    durationMinutes,
    notificationEnabled: false,
  });

  const buildExternalEvent = (response, fallback) => ({
    provider: 'softwareai',
    label: fallback.label,
    calendarId: fallback.calendarId,
    eventId: extractEventId(response),
    title: fallback.title,
    description: fallback.description,
    guests: fallback.guests,
    durationMinutes: fallback.durationMinutes,
    notificationEnabled: fallback.notificationEnabled,
    meetingUrl: '',
    privateFileUrl: [],
    color: '',
  });

  const assessorResponse = await createCalendarEvent(assessorPayload);
  const created = {
    softwareAi: [assessorResponse],
    externalEvents: [
      buildExternalEvent(assessorResponse, {
        label: assessorName,
        calendarId: assessorCalendarId,
        title,
        description,
        guests,
        durationMinutes,
        notificationEnabled: false,
      }),
    ],
    outlook: null,
  };

  const outlookEnabled = import.meta.env.VITE_OUTLOOK_GRAPH_ENABLED !== 'false';
  if (outlookEnabled && assessorEmail && assessorEmail.includes('@')) {
    try {
      created.outlook = await fetch('/api/outlook/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessorEmail,
          assessorName,
          clienteName,
          clienteEmail,
          isoDate,
          horario,
          durationMinutes,
          title,
          description,
          teamsMeeting: true,
        }),
      }).then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || `Outlook HTTP ${response.status}`);
        }
        return data;
      });
    } catch (outlookError) {
      const strict = import.meta.env.VITE_OUTLOOK_GRAPH_STRICT === 'true';
      if (strict) throw outlookError;
      created.outlookError = outlookError?.message || String(outlookError);
    }
  }

  const techfalaCalendarId = getTechfalaCalendarId();
  if (techfalaCalendarId && techfalaCalendarId !== assessorCalendarId) {
    const techfalaPayload = buildEventPayload({
      calendarId: techfalaCalendarId,
      title: `[Techfala] ${title}`,
      description,
      guests,
      isoDate,
      horario,
      durationMinutes,
      notificationEnabled: false,
    });
    const techfalaResponse = await createCalendarEvent(techfalaPayload);
    created.softwareAi.push(techfalaResponse);
    created.externalEvents.push(
      buildExternalEvent(techfalaResponse, {
        label: 'Techfala',
        calendarId: techfalaCalendarId,
        title: `[Techfala] ${title}`,
        description,
        guests,
        durationMinutes,
        notificationEnabled: false,
      })
    );
  }

  return created;
};

export const buildMeetingCalendarPlan = ({
  assessorName,
  clienteName,
  clientePhone,
  clienteEmail,
  assessorEmail,
  isoDate,
  horario,
  origem = 'Farol SDR',
  durationMinutes = 30,
}) => {
  const assessorCalendarId = resolveAssessorCalendarId(assessorName);
  if (!assessorCalendarId) {
    throw new Error(
      `Assessor "${assessorName}" sem calendário mapeado. Rode: npm run calendars:sync`
    );
  }

  const guests = [];
  const pushGuestEmail = (value) => {
    const guest = normalizeGuest(value);
    if (guest && guest.includes('@') && !guests.includes(guest)) guests.push(guest);
  };

  pushGuestEmail(clienteEmail);
  pushGuestEmail(assessorEmail);

  const title = `Reunião SDR — ${clienteName}`;
  const description = [
    `Cliente: ${clienteName}`,
    `Assessor: ${assessorName}`,
    `Origem: ${origem}`,
    clientePhone ? `WhatsApp cliente: ${clientePhone}` : '',
  ].filter(Boolean).join('\n');

  const plan = [
    {
      provider: 'softwareai',
      label: assessorName,
      calendarId: assessorCalendarId,
      title,
      description,
      guests,
      durationMinutes,
      notificationEnabled: false,
    },
  ];

  const techfalaCalendarId = getTechfalaCalendarId();
  if (techfalaCalendarId && techfalaCalendarId !== assessorCalendarId) {
    plan.push({
      provider: 'softwareai',
      label: 'Techfala',
      calendarId: techfalaCalendarId,
      title: `[Techfala] ${title}`,
      description,
      guests,
      durationMinutes,
      notificationEnabled: false,
    });
  }

  return {
    calendarPlan: plan,
    title,
    description,
    guests,
    isoDate,
    horario,
  };
};
