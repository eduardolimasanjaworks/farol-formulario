import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  LogOut,
  XCircle,
  CalendarClock,
  Bell,
  Clock,
  RefreshCw,
} from 'lucide-react';
import AdminNav from '../components/AdminNav';
import { clearAuthSession, getAuthSession } from '../utils/authSession';
import { formatDateToBr } from '../utils/dateFormat';
import { meetingStatusLabel, statusLabel } from '../utils/scheduleStatus';
import { createTimeOptions } from '../utils/scheduleOptions';
import {
  cancelScheduledMeeting,
  fetchScheduledMeetings,
  fetchScheduledNotifications,
  rescheduleScheduledMeeting,
} from '../services/scheduleApi';
import '../styles/notifications-admin.css';

const timeOptions = createTimeOptions(30);

const STATUS_FILTERS = [
  { value: 'scheduled', label: 'Ativas' },
  { value: 'cancelled', label: 'Canceladas' },
  { value: 'all', label: 'Todas' },
];

const ScheduleAdmin = () => {
  const navigate = useNavigate();
  const { token } = getAuthSession();
  const [statusFilter, setStatusFilter] = useState('scheduled');
  const [searchTerm, setSearchTerm] = useState('');
  const [assessorFilter, setAssessorFilter] = useState('all');
  const [creatorFilter, setCreatorFilter] = useState('all');
  const [meetingDateFilter, setMeetingDateFilter] = useState('');
  const [meetings, setMeetings] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [rescheduleForm, setRescheduleForm] = useState({ meetingDate: '', meetingTime: '' });

  const notificationsByMeeting = useMemo(() => {
    const map = new Map();
    notifications.forEach((item) => {
      const list = map.get(item.meetingId) || [];
      list.push(item);
      map.set(item.meetingId, list);
    });
    return map;
  }, [notifications]);

  const assessorOptions = useMemo(
    () => ['all', ...new Set(meetings.map((item) => item.assessor).filter(Boolean))],
    [meetings]
  );

  const creatorOptions = useMemo(
    () => ['all', ...new Set(meetings.map((item) => item.createdBy).filter(Boolean))],
    [meetings]
  );

  const filteredMeetings = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return meetings.filter((meeting) => {
      if (assessorFilter !== 'all' && meeting.assessor !== assessorFilter) return false;
      if (creatorFilter !== 'all' && (meeting.createdBy || '') !== creatorFilter) return false;
      if (meetingDateFilter && meeting.meetingDate !== meetingDateFilter) return false;

      if (!query) return true;

      const haystack = [
        meeting.cliente,
        meeting.assessor,
        meeting.createdBy,
        meeting.meetingDate,
        meeting.meetingTime,
        meeting.source,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [meetings, searchTerm, assessorFilter, creatorFilter, meetingDateFilter]);

  const loadBoard = async () => {
    setLoading(true);
    try {
      const [meetingsPayload, notificationsPayload] = await Promise.all([
        fetchScheduledMeetings({ limit: 200, status: statusFilter }),
        fetchScheduledNotifications({ limit: 500 }),
      ]);
      setMeetings(meetingsPayload.rows || []);
      setNotifications(notificationsPayload.rows || []);
    } catch (error) {
      setStatus(error.message || 'Não foi possível carregar os agendamentos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    loadBoard();
  }, [statusFilter]);

  const handleCancel = async (meeting) => {
    const label = `${meeting.cliente} · ${formatDateToBr(meeting.meetingDate)} às ${meeting.meetingTime}`;
    if (!window.confirm(`Cancelar esta reunião?\n\n${label}\n\nOs follow-ups pendentes deixarão de ser enviados.`)) {
      return;
    }

    setBusyId(meeting.id);
    setStatus('');
    try {
      await cancelScheduledMeeting(meeting.id);
      setStatus('Reunião cancelada com sucesso.');
      await loadBoard();
    } catch (error) {
      setStatus(error.message || 'Não foi possível cancelar a reunião.');
    } finally {
      setBusyId(null);
    }
  };

  const openReschedule = (meeting) => {
    setRescheduleTarget(meeting);
    setRescheduleForm({
      meetingDate: meeting.meetingDate,
      meetingTime: meeting.meetingTime,
    });
    setStatus('');
  };

  const closeReschedule = () => {
    setRescheduleTarget(null);
    setRescheduleForm({ meetingDate: '', meetingTime: '' });
  };

  const handleReschedule = async (event) => {
    event.preventDefault();
    if (!rescheduleTarget) return;

    setBusyId(rescheduleTarget.id);
    setStatus('');
    try {
      await rescheduleScheduledMeeting(rescheduleTarget.id, rescheduleForm);
      setStatus('Reunião remarcada e follow-ups pendentes recalculados.');
      closeReschedule();
      await loadBoard();
    } catch (error) {
      setStatus(error.message || 'Não foi possível remarcar a reunião.');
    } finally {
      setBusyId(null);
    }
  };

  const logout = () => {
    clearAuthSession();
    navigate('/login');
  };

  const isSuccessStatus = status.includes('sucesso') || status.includes('remarcada') || status.includes('cancelada');

  return (
    <div className="premium-container notif-admin-wrap">
      <div className="glass-card animate-fade-in notif-admin-page">
        <AdminNav />

        <header className="notif-admin-header">
          <div>
            <h1 className="notif-admin-title">
              <CalendarDays size={24} />
              Agendamentos
            </h1>
            <p className="notif-admin-subtitle">
              Visualize todas as reuniões, cancele quando o cliente desistir ou remarque data e horário.
              Os follow-ups pendentes são recalculados automaticamente.
            </p>
          </div>
          <button type="button" className="btn-pill btn-pill-ghost" onClick={logout}>
            <LogOut size={16} />
            Sair
          </button>
        </header>

        {status && (
          <div className={`notif-alert ${isSuccessStatus ? 'notif-alert-success' : 'notif-alert-error'}`}>
            {status}
          </div>
        )}

        <div className="notif-toolbar">
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={`btn-pill ${statusFilter === filter.value ? 'btn-pill-primary' : 'btn-pill-ghost'}`}
                onClick={() => setStatusFilter(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn-pill btn-pill-ghost" onClick={loadBoard} disabled={loading}>
            <RefreshCw size={16} />
            Atualizar
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '0.75rem',
            marginBottom: '1rem',
          }}
        >
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Buscar</span>
            <input
              className="modern-select"
              type="text"
              placeholder="Cliente, assessor, SDR..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Assessor</span>
            <select
              className="modern-select"
              value={assessorFilter}
              onChange={(event) => setAssessorFilter(event.target.value)}
            >
              <option value="all">Todos</option>
              {assessorOptions
                .filter((item) => item !== 'all')
                .map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>SDR</span>
            <select
              className="modern-select"
              value={creatorFilter}
              onChange={(event) => setCreatorFilter(event.target.value)}
            >
              <option value="all">Todos</option>
              {creatorOptions
                .filter((item) => item !== 'all')
                .map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Data</span>
            <input
              className="modern-select"
              type="date"
              value={meetingDateFilter}
              onChange={(event) => setMeetingDateFilter(event.target.value)}
            />
          </label>
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Carregando agendamentos...</p>
        ) : filteredMeetings.length === 0 ? (
          <div className="notif-empty-state">
            <h3>Nenhum agendamento encontrado.</h3>
            <p>Ajuste os filtros ou crie um novo agendamento na página do SDR.</p>
          </div>
        ) : (
          <div className="notif-table-wrap">
            <table className="notif-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Assessor</th>
                  <th>Data / hora</th>
                  <th>Status</th>
                  <th>Follow-ups</th>
                  <th>Criado por</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {filteredMeetings.map((meeting) => {
                  const related = notificationsByMeeting.get(meeting.id) || [];
                  const pendingCount = related.filter((item) => item.status === 'pending').length;

                  return (
                    <tr key={meeting.id}>
                      <td>
                        <strong>{meeting.cliente}</strong>
                      </td>
                      <td>{meeting.assessor}</td>
                      <td>
                        <div>{formatDateToBr(meeting.meetingDate)}</div>
                        <small style={{ color: 'var(--text-muted)' }}>{meeting.meetingTime}</small>
                      </td>
                      <td>
                        <span
                          className={`notif-contact-badge ${
                            meeting.status === 'cancelled'
                              ? 'notif-contact-badge--terceiro'
                              : 'notif-contact-badge--assessor'
                          }`}
                        >
                          {meetingStatusLabel(meeting.status)}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'grid', gap: '0.35rem' }}>
                          <span style={{ fontSize: '0.82rem' }}>
                            <Bell size={12} style={{ marginRight: '0.25rem' }} />
                            {pendingCount} pendente(s)
                          </span>
                          {related.slice(0, 2).map((item) => (
                            <small key={item.id} style={{ color: 'var(--text-muted)', display: 'block' }}>
                              {item.title} · {statusLabel(item.status)}
                            </small>
                          ))}
                        </div>
                      </td>
                      <td>{meeting.createdBy || '—'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          {meeting.canReschedule && (
                            <button
                              type="button"
                              className="btn-pill btn-pill-ghost"
                              style={{ padding: '0.4rem 0.85rem', fontSize: '0.78rem' }}
                              disabled={busyId === meeting.id}
                              onClick={() => openReschedule(meeting)}
                            >
                              <CalendarClock size={14} />
                              Remarcar
                            </button>
                          )}
                          {meeting.canCancel && (
                            <button
                              type="button"
                              className="btn-pill btn-pill-ghost"
                              style={{
                                padding: '0.4rem 0.85rem',
                                fontSize: '0.78rem',
                                borderColor: 'rgba(239, 68, 68, 0.35)',
                                color: '#fca5a5',
                              }}
                              disabled={busyId === meeting.id}
                              onClick={() => handleCancel(meeting)}
                            >
                              <XCircle size={14} />
                              Cancelar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rescheduleTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reschedule-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            zIndex: 50,
          }}
          onClick={closeReschedule}
        >
          <div
            className="glass-card"
            style={{ width: 'min(480px, 96vw)', padding: '1.5rem' }}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="reschedule-title" style={{ margin: '0 0 0.5rem', fontSize: '1.15rem' }}>
              Remarcar reunião
            </h2>
            <p style={{ margin: '0 0 1rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              {rescheduleTarget.cliente} com {rescheduleTarget.assessor}
            </p>

            <form onSubmit={handleReschedule} style={{ display: 'grid', gap: '0.75rem' }}>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Nova data</span>
                <input
                  className="modern-select"
                  type="date"
                  value={rescheduleForm.meetingDate}
                  onChange={(event) =>
                    setRescheduleForm((prev) => ({ ...prev, meetingDate: event.target.value }))
                  }
                  required
                />
              </label>

              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Novo horário</span>
                <select
                  className="modern-select"
                  value={rescheduleForm.meetingTime}
                  onChange={(event) =>
                    setRescheduleForm((prev) => ({ ...prev, meetingTime: event.target.value }))
                  }
                  required
                >
                  <option value="">Selecione</option>
                  {timeOptions.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </label>

              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', gap: '0.35rem' }}>
                <Clock size={13} />
                Follow-ups pendentes serão recalculados com base na nova data.
              </p>

              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button type="button" className="btn-pill btn-pill-ghost" onClick={closeReschedule}>
                  Voltar
                </button>
                <button
                  type="submit"
                  className="btn-pill btn-pill-primary"
                  disabled={busyId === rescheduleTarget.id}
                >
                  Salvar nova data
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduleAdmin;
