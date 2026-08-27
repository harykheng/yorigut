import { useState } from 'react';
import { useAuth } from '../AuthContext.jsx';
import { useSettings } from '../../shared/hooks/useSettings.js';
import { config } from '../../shared/lib/config.js';

export default function LoginScreen() {
  const { login } = useAuth();
  const { settings } = useSettings();
  const logoUrl = settings?.logo_url;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await login(email.trim(), password);
    } catch {
      setError('Email atau password salah. Coba lagi!');
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">
          {logoUrl && <img className="logo-icon-img" src={logoUrl} alt={config.storeName} />}
          <div className="logo-text">{config.storeName}</div>
        </div>
        <p className="login-subtitle">Masuk ke Dashboard Admin</p>

        {error && <div className="login-error" style={{ display: 'block' }}>{error}</div>}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="loginEmail">Email</label>
            <input
              type="email" id="loginEmail" placeholder="admin@email.com" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="loginPassword">Password</label>
            <input
              type="password" id="loginPassword" placeholder="••••••••" required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary login-btn" disabled={submitting}>
            {submitting ? 'Masuk...' : 'Masuk'}
          </button>
        </form>
      </div>
    </div>
  );
}
