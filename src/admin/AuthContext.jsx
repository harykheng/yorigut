import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../shared/lib/supabaseClient.js';

const AuthContext = createContext(null);

// Supabase's "Invite user" and "reset password" emails redirect back here
// with `type=invite` or `type=recovery` alongside the auth tokens — hash
// params for the classic implicit flow, query string for PKCE. We use that
// as the signal to show SetPasswordScreen instead of Dashboard/LoginScreen.
// Checking the URL directly (rather than relying on which onAuthStateChange
// event supabase-js happens to fire for each link type) is the more robust
// source of truth here.
function detectPasswordSetupType() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const searchParams = new URLSearchParams(window.location.search);
  const type = hashParams.get('type') || searchParams.get('type');
  return type === 'invite' || type === 'recovery' ? type : null;
}

export function AuthProvider({ children }) {
  // undefined = still checking session, null = signed out, object = signed in
  const [session, setSession] = useState(undefined);
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(() => Boolean(detectPasswordSetupType()));

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'SIGNED_OUT') setSession(null);
      else setSession(newSession);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setSession(data.session);
    return data;
  }

  async function logout() {
    await supabase.auth.signOut();
    setSession(null);
  }

  // Called by SetPasswordScreen once the new password is saved — strips the
  // invite/recovery params so a refresh lands on the normal login/dashboard
  // flow instead of re-showing this screen (the session is already valid at
  // this point, no reload needed).
  function completePasswordSetup() {
    window.history.replaceState(null, '', window.location.pathname);
    setNeedsPasswordSetup(false);
  }

  return (
    <AuthContext.Provider value={{ session, needsPasswordSetup, login, logout, completePasswordSetup }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
