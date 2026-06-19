import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Bell, Users, CalendarPlus, List } from 'lucide-react';
import { isAdminSession } from '../utils/authSession';
import '../styles/notifications-admin.css';

const AdminNav = () => {
  const navigate = useNavigate();
  const location = useLocation();

  if (!isAdminSession()) return null;

  const items = [
    { path: '/sdr', label: 'Novo agendamento', icon: CalendarPlus },
    { path: '/admin/schedule', label: 'Agendamentos', icon: List },
    { path: '/admin/notifications', label: 'Cadência de notificações', icon: Bell },
    { path: '/admin/users', label: 'Usuários', icon: Users },
  ];

  return (
    <nav
      style={{
        marginBottom: '1.25rem',
        padding: '0.9rem 1.1rem',
        borderRadius: '1.25rem',
        border: '1px solid rgba(195, 164, 87, 0.35)',
        background: 'linear-gradient(135deg, rgba(195,164,87,0.1), rgba(255,255,255,0.02))',
      }}
      aria-label="Painel administrador"
    >
      <div
        style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: '#C3A457',
          marginBottom: '0.65rem',
        }}
      >
        Painel administrador
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {items.map(({ path, label, icon: Icon }) => {
          const active = location.pathname === path;
          return (
            <button
              key={path}
              type="button"
              className={`btn-pill ${active ? 'btn-pill-primary' : 'btn-pill-ghost'}`}
              onClick={() => navigate(path)}
            >
              <Icon size={15} />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default AdminNav;
