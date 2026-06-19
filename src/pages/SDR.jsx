import React, { useState, useEffect, useRef } from 'react';
import { Send, Save, MessageSquare, Calendar, Users, UserPlus, Phone, Sparkles, Plus, Pencil, Trash2, Bell, Clock, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { config } from '../config';
import { resolveAssessorCalendarId, scheduleMeeting } from '../services/calendarApi';
import { sendWhatsAppMessage } from '../services/messageApi';
import {
  cancelScheduledMeeting,
  createScheduledMeeting,
  fetchScheduledMeetings,
  fetchScheduledNotifications,
} from '../services/scheduleApi';
import { fetchMessageTemplates, saveMessageTemplates } from '../services/messageTemplatesApi';
import {
  renderMessageTemplate,
  buildMessageTemplateVars,
  TEMPLATE_VARIABLES,
} from '../utils/messageTemplates';
import {
  mapDbAssessorToOption,
  getAssessorPhoneFromItem,
  getAssessorEmailFromItem,
} from '../utils/assessor';
import AdminNav from '../components/AdminNav';
import { formatDateToBr, formatDateTimeBr } from '../utils/dateFormat';
import { statusLabel } from '../utils/scheduleStatus';
import { clearAuthSession, getAuthSession, isAdminSession } from '../utils/authSession';

const createDateOptions = (daysAhead = 60) => {
  const options = [];
  const now = new Date();
  for (let i = 0; i < daysAhead; i += 1) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const iso = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    options.push({ value: iso, label });
  }
  return options;
};

const createTimeOptions = (stepMinutes = 30) => {
  const options = [];
  for (let hour = 8; hour <= 20; hour += 1) {
    for (let min = 0; min < 60; min += stepMinutes) {
      const value = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      options.push(value);
    }
  }
  return options;
};

const cleanPhoneValue = (value = '') => {
  let raw = String(value || '').trim();
  if (!raw) return '';

  // Corrige números vindos de Sheets em notação científica.
  if (/^\d+(\.\d+)?e\+\d+$/i.test(raw)) {
    const num = Number(raw);
    if (Number.isFinite(num)) {
      raw = Math.trunc(num).toString();
    }
  }

  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  // Remove prefixos de saída internacional e zeros à esquerda.
  if (digits.startsWith('00')) digits = digits.slice(2);
  digits = digits.replace(/^0+/, '');

  // Normalização padrão BR para envio WhatsApp.
  if (digits.startsWith('55')) {
    digits = digits.slice(0, 13);
  } else if (digits.length === 11 || digits.length === 10) {
    digits = `55${digits}`;
  } else if (digits.length > 13) {
    digits = digits.slice(0, 13);
  }

  return digits;
};

const formatWhatsappDisplay = (normalizedDigits = '') => {
  if (!normalizedDigits) return '';
  const digits = normalizedDigits.startsWith('55')
    ? normalizedDigits.slice(2)
    : normalizedDigits;

  const ddd = digits.slice(0, 2);
  const partA = digits.length >= 10 ? digits.slice(2, 7) : digits.slice(2, 6);
  const partB = digits.length >= 10 ? digits.slice(7, 11) : digits.slice(6, 10);

  return `+55 (${ddd}) ${partA}-${partB}`;
};

const normalizePhoneForApi = (value = '') => cleanPhoneValue(value);

