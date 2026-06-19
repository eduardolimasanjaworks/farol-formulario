import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Plus,
  Pencil,
  Trash2,
  Clock,
  User,
  Briefcase,
  Phone,
  X,
  LogOut,
  Send,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import {
  createNotificationTemplate,
  deleteNotificationTemplate,
  fetchNotificationTemplates,
  updateNotificationTemplate,
} from '../services/notificationTemplatesApi';
import { TEMPLATE_VARIABLES } from '../utils/messageTemplates';
import AdminNav from '../components/AdminNav';
import { clearAuthSession, getAuthSession } from '../utils/authSession';
import '../styles/notifications-admin.css';

const defaultForm = {
  title: '',
  notificationType: 'event',
  offsetDays: 0,
  offsetHours: 0,
  offsetMinutes: 30,
  moment: 'before',
  recipient: 'cliente',
  messageBody: '',
  thirdPartyPhone: '',
  isActive: true,
  sortOrder: 0,
};

const RECIPIENT_OPTIONS = [
  { key: 'cliente', label: 'Cliente', subtitle: 'Lead / participante', icon: User },
  { key: 'assessor', label: 'Assessor', subtitle: 'Consultor da reunião', icon: Briefcase },
  { key: 'terceiro', label: 'Terceiro', subtitle: 'WhatsApp externo', icon: Phone },
];

const RECIPIENT_LABELS = {
  cliente: 'Cliente',
  assessor: 'Assessor',
  terceiro: 'Terceiro',
};

const formatScheduleLabel = (row) => {
  const parts = [];
  if (row.offsetDays) parts.push(`${row.offsetDays} dia${row.offsetDays > 1 ? 's' : ''}`);
  if (row.offsetHours) parts.push(`${row.offsetHours} hora${row.offsetHours > 1 ? 's' : ''}`);
  if (row.offsetMinutes) parts.push(`${row.offsetMinutes} min`);
  const offset = parts.join(', ') || '0 min';
  const when = row.moment === 'after' ? 'depois' : 'antes';
  return `${offset} ${when} da reunião`;
};

