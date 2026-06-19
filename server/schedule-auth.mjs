import { MEETING_STATUS } from './schedule-constants.mjs';

export const normalizeLogin = (value = '') => String(value || '').trim().toLowerCase();

export const canManageScheduledMeeting = (meeting, user = {}) => {
  if (!meeting || meeting.status !== MEETING_STATUS.SCHEDULED) return false;
  if (user.role === 'admin') return true;

  const userId = Number(user.sub);
  if (Number.isFinite(userId) && meeting.createdByUserId != null) {
    return Number(meeting.createdByUserId) === userId;
  }

  if (!meeting.createdBy) return false;
  return normalizeLogin(meeting.createdBy) === normalizeLogin(user.login);
};

export const canCancelMeeting = canManageScheduledMeeting;
export const canRescheduleMeeting = canManageScheduledMeeting;

export const withMeetingPermissions = (meeting, user) => ({
  ...meeting,
  canCancel: canManageScheduledMeeting(meeting, user),
  canReschedule: canManageScheduledMeeting(meeting, user),
});