const sendActionLog = async (payload) => {
  try {
    await fetch('/api/actions/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error('Falha ao registrar auditoria no PostgreSQL', error);
  }
};

const defaultAssessorForm = { name: '', phone: '', email: '' };

const findAssessorInList = (list, { assessorId, assessorName }) =>
  list.find(
    (item) =>
      (assessorId && String(item.dbId) === String(assessorId)) ||
      (assessorName && item.label === assessorName)
  );

const SDR = () => {
  const navigate = useNavigate();
  const dateOptions = createDateOptions();
  const timeOptions = createTimeOptions(30);
  const authSession = getAuthSession();
  const authUser = authSession.name || 'Usuário';
  const isAdmin = isAdminSession(authSession);

  const [formData, setFormData] = useState({
    assessor: '',
    assessorId: null,
    cliente: '',
    data: new Date().toISOString().split('T')[0],
    horario: '',
    whatsappAssessor: '',
    whatsappCliente: '',
    mensagemCliente: '',
    mensagemAssessor: '',
    origem: 'Farol SDR'
  });

  const [assessores, setAssessores] = useState([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [formError, setFormError] = useState('');
  const [status, setStatus] = useState('idle');
  const [selectorModal, setSelectorModal] = useState({ open: false });
  const [searchTerm, setSearchTerm] = useState('');
  const [assessorForm, setAssessorForm] = useState(defaultAssessorForm);
  const [editingAssessorId, setEditingAssessorId] = useState(null);
  const [assessorFormError, setAssessorFormError] = useState('');
  const [savingAssessor, setSavingAssessor] = useState(false);
  const clienteMessageRef = useRef(null);
  const assessorMessageRef = useRef(null);
  const [messageTemplates, setMessageTemplates] = useState(null);
  const [templateDraft, setTemplateDraft] = useState({ cliente: '', assessor: '' });
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templateSaveStatus, setTemplateSaveStatus] = useState('idle');
  const [templateError, setTemplateError] = useState('');
  const [scheduledMeetings, setScheduledMeetings] = useState([]);
  const [scheduledNotifications, setScheduledNotifications] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [cancellingMeetingId, setCancellingMeetingId] = useState(null);
  const authToken = authSession.token;

  const loadScheduleBoard = async () => {
    setScheduleLoading(true);
    try {
      const [meetingsPayload, notificationsPayload] = await Promise.all([
        fetchScheduledMeetings({ limit: 50 }),
        fetchScheduledNotifications({ limit: 100 }),
      ]);
      setScheduledMeetings(meetingsPayload.rows || []);
      setScheduledNotifications(notificationsPayload.rows || []);
    } catch (error) {
      console.error('Falha ao carregar agenda de follow-ups', error);
    } finally {
      setScheduleLoading(false);
    }
  };

  const handleCancelMeeting = async (item) => {
    const label = `${item.cliente} · ${formatDateToBr(item.meetingDate)} às ${item.meetingTime}`;
    if (!window.confirm(`Cancelar esta reunião?\n\n${label}\n\nOs follow-ups pendentes deixarão de ser enviados.`)) {
      return;
    }

    setCancellingMeetingId(item.id);
    try {
      await cancelScheduledMeeting(item.id);
      await loadScheduleBoard();
      await sendActionLog({
        actionType: 'sdr_cancel',
        actionStatus: 'success',
        assessor: item.assessor,
        cliente: item.cliente,
        scheduleDate: item.meetingDate,
        scheduleTime: item.meetingTime,
        source: item.source || 'Farol SDR',
        phoneCliente: item.phoneCliente,
        phoneAssessor: item.phoneAssessor,
        detail: { meetingId: item.id },
      });
    } catch (error) {
      window.alert(error.message || 'Não foi possível cancelar a reunião.');
    } finally {
      setCancellingMeetingId(null);
    }
  };

  const authFetch = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || 'Falha na requisição');
    }
    return payload;
  };

  const loadAssessores = async () => {
    setLoadingLists(true);
    setFormError('');
    try {
      if (!authToken) {
        setAssessores([]);
        setFormError('Faça login para carregar os assessores.');
        return;
      }
      const payload = await authFetch('/api/assessores');
      const list = (payload.rows || []).map(mapDbAssessorToOption);
      setAssessores(list);
      if (!list.length) {
        setFormError('Nenhum assessor cadastrado. Abra o seletor e cadastre o primeiro.');
      }
    } catch (error) {
      console.error('Erro ao carregar assessores', error);
      setFormError(error.message || 'Não foi possível carregar os assessores.');
      setAssessores([]);
    } finally {
      setLoadingLists(false);
    }
  };

  const loadMessageTemplates = async () => {
    setTemplatesLoading(true);
    setTemplateError('');
    try {
      const templates = await fetchMessageTemplates();
      setMessageTemplates(templates);
      setTemplateDraft(templates);
    } catch (error) {
      setTemplateError(error.message || 'Não foi possível carregar as copys.');
    } finally {
      setTemplatesLoading(false);
    }
  };

  useEffect(() => {
    loadAssessores();
    loadMessageTemplates();
    loadScheduleBoard();
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('sdr_form_data_v2');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const { mensagemCliente, mensagemAssessor, ...rest } = parsed;
        setFormData((prev) => ({ ...prev, ...rest }));
      } catch (e) {}
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const { mensagemCliente, mensagemAssessor, ...persistable } = formData;
      localStorage.setItem('sdr_form_data_v2', JSON.stringify(persistable));
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    }, 1000);
    return () => clearTimeout(timer);
  }, [formData]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleTemplateDraftChange = (e) => {
    const { name, value } = e.target;
    setTemplateDraft((prev) => ({ ...prev, [name]: value }));
  };

  const handleSaveTemplates = async () => {
    setTemplateSaveStatus('saving');
    setTemplateError('');
    try {
      const templates = await saveMessageTemplates(templateDraft);
      setMessageTemplates(templates);
      setTemplateDraft(templates);
      setTemplateSaveStatus('success');
    } catch (error) {
      setTemplateError(error.message || 'Falha ao salvar copys.');
      setTemplateSaveStatus('error');
    }
    setTimeout(() => setTemplateSaveStatus('idle'), 3000);
  };

  const resetAssessorForm = () => {
    setAssessorForm(defaultAssessorForm);
    setEditingAssessorId(null);
    setAssessorFormError('');
  };

  const openAssessorModal = () => {
    setSearchTerm('');
    resetAssessorForm();
    setSelectorModal({ open: true });
  };

  const closeSelectorModal = () => {
    setSelectorModal({ open: false });
    setSearchTerm('');
    resetAssessorForm();
  };

  const handleAssessorSelect = (item) => {
    setFormData((prev) => ({ ...prev, assessor: item.label, assessorId: item.dbId }));
    closeSelectorModal();
  };

  const handleAssessorFormChange = (e) => {
    const { name, value } = e.target;
    setAssessorForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleEditAssessor = (item, event) => {
    event.stopPropagation();
    setEditingAssessorId(item.dbId);
    setAssessorForm({
      name: item.label,
      phone: item.phone || getAssessorPhoneFromItem(item, cleanPhoneValue),
      email: item.email || getAssessorEmailFromItem(item),
    });
    setAssessorFormError('');
  };

  const handleDeleteAssessor = async (item, event) => {
    event.stopPropagation();
    if (!window.confirm(`Remover "${item.label}" da lista?`)) return;

    setSavingAssessor(true);
    setAssessorFormError('');
    try {
      await authFetch(`/api/assessores/${item.dbId}`, { method: 'DELETE' });
      if (String(formData.assessorId) === String(item.dbId)) {
        setFormData((prev) => ({ ...prev, assessor: '', assessorId: null }));
      }
      await loadAssessores();
    } catch (error) {
      setAssessorFormError(error.message);
    } finally {
      setSavingAssessor(false);
    }
  };

  const handleSaveAssessor = async (e) => {
    e.preventDefault();
    setSavingAssessor(true);
    setAssessorFormError('');
    try {
      const body = {
        name: assessorForm.name.trim(),
        phone: assessorForm.phone,
        email: assessorForm.email.trim(),
      };

      let row;
      if (editingAssessorId) {
        const payload = await authFetch(`/api/assessores/${editingAssessorId}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        row = payload.row;
      } else {
        const payload = await authFetch('/api/assessores', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        row = payload.row;
      }

      await loadAssessores();
      if (editingAssessorId) {
        if (String(formData.assessorId) === String(row.id)) {
          setFormData((prev) => ({ ...prev, assessor: row.name, assessorId: row.id }));
        }
        resetAssessorForm();
      } else {
        const saved = mapDbAssessorToOption(row);
        setFormData((prev) => ({
          ...prev,
          assessor: saved.label,
          assessorId: saved.dbId,
        }));
        closeSelectorModal();
      }
    } catch (error) {
      setAssessorFormError(error.message);
    } finally {
      setSavingAssessor(false);
    }
  };

  const filteredAssessores = assessores.filter((item) =>
    item.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const autoGrowTextarea = (ref) => {
    if (!ref?.current) return;
    ref.current.style.height = 'auto';
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('sending');
    try {
      const clienteNome = String(formData.cliente || '').trim();
      if (!formData.assessor || !clienteNome) {
        setStatus('error');
        setFormError('Informe o assessor e o nome do lead antes de enviar.');
        setTimeout(() => setStatus('idle'), 5000);
        return;
      }

      const phoneCliente = normalizePhoneForApi(formData.whatsappCliente);
      const phoneAssessor = normalizePhoneForApi(formData.whatsappAssessor);
      const assessorSelecionado = findAssessorInList(assessores, {
        assessorId: formData.assessorId,
        assessorName: formData.assessor,
      });

      if (!phoneCliente) {
        setStatus('error');
        setFormError('Informe o WhatsApp do lead (com DDD).');
        setTimeout(() => setStatus('idle'), 5000);
        return;
      }

      if (!phoneAssessor) {
        setStatus('error');
        setFormError('Assessor sem WhatsApp. Edite o cadastro do assessor ou escolha outro.');
        setTimeout(() => setStatus('idle'), 5000);
        return;
      }

      if (!formData.data || !formData.horario) {
        setStatus('error');
        setFormError('Informe data e horário para criar o evento no calendário.');
        setTimeout(() => setStatus('idle'), 5000);
        return;
      }

      if (config.calendarEnabled) {
        const assessorEmail = assessorSelecionado ? getAssessorEmailFromItem(assessorSelecionado) : '';
        const calendarId = resolveAssessorCalendarId(formData.assessor);

        if (calendarId) {
          await scheduleMeeting({
            assessorName: formData.assessor,
            clienteName: clienteNome,
            clientePhone: phoneCliente,
            clienteEmail: '',
            assessorPhone: phoneAssessor,
            assessorEmail,
            isoDate: formData.data,
            horario: formData.horario,
            origem: formData.origem,
          });
        }
      }

      const messageVars = buildMessageTemplateVars({
        assessor: formData.assessor,
        cliente: clienteNome,
        whatsappAssessor: formatWhatsappDisplay(phoneAssessor),
        whatsappClienteFmt: formatWhatsappDisplay(phoneCliente),
        dataFormatada: formatDateToBr(formData.data),
        horarioTexto: formData.horario,
      });

      const mensagemCliente = renderMessageTemplate(messageTemplates?.cliente, messageVars);
      const mensagemAssessor = renderMessageTemplate(messageTemplates?.assessor, messageVars);

      if (!mensagemCliente || !mensagemAssessor) {
        throw new Error('Copys de mensagem não carregadas. Recarregue a página.');
      }

      await sendWhatsAppMessage(mensagemCliente, phoneCliente);
      await sendWhatsAppMessage(mensagemAssessor, phoneAssessor);

      await createScheduledMeeting({
        assessor: formData.assessor,
        cliente: clienteNome,
        meetingDate: formData.data,
        meetingTime: formData.horario,
        phoneCliente,
        phoneAssessor,
        source: formData.origem || 'Farol SDR',
      });
      await loadScheduleBoard();

      await sendActionLog({
          actionType: 'sdr_submit',
          actionStatus: 'success',
          assessor: formData.assessor,
          cliente: clienteNome,
          scheduleDate: formData.data,
          scheduleTime: formData.horario,
          source: formData.origem || 'Farol SDR',
          phoneCliente,
          phoneAssessor,
          detail: {
            calendarEnabled: Boolean(config.calendarEnabled),
          },
        });

        setStatus('success');
        localStorage.removeItem('sdr_form_data_v2');
        setFormData({
          assessor: '',
          assessorId: null,
          cliente: '',
          data: new Date().toISOString().split('T')[0],
          horario: '',
          whatsappAssessor: '',
          whatsappCliente: '',
          mensagemCliente: '',
          mensagemAssessor: '',
          origem: 'Farol SDR',
        });
        setFormError('');
    } catch (error) {
      await sendActionLog({
        actionType: 'sdr_submit',
        actionStatus: 'error',
        assessor: formData.assessor,
        cliente: formData.cliente,
        scheduleDate: formData.data,
        scheduleTime: formData.horario,
        source: formData.origem || 'Farol SDR',
        phoneCliente: normalizePhoneForApi(formData.whatsappCliente),
        phoneAssessor: normalizePhoneForApi(formData.whatsappAssessor),
        detail: {
          reason: error?.message || 'Falha ao enviar agendamento.',
        },
      });
      setStatus('error');
      setFormError(error?.message || 'Falha ao enviar agendamento.');
    }
    setTimeout(() => setStatus('idle'), 5000);
  };

  const assessorSelecionado = findAssessorInList(assessores, {
    assessorId: formData.assessorId,
    assessorName: formData.assessor,
  });

  const whatsappAssessorDigits = assessorSelecionado
    ? getAssessorPhoneFromItem(assessorSelecionado, cleanPhoneValue)
    : '';

  const messageVars = buildMessageTemplateVars({
    assessor: formData.assessor,
    cliente: formData.cliente,
    whatsappAssessor: formatWhatsappDisplay(whatsappAssessorDigits),
    whatsappClienteFmt:
      formatWhatsappDisplay(normalizePhoneForApi(formData.whatsappCliente)) ||
      formData.whatsappCliente,
    dataFormatada: formatDateToBr(formData.data),
    horarioTexto: formData.horario,
  });

  const templatesForPreview = isAdmin ? templateDraft : messageTemplates;
  const previewMensagemCliente = templatesForPreview?.cliente
    ? renderMessageTemplate(templatesForPreview.cliente, messageVars)
    : '';
  const previewMensagemAssessor = templatesForPreview?.assessor
    ? renderMessageTemplate(templatesForPreview.assessor, messageVars)
    : '';

  useEffect(() => {
    setFormData((prev) => (
      prev.whatsappAssessor === whatsappAssessorDigits
        ? prev
        : { ...prev, whatsappAssessor: whatsappAssessorDigits }
    ));
  }, [whatsappAssessorDigits]);

  useEffect(() => {
    autoGrowTextarea(clienteMessageRef);
  }, [previewMensagemCliente]);

  useEffect(() => {
    autoGrowTextarea(assessorMessageRef);
  }, [previewMensagemAssessor]);

  const handleLogout = () => {
    clearAuthSession();
    navigate('/login');
  };

  return (
    <div className="premium-container">
      <div className="glass-card animate-fade-in" style={{ maxWidth: '1240px', width: 'min(96vw, 1240px)' }}>
        <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', marginBottom: '0.5rem', background: 'linear-gradient(to right, #FFFFFF, #C3A457)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Agendamento de reunião
          </h1>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Logado como {authUser}</span>
            <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '0.4rem 1rem' }} onClick={handleLogout}>
              Sair
            </button>
          </div>
        </div>

        <AdminNav />

        <div style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
            <section style={{ border: '1px solid var(--glass-border)', borderRadius: '1rem', padding: '1rem' }}>
              <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Calendar size={16} />
                Próximas reuniões
              </h2>
              {scheduleLoading ? (
                <p style={{ color: 'var(--text-muted)', margin: 0 }}>Carregando...</p>
              ) : scheduledMeetings.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', margin: 0 }}>Nenhuma reunião agendada ainda.</p>
              ) : (
                <div style={{ display: 'grid', gap: '0.65rem', maxHeight: 260, overflowY: 'auto' }}>
                  {scheduledMeetings.map((item) => (
                    <div key={item.id} style={{ padding: '0.65rem', borderRadius: '0.65rem', background: 'rgba(255,255,255,0.03)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'flex-start' }}>
                        <strong>{item.cliente}</strong>
                        {item.canCancel && (
                          <button
                            type="button"
                            onClick={() => handleCancelMeeting(item)}
                            disabled={cancellingMeetingId === item.id}
                            title="Cancelar reunião e parar follow-ups"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              padding: '0.2rem 0.45rem',
                              fontSize: '0.72rem',
                              borderRadius: '0.4rem',
                              border: '1px solid rgba(239, 68, 68, 0.35)',
                              background: 'rgba(239, 68, 68, 0.08)',
                              color: '#fca5a5',
                              cursor: cancellingMeetingId === item.id ? 'wait' : 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <XCircle size={12} />
                            {cancellingMeetingId === item.id ? 'Cancelando...' : 'Cancelar'}
                          </button>
                        )}
                      </div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        Assessor: {item.assessor}
                      </div>
                      <div style={{ fontSize: '0.82rem', marginTop: '0.2rem' }}>
                        {formatDateToBr(item.meetingDate)} às {item.meetingTime}
                      </div>
                      {item.createdBy && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                          Agendado por {item.createdBy}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section style={{ border: '1px solid var(--glass-border)', borderRadius: '1rem', padding: '1rem' }}>
              <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Bell size={16} />
                Follow-ups programados
              </h2>
              {scheduleLoading ? (
                <p style={{ color: 'var(--text-muted)', margin: 0 }}>Carregando...</p>
              ) : scheduledNotifications.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', margin: 0 }}>Nenhum follow-up na fila.</p>
              ) : (
                <div style={{ display: 'grid', gap: '0.65rem', maxHeight: 260, overflowY: 'auto' }}>
                  {scheduledNotifications.map((item) => (
                    <div key={item.id} style={{ padding: '0.65rem', borderRadius: '0.65rem', background: 'rgba(255,255,255,0.03)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <strong>{item.title}</strong>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{statusLabel(item.status)}</span>
                      </div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                        {item.cliente} · Reunião {formatDateToBr(item.meetingDate)} {item.meetingTime}
                      </div>
                      <div style={{ fontSize: '0.82rem', marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Clock size={13} />
                        Envio: {formatDateTimeBr(item.scheduledAt)} → {item.recipientLabel}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
          <div className="selector-grid">
            <div className="selector-card">
              <label className="selector-label">
                <Users size={16} />
                <span>Assessor</span>
                <small>{assessores.length} opções</small>
              </label>
              <button
                type="button"
                className="modern-select as-button"
                onClick={openAssessorModal}
              >
                {formData.assessor || 'Selecione um Assessor'}
              </button>
            </div>
            <div className="selector-card lead-card">
              <label className="selector-label">
                <UserPlus size={16} />
                <span>Lead novo</span>
              </label>
              <input
                type="text"
                className="modern-select"
                name="cliente"
                placeholder="Nome do lead"
                value={formData.cliente}
                onChange={handleChange}
                autoComplete="name"
                required
              />
              <div className="input-group lead-phone-input">
                <Phone size={18} />
                <input
                  type="tel"
                  className="modern-select with-icon"
                  name="whatsappCliente"
                  placeholder="WhatsApp (DDD + número)"
                  value={formData.whatsappCliente}
                  onChange={handleChange}
                  autoComplete="tel"
                  required
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="input-group">
              <Calendar size={18} />
              <select className="modern-select" name="data" value={formData.data} onChange={handleChange} required>
                <option value="" disabled>Selecione a data</option>
                {dateOptions.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
            <div className="input-group">
              <Calendar size={18} />
              <select className="modern-select" name="horario" value={formData.horario} onChange={handleChange} required>
                <option value="" disabled>Selecione o horário</option>
                {timeOptions.map((time) => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="message-grid">
            <div className="message-shell light-shell">
              <div className="message-shell-header">
                <div className="message-shell-title dark-title">
                  <Sparkles size={16} />
                  <span>Mensagem para Cliente</span>
                </div>
                <small>{isAdmin ? 'Modelo editável (admin)' : 'Prévia automática'}</small>
              </div>
              <div className="recipient-box">
                <div><strong>Destino:</strong> {formData.cliente || 'Nome do lead não informado'}</div>
                <div><strong>WhatsApp de envio:</strong> {formatWhatsappDisplay(normalizePhoneForApi(formData.whatsappCliente)) || formData.whatsappCliente || 'Informe o WhatsApp do lead'}</div>
              </div>
              {isAdmin && (
                <div className="input-group" style={{ marginBottom: '0.75rem' }}>
                  <MessageSquare size={18} style={{ top: '1.25rem', transform: 'none' }} />
                  <textarea
                    name="cliente"
                    placeholder="Modelo da copy para cliente"
                    value={templateDraft.cliente}
                    onChange={handleTemplateDraftChange}
                    rows="8"
                    style={{ width: '100%', padding: '1rem 1rem 1rem 3.5rem', background: '#FFF8E8', border: '1px solid #C3A457', borderRadius: '1rem', color: '#14161B', resize: 'vertical', minHeight: '180px' }}
                  />
                </div>
              )}
              <div className="input-group">
                <MessageSquare size={18} style={{ top: '1.25rem', transform: 'none' }} />
                <textarea
                  ref={clienteMessageRef}
                  name="mensagemCliente"
                  placeholder={templatesLoading ? 'Carregando copy...' : 'Mensagem para cliente'}
                  value={previewMensagemCliente}
                  readOnly
                  rows="10"
                  style={{ width: '100%', padding: '1rem 1rem 1rem 3.5rem', background: '#F0E9E9', border: '1px solid #B0A986', borderRadius: '1rem', color: '#14161B', resize: 'none', overflow: 'hidden', minHeight: '260px' }}
                />
              </div>
            </div>

            <div className="message-shell light-shell">
              <div className="message-shell-header">
                <div className="message-shell-title dark-title">
                  <Sparkles size={16} />
                  <span>Mensagem para Assessor</span>
                </div>
                <small>{isAdmin ? 'Modelo editável (admin)' : 'Prévia automática'}</small>
              </div>
              <div className="recipient-box">
                <div><strong>Destino:</strong> {formData.assessor || 'Assessor não selecionado'}</div>
                <div><strong>WhatsApp de envio:</strong> {formatWhatsappDisplay(formData.whatsappAssessor) || 'Não cadastrado para o assessor'}</div>
              </div>
              {isAdmin && (
                <div className="input-group" style={{ marginBottom: '0.75rem' }}>
                  <MessageSquare size={18} style={{ top: '1.25rem', transform: 'none' }} />
                  <textarea
                    name="assessor"
                    placeholder="Modelo da copy para assessor"
                    value={templateDraft.assessor}
                    onChange={handleTemplateDraftChange}
                    rows="8"
                    style={{ width: '100%', padding: '1rem 1rem 1rem 3.5rem', background: '#FFF8E8', border: '1px solid #C3A457', borderRadius: '1rem', color: '#14161B', resize: 'vertical', minHeight: '180px' }}
                  />
                </div>
              )}
              <div className="input-group">
                <MessageSquare size={18} style={{ top: '1.25rem', transform: 'none' }} />
                <textarea
                  ref={assessorMessageRef}
                  name="mensagemAssessor"
                  placeholder={templatesLoading ? 'Carregando copy...' : 'Mensagem para assessor'}
                  value={previewMensagemAssessor}
                  readOnly
                  rows="10"
                  style={{ width: '100%', padding: '1rem 1rem 1rem 3.5rem', background: '#F0E9E9', border: '1px solid #B0A986', borderRadius: '1rem', color: '#14161B', resize: 'none', overflow: 'hidden', minHeight: '260px' }}
                />
              </div>
            </div>
          </div>

          {isAdmin && (
            <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Variáveis: {TEMPLATE_VARIABLES.map((v) => `{{${v.key}}} (${v.label})`).join(' · ')}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ width: 'auto', padding: '0.65rem 1.5rem' }}
                  onClick={handleSaveTemplates}
                  disabled={templateSaveStatus === 'saving' || templatesLoading}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Save size={16} />
                    {templateSaveStatus === 'saving' ? 'Salvando copys...' : 'Salvar copys'}
                  </span>
                </button>
                {templateSaveStatus === 'success' && (
                  <span style={{ color: '#4ade80', fontSize: '0.875rem' }}>Copys salvas com sucesso.</span>
                )}
                {templateSaveStatus === 'error' && !!templateError && (
                  <span style={{ color: '#f87171', fontSize: '0.875rem' }}>{templateError}</span>
                )}
              </div>
            </div>
          )}

          {!isAdmin && !!templateError && (
            <div className="status-msg error" style={{ marginTop: '1rem' }}>{templateError}</div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
              <Save size={14} />
              <span>{status === 'saved' ? 'Sincronizado' : 'Salvando...'}</span>
            </div>
            
            <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '0.75rem 2.5rem' }} disabled={status === 'sending' || loadingLists || templatesLoading || !messageTemplates}>
              {status === 'sending' ? 'Enviando...' : (
                <><span>Disparar Registro</span><Send size={18} /></>
              )}
            </button>
          </div>

          {status === 'success' && <div className="status-msg success">Registro enviado com sucesso!</div>}
          {status === 'error' && <div className="status-msg error">Erro ao enviar para a API. Verifique os dados.</div>}
          {!!formError && <div className="status-msg error">{formError}</div>}
        </form>
      </div>

      {selectorModal.open && (
        <div className="selector-modal-overlay" onClick={closeSelectorModal}>
          <div className="selector-modal" onClick={(e) => e.stopPropagation()}>
            <div className="selector-modal-header">
              <h3>Selecionar Assessor</h3>
              <button type="button" className="modal-close-btn" onClick={closeSelectorModal}>Fechar</button>
            </div>
            <form className="modal-new-assessor" onSubmit={handleSaveAssessor}>
              <div className="modal-new-title">
                <Plus size={16} />
                <span>{editingAssessorId ? 'Editar assessor' : 'Novo assessor'}</span>
              </div>
              <input
                className="modal-search"
                type="text"
                name="name"
                placeholder="Nome completo"
                value={assessorForm.name}
                onChange={handleAssessorFormChange}
                required
              />
              <input
                className="modal-search"
                type="tel"
                name="phone"
                placeholder="WhatsApp (DDD + número)"
                value={assessorForm.phone}
                onChange={handleAssessorFormChange}
                required
              />
              <input
                className="modal-search"
                type="email"
                name="email"
                placeholder="E-mail (opcional)"
                value={assessorForm.email}
                onChange={handleAssessorFormChange}
              />
              <div className="modal-form-actions">
                {editingAssessorId && (
                  <button type="button" className="modal-close-btn" onClick={resetAssessorForm}>
                    Cancelar edição
                  </button>
                )}
                <button type="submit" className="btn-primary modal-save-btn" disabled={savingAssessor}>
                  {savingAssessor ? 'Salvando...' : editingAssessorId ? 'Salvar alterações' : 'Cadastrar assessor'}
                </button>
              </div>
              {!!assessorFormError && <div className="modal-form-error">{assessorFormError}</div>}
            </form>

            <input
              className="modal-search modal-search-list"
              type="text"
              placeholder="Pesquisar assessor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <div className="modal-list">
              {filteredAssessores.map((item) => (
                <div
                  key={item.id}
                  className={`modal-list-row ${String(formData.assessorId) === String(item.dbId) ? 'active' : ''}`}
                >
                  <button
                    type="button"
                    className="modal-list-item"
                    onClick={() => handleAssessorSelect(item)}
                  >
                    <span className="modal-list-name">{item.label}</span>
                  </button>
                  <div className="modal-list-actions">
                    <button
                      type="button"
                      className="modal-icon-btn"
                      title="Editar"
                      onClick={(e) => handleEditAssessor(item, e)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="modal-icon-btn danger"
                      title="Remover"
                      onClick={(e) => handleDeleteAssessor(item, e)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
              {!filteredAssessores.length && (
                <div className="modal-empty">Nenhum resultado encontrado.</div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .selector-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        .selector-card { background: rgba(27, 31, 64, 0.82); border: 1px solid rgba(195,164,87,0.35); border-radius: 1rem; padding: 0.75rem; }
        .lead-card { display: flex; flex-direction: column; gap: 0.65rem; }
        .lead-phone-input { margin-top: 0; }
        .lead-phone-input .with-icon { padding-left: 3rem; width: 100%; }
        .selector-label { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; font-size: 0.8rem; color: rgba(255,255,255,0.9); }
        .selector-label small { margin-left: auto; color: #B0A986; font-size: 0.7rem; }
        select { appearance: none; cursor: pointer; }
        .modern-select { width: 100%; border-radius: 0.9rem; border: 1px solid #2E3138; background: #14161B; color: white; padding: 0.85rem 1rem; font-size: 0.95rem; }
        .modern-select:focus { outline: none; border-color: #C3A457; box-shadow: 0 0 0 2px rgba(195,164,87,0.18); }
        .as-button { text-align: left; cursor: pointer; }
        select option { background: #14161B; color: #FFFFFF; }
        .selector-modal-overlay {
          position: fixed; inset: 0; background: rgba(0, 0, 0, 0.68); backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 1rem;
        }
        .selector-modal {
          width: min(640px, 100%);
          max-height: 80vh;
          background: #161B39;
          border: 1px solid rgba(195,164,87,0.38);
          border-radius: 1rem;
          box-shadow: 0 20px 60px rgba(0,0,0,0.5);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .selector-modal-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 1rem; border-bottom: 1px solid rgba(195,164,87,0.2);
        }
        .selector-modal-header h3 { margin: 0; font-size: 1rem; color: #fff; }
        .modal-close-btn {
          background: #1B1F40; border: 1px solid rgba(195,164,87,0.42); color: #E8E6E6;
          border-radius: 0.5rem; padding: 0.4rem 0.65rem; cursor: pointer;
        }
        .modal-new-assessor {
          padding: 0.75rem 1rem 0.5rem;
          border-bottom: 1px solid rgba(195,164,87,0.2);
          display: grid;
          gap: 0.55rem;
        }
        .modal-new-title {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          font-size: 0.85rem;
          font-weight: 600;
          color: #C3A457;
        }
        .modal-form-actions {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
          align-items: center;
        }
        .modal-save-btn { width: auto; padding: 0.55rem 1rem; font-size: 0.85rem; margin: 0; }
        .modal-form-error { color: #ffb4b4; font-size: 0.8rem; margin-top: 0.25rem; }
        .modal-search {
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid rgba(195,164,87,0.28);
          background: #111327;
          color: #E8E6E6;
          padding: 0.75rem 0.85rem;
        }
        .modal-search-list { margin: 0.75rem 1rem 0; width: calc(100% - 2rem); }
        .modal-search:focus { outline: none; border-color: #C3A457; }
        .modal-list { overflow: auto; padding: 0.75rem 0.9rem 1rem; display: grid; gap: 0.6rem; flex: 1; }
        .modal-list-row {
          display: flex;
          align-items: stretch;
          gap: 0.35rem;
          border-radius: 0.6rem;
          border: 1px solid transparent;
        }
        .modal-list-row.active { border-color: #C3A457; background: rgba(195,164,87,0.12); }
        .modal-list-item {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          text-align: left;
          background: #111327;
          border: none;
          color: #fff;
          border-radius: 0.6rem;
          min-height: 52px;
          padding: 0.75rem 0.85rem;
          cursor: pointer;
          font-size: 0.92rem;
          line-height: 1.35;
        }
        .modal-list-item:hover { background: #1B1F40; }
        .modal-list-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .modal-list-tag {
          font-size: 0.65rem;
          text-transform: uppercase;
          color: #B0A986;
          border: 1px solid rgba(176,169,134,0.5);
          border-radius: 0.35rem;
          padding: 0.1rem 0.35rem;
        }
        .modal-list-actions { display: flex; gap: 0.25rem; padding-right: 0.35rem; align-items: center; }
        .modal-icon-btn {
          background: #1B1F40;
          border: 1px solid rgba(195,164,87,0.35);
          color: #E8E6E6;
          border-radius: 0.45rem;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .modal-icon-btn:hover { border-color: #C3A457; }
        .modal-icon-btn.danger:hover { border-color: #e57373; color: #ffcdd2; }
        .modal-empty { color: #A0A09F; padding: 0.75rem; font-size: 0.9rem; }
        .message-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; align-items: start; }
        .message-shell { border: 1px solid var(--glass-border); border-radius: 1rem; padding: 0.75rem; background: rgba(255,255,255,0.02); }
        .light-shell { background: rgba(240,233,233,0.9); border: 1px solid rgba(176,169,134,0.8); }
        .message-shell-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; gap: 0.75rem; }
        .message-shell-title { display: flex; align-items: center; gap: 0.45rem; font-size: 0.82rem; color: rgba(255,255,255,0.88); }
        .dark-title { color: #161B39; font-size: 0.9rem; }
        .message-shell-header small { color: #2E3138; font-size: 0.75rem; font-weight: 600; }
        .recipient-box { background: #FFFFFF; border: 1px solid #B0A986; color: #14161B; border-radius: 0.75rem; padding: 0.7rem 0.8rem; margin-bottom: 0.7rem; font-size: 0.82rem; line-height: 1.45; }
        .recipient-box strong { color: #161B39; }
        .status-msg { padding: 1rem; border-radius: 0.75rem; text-align: center; font-size: 0.875rem; animation: fadeIn 0.3s ease-out; }
        .status-msg.success { background: rgba(195,164,87,0.16); color: #C3A457; border: 1px solid rgba(195,164,87,0.45); }
        .status-msg.error { background: rgba(46,49,56,0.3); color: #E8E6E6; border: 1px solid rgba(108,113,122,0.6); }
        @media (max-width: 800px) {
          .selector-grid { grid-template-columns: 1fr; }
          .message-grid { grid-template-columns: 1fr; }
          .message-shell-header { flex-direction: column; align-items: flex-start; }
        }
      `}</style>
    </div>
  );
};

export default SDR;
