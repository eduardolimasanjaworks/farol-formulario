/**
 * Convites nativos Outlook/Teams via Microsoft Graph.
 * Requer app registrado no Azure AD com permissão Calendars.ReadWrite (application).
 *
 * https://learn.microsoft.com/en-us/graph/api/user-post-events
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';
const TOKEN_URL = (tenant) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

let cachedToken = null;
let tokenExpiresAt = 0;

export const isOutlookGraphConfigured = () =>
  Boolean(
    process.env.MS_GRAPH_TENANT_ID &&
      process.env.MS_GRAPH_CLIENT_ID &&
      process.env.MS_GRAPH_CLIENT_SECRET
  );

async function getAccessToken() {
  const tenant = process.env.MS_GRAPH_TENANT_ID;
  const clientId = process.env.MS_GRAPH_CLIENT_ID;
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET;

  if (!tenant || !clientId || !clientSecret) {
    throw new Error('Microsoft Graph não configurado (MS_GRAPH_* no .env).');
  }

  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 60_000) {
    return cachedToken;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await fetch(TOKEN_URL(tenant), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error_description || data?.error || 'Falha ao obter token Graph');
  }

  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

const toGraphDateTime = (isoDate, horario) => {
  const [year, month, day] = isoDate.split('-').map(Number);
  const [hour, minute] = horario.split(':').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`;
};

const buildAttendees = (entries = []) => {
  const seen = new Set();
  const attendees = [];

  for (const { email, name } of entries) {
    const address = String(email || '').trim().toLowerCase();
    if (!address.includes('@') || seen.has(address)) continue;
    seen.add(address);
    attendees.push({
      emailAddress: { address, name: name || address },
      type: 'required',
    });
  }

  return attendees;
};

/**
 * Cria evento no calendário Outlook do assessor e envia convites por e-mail.
 * @param {object} params
 */
export async function createOutlookEvent({
  assessorEmail,
  assessorName,
  clienteName,
  clienteEmail,
  isoDate,
  horario,
  durationMinutes = 30,
  title,
  description,
  teamsMeeting = true,
}) {
  const organizer = String(assessorEmail || '').trim().toLowerCase();
  if (!organizer.includes('@')) {
    throw new Error(
      `Assessor sem e-mail válido para Outlook (${assessorName || 'desconhecido'}).`
    );
  }

  const timeZone = process.env.MS_GRAPH_TIMEZONE || 'E. South America Standard Time';
  const startLocal = toGraphDateTime(isoDate, horario);
  const [sh, sm] = horario.split(':').map(Number);
  const endMinutes = sh * 60 + sm + durationMinutes;
  const endHorario = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
  const endLocal = toGraphDateTime(isoDate, endHorario);

  const attendees = buildAttendees([
    { email: clienteEmail, name: clienteName },
    // assessor já é o organizador; não precisa estar em attendees
  ]);

  const payload = {
    subject: title || `Reunião SDR — ${clienteName}`,
    body: {
      contentType: 'Text',
      content: description || '',
    },
    start: { dateTime: startLocal, timeZone },
    end: { dateTime: endLocal, timeZone },
    attendees,
    allowNewTimeProposals: false,
    responseRequested: true,
  };

  if (teamsMeeting && process.env.MS_GRAPH_TEAMS_MEETING !== 'false') {
    payload.isOnlineMeeting = true;
    payload.onlineMeetingProvider = 'teamsForBusiness';
  }

  const token = await getAccessToken();
  const url = `${GRAPH}/users/${encodeURIComponent(organizer)}/events`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || JSON.stringify(data);
    throw new Error(`Microsoft Graph: ${msg}`);
  }

  return data;
}
