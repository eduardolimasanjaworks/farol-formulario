import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminNav from '../components/AdminNav';
import { clearAuthSession, getAuthSession } from '../utils/authSession';

const MIN_PASSWORD_LENGTH = 6;

const defaultForm = {
  login: '',
  name: '',
  password: '',
  role: 'user',
  isActive: true,
};

const validateUserForm = (formData, { editingId } = {}) => {
  const login = String(formData.login || '').trim();
  const name = String(formData.name || '').trim();
  const password = String(formData.password || '');

  if (!login || !name) {
    return 'Login e nome são obrigatórios.';
  }

  if (!editingId && password.length < MIN_PASSWORD_LENGTH) {
    return `Senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`;
  }

  if (editingId && password && password.length < MIN_PASSWORD_LENGTH) {
    return `Nova senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`;
  }

  return '';
};

const UsersAdmin = () => {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [formData, setFormData] = useState(defaultForm);
  const [editingId, setEditingId] = useState(null);
  const [status, setStatus] = useState('');
  const token = getAuthSession().token;

  const authFetch = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || 'Falha na requisição');
    }
    return payload;
  };

  const loadUsers = async () => {
    try {
      const payload = await authFetch('/api/users');
      setUsers(payload.rows || []);
    } catch (error) {
      setStatus(error.message);
    }
  };

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    loadUsers();
  }, []);

  const clearForm = () => {
    setFormData(defaultForm);
    setEditingId(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const validationError = validateUserForm(formData, { editingId });
    if (validationError) {
      setStatus(validationError);
      return;
    }

    setStatus('');
    try {
      if (editingId) {
        await authFetch(`/api/users/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        });
      } else {
        await authFetch('/api/users', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
      }
      await loadUsers();
      clearForm();
      setStatus('Usuário salvo com sucesso.');
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Tem certeza que deseja remover este usuário?')) return;
    setStatus('');
    try {
      await authFetch(`/api/users/${id}`, { method: 'DELETE' });
      await loadUsers();
      setStatus('Usuário removido.');
    } catch (error) {
      setStatus(error.message);
    }
  };

  const startEdit = (user) => {
    setEditingId(user.id);
    setFormData({
      login: user.login,
      name: user.name,
      password: '',
      role: user.role,
      isActive: Boolean(user.is_active),
    });
  };

  const logout = () => {
    clearAuthSession();
    navigate('/login');
  };

  return (
    <div className="premium-container">
      <div className="glass-card animate-fade-in" style={{ maxWidth: '1000px', width: 'min(95vw, 1000px)' }}>
        <AdminNav />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: '1.5rem', margin: 0 }}>CRUD de usuários</h1>
          <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '0.4rem 1rem' }} onClick={logout}>
            Sair
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <input className="modern-select" placeholder="Login" value={formData.login} onChange={(e) => setFormData((p) => ({ ...p, login: e.target.value }))} required />
          <input className="modern-select" placeholder="Nome" value={formData.name} onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))} required />
          <input
            className="modern-select"
            placeholder={editingId ? 'Nova senha (opcional)' : 'Senha'}
            type="password"
            value={formData.password}
            onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
            required={!editingId}
            minLength={editingId ? undefined : MIN_PASSWORD_LENGTH}
            autoComplete={editingId ? 'new-password' : 'new-password'}
          />
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {editingId
              ? `Deixe em branco para manter a senha atual. Mínimo de ${MIN_PASSWORD_LENGTH} caracteres se alterar.`
              : `Mínimo de ${MIN_PASSWORD_LENGTH} caracteres.`}
          </p>
          <select className="modern-select" value={formData.role} onChange={(e) => setFormData((p) => ({ ...p, role: e.target.value }))}>
            <option value="user">Usuário</option>
            <option value="admin">Admin</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" checked={formData.isActive} onChange={(e) => setFormData((p) => ({ ...p, isActive: e.target.checked }))} />
            Usuário ativo
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '0.5rem 1.25rem' }}>
              {editingId ? 'Atualizar' : 'Criar usuário'}
            </button>
            {editingId && (
              <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '0.5rem 1.25rem' }} onClick={clearForm}>
                Cancelar edição
              </button>
            )}
          </div>
        </form>

        {status && (
          <p
            style={{
              fontSize: '0.85rem',
              color: status.includes('sucesso') || status.includes('removido') ? '#86efac' : '#fca5a5',
            }}
          >
            {status}
          </p>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>ID</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Login</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Nome</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Role</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Ativo</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td style={{ padding: '0.5rem' }}>{user.id}</td>
                  <td style={{ padding: '0.5rem' }}>{user.login}</td>
                  <td style={{ padding: '0.5rem' }}>{user.name}</td>
                  <td style={{ padding: '0.5rem' }}>{user.role}</td>
                  <td style={{ padding: '0.5rem' }}>{user.is_active ? 'Sim' : 'Não'}</td>
                  <td style={{ padding: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                    <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '0.35rem 0.8rem' }} onClick={() => startEdit(user)}>
                      Editar
                    </button>
                    <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '0.35rem 0.8rem' }} onClick={() => handleDelete(user.id)}>
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
              {!users.length && (
                <tr>
                  <td colSpan="6" style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Nenhum usuário cadastrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default UsersAdmin;
