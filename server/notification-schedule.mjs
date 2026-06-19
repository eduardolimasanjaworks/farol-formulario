/** Horário comercial em Brasília (UTC-3 fixo), alinhado ao calendário. */
export const meetingAtFromBr = (isoDate = '', horario = '') => {
  const [year, month, day] = String(isoDate).split('-').map(Number);
  const [hour, minute] = String(horario).split(':').map(Number);
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error('Data ou horário inválido para agendamento.');
  }
  return new Date(Date.UTC(year, month - 1, day, hour + 3, minute, 0, 0));
};

export const offsetToMs = ({ offsetDays = 0, offsetHours = 0, offsetMinutes = 0 } = {}) => {
  const days = Math.max(0, Number(offsetDays) || 0);
  const hours = Math.max(0, Number(offsetHours) || 0);
  const minutes = Math.max(0, Number(offsetMinutes) || 0);
  return ((days * 24 + hours) * 60 + minutes) * 60 * 1000;
};

export const computeScheduledAt = (meetingAt, template) => {
  const offsetMs = offsetToMs({
    offsetDays: template.offset_days,
    offsetHours: template.offset_hours,
    offsetMinutes: template.offset_minutes,
  });
  const moment = template.moment === 'after' ? 'after' : 'before';
  const base = meetingAt instanceof Date ? meetingAt.getTime() : new Date(meetingAt).getTime();
  return new Date(moment === 'before' ? base - offsetMs : base + offsetMs);
};

export const resolveRecipientPhone = (template, meeting) => {
  const recipient = template.recipient;
  if (recipient === 'terceiro') {
    return String(template.third_party_phone || '').replace(/\D/g, '');
  }
  if (recipient === 'assessor') {
    return String(meeting.phone_assessor || '').replace(/\D/g, '');
  }
  return String(meeting.phone_cliente || '').replace(/\D/g, '');
};

export const recipientLabel = (recipient) => {
  if (recipient === 'assessor') return 'Assessor';
  if (recipient === 'terceiro') return 'Terceiro';
  return 'Cliente';
};
