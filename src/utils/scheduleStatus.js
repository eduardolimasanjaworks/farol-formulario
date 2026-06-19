export const MEETING_STATUS = Object.freeze({
  SCHEDULED: 'scheduled',
  CANCELLED: 'cancelled',
});

export const NOTIFICATION_STATUS = Object.freeze({
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  CANCELLED: 'cancelled',
});

const STATUS_LABELS = Object.freeze({
  [NOTIFICATION_STATUS.SENT]: 'Enviado',
  [NOTIFICATION_STATUS.PENDING]: 'Pendente',
  [NOTIFICATION_STATUS.FAILED]: 'Falhou',
  [NOTIFICATION_STATUS.SKIPPED]: 'Ignorado',
  [NOTIFICATION_STATUS.CANCELLED]: 'Cancelado',
});

export const statusLabel = (status) => STATUS_LABELS[status] || status || '—';

const MEETING_STATUS_LABELS = Object.freeze({
  [MEETING_STATUS.SCHEDULED]: 'Agendada',
  [MEETING_STATUS.CANCELLED]: 'Cancelada',
});

export const meetingStatusLabel = (status) => MEETING_STATUS_LABELS[status] || status || '—';
