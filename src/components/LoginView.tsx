import React, { useState } from 'react';
import { Lock, Radio, Eye, EyeOff, Tv, AlertCircle, LogIn } from 'lucide-react';
import { PermissionKey } from '../types/bell';

interface LoginSuccessPayload {
  userId: string;
  username: string;
  displayName: string;
  groupId: string;
  groupName: string;
  permissions: PermissionKey[];
  mustChangePassword: boolean;
  token?: string;
}

interface LoginViewProps {
  mustChangePasswordHint: boolean;
  onLoginSuccess: (data: LoginSuccessPayload) => void;
  onOpenTvMode: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  mustChangePasswordHint,
  onLoginSuccess,
  onOpenTvMode,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Nieprawidłowy login lub hasło');
        return;
      }

      onLoginSuccess({
        userId: data.userId,
        username: data.username,
        displayName: data.displayName || data.username,
        groupId: data.groupId,
        groupName: data.groupName || '',
        permissions: Array.isArray(data.permissions) ? data.permissions : [],
        mustChangePassword: Boolean(data.mustChangePassword),
        token: data.token,
      });
    } catch {
      setError('Błąd połączenia z serwerem HarmoniaBell.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-6">
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md space-y-5">
          {/* Brand Header */}
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto">
              <Radio className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              HarmoniaBell <span className="font-mono text-xs font-normal text-slate-400">Debian 13</span>
            </h1>
            <p className="text-xs text-slate-400">
              Panel zarządzania dzwonkami szkolnymi i radiowęzłem
            </p>
          </div>

          {/* Login Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-5">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-800">
              <Lock className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                Logowanie Administratora
              </h2>
            </div>

            {mustChangePasswordHint && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 leading-relaxed">
                Pierwsze logowanie: użyj domyślnych danych — login{' '}
                <code className="font-mono font-bold text-amber-300">admin</code>, hasło{' '}
                <code className="font-mono font-bold text-amber-300">admin</code>. Po wejściu do panelu możesz ustawić własny login i hasło.
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-xs text-rose-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1.5" htmlFor="login-username">
                  Login
                </label>
                <input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Wpisz login (domyślnie: admin)"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1.5" htmlFor="login-password">
                  Hasło
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Wpisz hasło"
                    className="w-full pl-3 pr-10 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-200 cursor-pointer"
                    title={showPassword ? 'Ukryj hasło' : 'Pokaż hasło'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 rounded-lg bg-amber-400 hover:bg-amber-300 active:bg-amber-500 text-slate-950 font-semibold text-xs transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
              >
                <LogIn className="w-4 h-4" />
                <span>{isSubmitting ? 'Logowanie...' : 'Zaloguj się do panelu'}</span>
              </button>
            </form>

            {/* Public TV Screen bypass link */}
            <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <span className="text-[11px] text-slate-400">
                Ekran na korytarz szkolny nie wymaga hasła
              </span>
              <button
                type="button"
                onClick={onOpenTvMode}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-amber-300 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Tv className="w-3.5 h-3.5" />
                <span>Otwórz Ekran TV</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <footer className="text-center text-[11px] text-slate-500 py-3">
        HarmoniaBell · Dostęp publiczny do tablicy informacyjnej: <span className="font-mono text-slate-400">/tv</span>
      </footer>
    </div>
  );
};
