import React, { useState } from 'react';
import { Mail, Lock, ChevronRight, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import logoImage from '../../logo.jpg';
import { setAuthSession } from '../utils/authSession';

const Login = () => {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [sliderPos, setSliderPos] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const updateSliderFromClientX = (clientX) => {
    const container = document.getElementById('slider-container');
    if (!container || isUnlocked) return;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left - 24;
    const max = rect.width - 56;
    const pos = Math.max(0, Math.min(x, max));
    setSliderPos(pos);

    if (pos >= max - 5) {
      setIsUnlocked(true);
      setSliderPos(max);
      setIsDragging(false);
      setError('');
    }
  };

  const handlePointerMove = (e) => {
    if (!isDragging || isUnlocked) return;
    updateSliderFromClientX(e.clientX);
  };

  const handlePointerUp = () => {
    if (isUnlocked) return;
    setIsDragging(false);
    setSliderPos(0);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isUnlocked) {
      setError('Arraste o controle de segurança até o fim antes de entrar.');
      return;
    }

    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.token) {
        throw new Error(payload?.error || 'Credenciais inválidas');
      }

      setAuthSession({ token: payload.token, user: payload.user });
      navigate('/sdr');
    } catch (err) {
      setError(err?.message || 'Credenciais inválidas');
      setIsUnlocked(false);
      setSliderPos(0);
    }
  };

  return (
    <div
      className="premium-container"
      onMouseMove={handlePointerMove}
      onMouseUp={handlePointerUp}
      onTouchMove={(e) => {
        if (!isDragging || isUnlocked) return;
        e.preventDefault();
        updateSliderFromClientX(e.touches[0].clientX);
      }}
      onTouchEnd={handlePointerUp}
    >
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 0 }}>
        <div style={{ position: 'absolute', top: '-10%', right: '-10%', width: '50%', height: '50%', background: 'radial-gradient(circle, rgba(255, 107, 0, 0.1) 0%, transparent 70%)', filter: 'blur(100px)' }}></div>
        <div style={{ position: 'absolute', bottom: '-10%', left: '-10%', width: '50%', height: '50%', background: 'radial-gradient(circle, rgba(255, 255, 255, 0.05) 0%, transparent 70%)', filter: 'blur(100px)' }}></div>
      </div>

      <div className="glass-card animate-fade-in">
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{
            width: '80px',
            height: '80px',
            background: 'white',
            borderRadius: '1.5rem',
            margin: '0 auto 1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 30px rgba(255, 255, 255, 0.2)'
          }}>
             <img
               src={logoImage}
               alt="Logo"
               style={{ width: '62%', objectFit: 'cover', borderRadius: '0.75rem' }}
             />
          </div>
          <h1 style={{ fontSize: '1.875rem', fontWeight: '900', letterSpacing: '-0.025em' }}>Disparo Farol</h1>
          <p style={{ fontSize: '11px', color: '#FFD100', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.25em', marginTop: '0.5rem' }}>Acesso Restrito</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="input-group">
            <Mail size={20} />
            <input 
              type="text" 
              placeholder="Usuário" 
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              required 
            />
          </div>

          <div className="input-group">
            <Lock size={20} />
            <input 
              type="password" 
              placeholder="Senha de acesso" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required 
            />
          </div>

          {error && (
            <p style={{ color: '#F44336', fontSize: '12px', textAlign: 'center', margin: '0' }}>{error}</p>
          )}

          <div style={{ marginTop: '1rem' }}>
            <p style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)', marginLeft: '0.25rem', marginBottom: '0.5rem' }}>
              Verificação de Segurança
            </p>
            <div id="slider-container" className="slider-container">
              <div className="slider-text" style={{ opacity: isUnlocked ? 0 : 1 }}>
                Arraste para confirmar
              </div>
              <div 
                className="slider-handle" 
                style={{ 
                  left: `${sliderPos + 4}px`,
                  cursor: isUnlocked ? 'default' : (isDragging ? 'grabbing' : 'grab'),
                  background: isUnlocked ? '#4CAF50' : 'var(--accent)'
                }}
                onMouseDown={() => {
                  if (!isUnlocked) {
                    setIsDragging(true);
                    setError('');
                  }
                }}
                onTouchStart={(e) => {
                  if (!isUnlocked) {
                    e.preventDefault();
                    setIsDragging(true);
                    setError('');
                  }
                }}
              >
                {isUnlocked ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" style={{ width: '24px' }}>
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                ) : <ChevronRight size={24} color="white" />}
              </div>
            </div>
          </div>

          <button type="submit" className="btn-primary" disabled={!isUnlocked} style={{ marginTop: '1.5rem' }}>
            <span>Entrar</span>
            <ArrowRight size={20} />
          </button>
        </form>

        <p style={{ marginTop: '2rem', textAlign: 'center', fontSize: '10px', fontWeight: '500', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Farol System v1.0 • Techfala Security
        </p>
      </div>
    </div>
  );
};

export default Login;
