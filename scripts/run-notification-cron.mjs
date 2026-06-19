#!/usr/bin/env node
/**
 * Executa uma passada do cron de follow-ups (útil para systemd/crontab externo).
 * Uso: node scripts/run-notification-cron.mjs
 */
import '../server/load-env.mjs';
import { initScheduledMeetingStore, processPendingNotifications } from '../server/scheduled-meetings-db.mjs';

await initScheduledMeetingStore();
const result = await processPendingNotifications();
console.log(JSON.stringify({ ok: true, ...result }));