const NotificationsAdmin = () => {
  const navigate = useNavigate();
  const token = getAuthSession().token;
  const [rows, setRows] = useState([]);
  const [formData, setFormData] = useState(defaultForm);
  const [editingId, setEditingId] = useState(null);
  const [status, setStatus] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);

  const loadRows = async () => {
    try {
      const payload = await fetchNotificationTemplates();
      setRows(payload.rows || []);
    } catch (error) {
      setStatus(error.message);
    }
  };

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    loadRows();
  }, []);

  const clearForm = () => {
    setFormData(defaultForm);
    setEditingId(null);
    setPanelOpen(false);
  };

  const openCreate = (recipient = 'cliente') => {
    setFormData({ ...defaultForm, recipient });
    setEditingId(null);
    setPanelOpen(true);
    setStatus('');
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    setFormData({
      title: row.title,
      notificationType: row.notificationType || 'event',
      offsetDays: row.offsetDays,
      offsetHours: row.offsetHours,
      offsetMinutes: row.offsetMinutes,
      moment: row.moment,
      recipient: row.recipient,
      messageBody: row.messageBody,
      thirdPartyPhone: row.thirdPartyPhone || '',
      isActive: row.isActive,
      sortOrder: row.sortOrder || 0,
    });
    setPanelOpen(true);
    setStatus('');
  };

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const bumpOffset = (field, delta) => {
    setFormData((prev) => ({
      ...prev,
      [field]: Math.max(0, (Number(prev[field]) || 0) + delta),
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus('');
    try {
      const payload = {
        ...formData,
        notificationType: 'event',
        offsetDays: Number(formData.offsetDays) || 0,
        offsetHours: Number(formData.offsetHours) || 0,
        offsetMinutes: Number(formData.offsetMinutes) || 0,
        sortOrder: Number(formData.sortOrder) || 0,
      };
      if (editingId) {
        await updateNotificationTemplate(editingId, payload);
      } else {
        await createNotificationTemplate(payload);
      }
      await loadRows();
      clearForm();
      setStatus('Notificação salva com sucesso.');
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Remover esta notificação da cadência?')) return;
    setStatus('');
    try {
      await deleteNotificationTemplate(id);
      await loadRows();
      if (editingId === id) clearForm();
      setStatus('Notificação removida.');
    } catch (error) {
      setStatus(error.message);
    }
  };

  const logout = () => {
    clearAuthSession();
    navigate('/login');
  };

  const isSuccessStatus = status.includes('sucesso') || status.includes('removida');

  return (
    <div className="premium-container notif-admin-wrap">
      <div className="glass-card animate-fade-in notif-admin-page">
        <AdminNav />

        <header className="notif-admin-header">
          <div>
            <h1 className="notif-admin-title">
              <Bell size={24} />
              Cadência de notificações
            </h1>
            <p className="notif-admin-subtitle">
              Follow-ups automáticos enviados via WhatsApp antes ou depois de cada reunião agendada no SDR.
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
          <span className="notif-toolbar-count">{rows.length} notificação(ões) na cadência</span>
          <button type="button" className="btn-pill btn-pill-primary" onClick={() => openCreate('cliente')}>
            <Plus size={16} />
            Nova notificação
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="notif-empty-state">
            <h3>Ops! Nenhuma notificação criada.</h3>
            <p>Crie notificações de evento e potencialize os seus atendimentos.</p>
            <button type="button" className="btn-pill btn-pill-primary" onClick={() => openCreate('cliente')}>
              <Plus size={16} />
              Add notificação
            </button>
          </div>
        ) : (
          <div className="notif-table-wrap">
            <table className="notif-table">
              <thead>
                <tr>
                  <th>Mensagem</th>
                  <th>Contato</th>
                  <th>Data</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const recipientKey = ['cliente', 'assessor', 'terceiro'].includes(row.recipient)
                    ? row.recipient
                    : 'terceiro';
                  return (
                    <tr key={row.id} className={row.isActive ? '' : 'notif-table-row--inactive'}>
                      <td className="notif-table-cell-message">
                        <div className="notif-table-title">{row.title}</div>
                        <p className="notif-table-message">{row.messageBody}</p>
                      </td>
                      <td className="notif-table-cell-contact">
                        <span className={`notif-contact-badge notif-contact-badge--${recipientKey}`}>
                          {RECIPIENT_LABELS[recipientKey]}
                        </span>
                        {recipientKey === 'terceiro' && row.thirdPartyPhone && (
                          <small className="notif-table-phone">{row.thirdPartyPhone}</small>
                        )}
                      </td>
                      <td className="notif-table-cell-date">
                        <span className="notif-date-chip">
                          <Clock size={13} />
                          {formatScheduleLabel(row)}
                        </span>
                        {!row.isActive && <span className="notif-inactive-tag">Inativa</span>}
                      </td>
                      <td className="notif-table-cell-actions">
                        <button
                          type="button"
                          className="btn-pill btn-pill-ghost btn-pill-icon"
                          title="Editar"
                          onClick={() => startEdit(row)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn-pill btn-pill-danger btn-pill-icon"
                          title="Excluir"
                          onClick={() => handleDelete(row.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {panelOpen && (
          <div className="notif-drawer-overlay" onClick={clearForm} role="presentation">
            <form
              className="notif-drawer"
              onSubmit={handleSubmit}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="notif-drawer-header">
                <h2>{editingId ? 'Editar notificação' : 'Criar notificação'}</h2>
                <button type="button" className="btn-pill btn-pill-ghost btn-pill-icon" onClick={clearForm}>
                  <X size={18} />
                </button>
              </div>

              <div className="notif-drawer-body">
                <div className="notif-field">
                  <label className="notif-field-label" htmlFor="notif-title">
                    Título da notificação *
                  </label>
                  <input
                    id="notif-title"
                    className="notif-input"
                    name="title"
                    value={formData.title}
                    onChange={handleChange}
                    placeholder="Ex.: Lembrete 1 dia antes"
                    required
                  />
                </div>

                <div className="notif-field">
                  <span className="notif-field-label">Quem recebe? *</span>
                  <div className="notif-recipient-picker">
                    {RECIPIENT_OPTIONS.map(({ key, label, subtitle, icon: Icon }) => (
                      <button
                        key={key}
                        type="button"
                        className={`notif-recipient-option ${key} ${formData.recipient === key ? 'selected' : ''}`}
                        onClick={() => setFormData((prev) => ({ ...prev, recipient: key }))}
                      >
                        <Icon size={20} style={{ marginBottom: '0.25rem' }} />
                        <strong>{label}</strong>
                        <small>{subtitle}</small>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="notif-timing-block">
                  <div className="notif-timing-block-title">
                    <Send size={15} />
                    Envio da notificação
                  </div>
                  <div className="notif-offset-grid">
                    {[
                      ['offsetDays', 'Dias'],
                      ['offsetHours', 'Horas'],
                      ['offsetMinutes', 'Minutos'],
                    ].map(([field, label]) => (
                      <div key={field} className="notif-offset-item">
                        <div className="notif-offset-label">{label}</div>
                        <div className="notif-offset-value">{formData[field]}</div>
                        <div className="notif-offset-controls">
                          <button
                            type="button"
                            className="btn-pill btn-pill-step"
                            onClick={() => bumpOffset(field, 1)}
                            aria-label={`Aumentar ${label}`}
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            type="button"
                            className="btn-pill btn-pill-step"
                            onClick={() => bumpOffset(field, -1)}
                            aria-label={`Diminuir ${label}`}
                          >
                            <ChevronDown size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="notif-field">
                    <label className="notif-field-label" htmlFor="notif-moment">
                      Em que momento?
                    </label>
                    <select
                      id="notif-moment"
                      className="notif-select"
                      name="moment"
                      value={formData.moment}
                      onChange={handleChange}
                    >
                      <option value="before">Antes da reunião</option>
                      <option value="after">Depois da reunião</option>
                    </select>
                  </div>
                </div>

                <div className="notif-field">
                  <label className="notif-field-label" htmlFor="notif-message">
                    Texto da mensagem *
                  </label>
                  <textarea
                    id="notif-message"
                    className="notif-textarea"
                    name="messageBody"
                    value={formData.messageBody}
                    onChange={handleChange}
                    rows={7}
                    required
                    placeholder="Olá {{primeiro_nome_lead}} — sua reunião é {{data_reuniao}} às {{horario_reuniao}}."
                  />
                  <p className="notif-field-hint" style={{ marginTop: '0.35rem' }}>
                    Clique para copiar ou digite na mensagem:
                  </p>
                  <div className="notif-vars">
                    {TEMPLATE_VARIABLES.map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        className="notif-var-chip"
                        title={label}
                        onClick={() =>
                          setFormData((prev) => ({
                            ...prev,
                            messageBody: `${prev.messageBody}{{${key}}}`,
                          }))
                        }
                      >
                        <code>{`{{${key}}}`}</code>
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {formData.recipient === 'terceiro' && (
                  <div className="notif-field">
                    <label className="notif-field-label" htmlFor="notif-phone">
                      Número do WhatsApp a ser notificado
                    </label>
                    <input
                      id="notif-phone"
                      className="notif-input"
                      name="thirdPartyPhone"
                      value={formData.thirdPartyPhone}
                      onChange={handleChange}
                      placeholder="5511999999999"
                    />
                    <span className="notif-field-hint">Somente dígitos, com DDI 55.</span>
                  </div>
                )}

                <label className="notif-toggle-row" htmlFor="notif-active">
                  <input
                    id="notif-active"
                    type="checkbox"
                    name="isActive"
                    checked={formData.isActive}
                    onChange={handleChange}
                  />
                  <span>Notificação ativa na cadência</span>
                </label>
              </div>

              <div className="notif-drawer-footer">
                <button type="button" className="btn-pill btn-pill-ghost" onClick={clearForm}>
                  Cancelar
                </button>
                <button type="submit" className="btn-pill btn-pill-primary">
                  Salvar notificação
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsAdmin;
