import { useState } from 'react';
import { useAuth } from '../AuthContext.jsx';
import { useSettings } from '../../shared/hooks/useSettings.js';
import { supabase } from '../../shared/lib/supabaseClient.js';
import { useToast } from '../../shared/components/Toast.jsx';
import { config } from '../../shared/lib/config.js';

// Shown instead of LoginScreen/Dashboard when the admin just clicked a
// Supabase "Invite user" or "reset password" email link (see AuthContext's
// needsPasswordSetup). Supabase already establishes a valid session from the
// link's token — this screen just collects the new password and calls
// updateUser(), it never touches signInWithPassword.
export default function SetPasswordScreen() {
  const { session, completePasswordSetup } = useAuth();
  const { settings } = useSettings();
  const logoUrl = settings?.logo_url;
  const showToast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password.length < 6) { showToast('Password minimal 6 karakter', 'error'); return; }
    if (password !== confirm) { showToast('Konfirmasi password tidak cocok', 'error'); return; }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      showToast('Password berhasil dibuat! Selamat datang 👋', 'success');
      completePasswordSetup();
    } catch (err) {
      showToast('Gagal menyimpan password: ' + (err.message || 'Coba lagi'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  // The link's token is expired/invalid/already used — Supabase never
  // established a session for it, so there's nothing to attach a password to.
  if (!session) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-logo">
            {logoUrl && <img className="logo-icon-img" src={logoUrl} alt={config.storeName} />}
            <div className="logo-text">{config.storeName}</div>
          </div>
          <p className="login-subtitle">Link undangan tidak valid atau sudah kedaluwarsa. Minta admin kirim ulang undangannya ya.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">
          {logoUrl && <img className="logo-icon-img" src={logoUrl} alt={config.storeName} />}
          <div className="logo-text">{config.storeName}</div>
        </div>
        <p className="login-subtitle">Buat password buat akun admin kamu</p>

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="newPassword">Password Baru</label>
            <input
              type="password" id="newPassword" placeholder="Minimal 6 karakter" required autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="confirmPassword">Konfirmasi Password</label>
            <input
              type="password" id="confirmPassword" placeholder="Ulangi password" required autoComplete="new-password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary login-btn" disabled={submitting}>
            {submitting ? 'Menyimpan...' : 'Simpan Password & Masuk'}
          </button>
        </form>
      </div>
    </div>
  );
}
