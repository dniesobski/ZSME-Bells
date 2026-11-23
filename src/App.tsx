import React, { useState, useEffect, useCallback } from 'react';
import { TopBar } from './components/TopBar';
import { DashboardView } from './components/DashboardView';
import { SchedulesView } from './components/SchedulesView';
import { SoundsView } from './components/SoundsView';
import { CalendarView } from './components/CalendarView';
import { VolumeView } from './components/VolumeView';
import { DebianGuideView } from './components/DebianGuideView';
import { LogsView } from './components/LogsView';
import { RadioView } from './components/RadioView';
import { TvDisplayView } from './components/TvDisplayView';
import { LoginView } from './components/LoginView';
import { AccountView } from './components/AccountView';
import { ManualBellModal } from './components/ManualBellModal';
import {
  AppConfig,
  AuthStatus,
  BellHistoryEntry,
  PermissionKey,
  SoundTrack,
  SystemStatus,
  TvPublicData,
} from './types/bell';
import { INITIAL_CONFIG } from './data/defaultConfig';
import { PRESET_SOUNDS } from './utils/wavGenerator';
import { apiFetch, setStoredAuthToken } from './utils/apiClient';
import { getDefaultTabForPermissions, hasPermission } from './utils/permissions';
import { KeyRound, ShieldAlert } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (
      typeof window !== 'undefined' &&
      (window.location.pathname === '/tv' || window.location.search.includes('tv=1'))
    ) {
      return 'tv';
    }
    return 'dashboard';
  });

  const [auth, setAuth] = useState<AuthStatus>({
    authenticated: false,
    userId: null,
    username: null,
    displayName: null,
    groupId: null,
    groupName: null,
    permissions: [],
    mustChangePassword: true,
  });
  const [authLoading, setAuthLoading] = useState<boolean>(true);

  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [tvData, setTvData] = useState<TvPublicData | null>(null);
  const [config, setConfig] = useState<AppConfig>(INITIAL_CONFIG);
  const [sounds, setSounds] = useState<SoundTrack[]>(
    PRESET_SOUNDS.map((p) => ({
      id: p.id,
      name: p.name,
      category: 'preset',
      description: p.description,
      musicalKey: p.musicalKey,
      durationSeconds: p.durationSeconds,
      tags: p.tags,
      filename: `${p.id}.wav`,
      fileUrl: `/sounds/${p.id}.wav`,
    }))
  );
  const [history, setHistory] = useState<BellHistoryEntry[]>([]);
  const [isManualBellOpen, setIsManualBellOpen] = useState(false);
  const [notification, setNotification] = useState<{
    msg: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  const showNotification = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const handleUnauthorized = useCallback(() => {
    setStoredAuthToken(null);
    setAuth((prev) => ({
      ...prev,
      authenticated: false,
      userId: null,
      username: null,
      displayName: null,
      groupId: null,
      groupName: null,
      permissions: [],
    }));
  }, []);

  // Check current auth session
  const fetchAuthMe = useCallback(async () => {
    try {
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        const data: AuthStatus = await res.json();
        setAuth(data);
        if (!data.authenticated) {
          setStoredAuthToken(null);
        }
      }
    } catch {
      // Ignore network hiccup during boot
    } finally {
      setAuthLoading(false);
    }
  }, []);

  // Fetch public status (used both on dashboard & public /tv screen)
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch {
      // Fallback local status simulation if running before server boots
    }
  }, []);

  // Fetch public TV display metadata (safe subset without auth)
  const fetchTvData = useCallback(async () => {
    try {
      const res = await fetch('/api/tv-data');
      if (res.ok) {
        const data: TvPublicData = await res.json();
        setTvData(data);
      }
    } catch {}
  }, []);

  // Fetch protected admin config
  const fetchConfig = useCallback(async () => {
    try {
      const res = await apiFetch('/api/config');
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch {}
  }, [handleUnauthorized]);

  // Fetch protected sounds
  const fetchSounds = useCallback(async () => {
    try {
      const res = await apiFetch('/api/sounds');
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data.presets && data.custom) {
          setSounds([...data.presets, ...data.custom]);
        }
      }
    } catch {}
  }, [handleUnauthorized]);

  // Fetch protected history
  const fetchHistory = useCallback(async () => {
    try {
      const res = await apiFetch('/api/history');
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch {}
  }, [handleUnauthorized]);

  // Initial auth + public status/tv-data polling
  useEffect(() => {
    fetchAuthMe();
    fetchStatus();
    fetchTvData();

    const statusInterval = setInterval(() => {
      fetchStatus();
    }, 1000);

    return () => clearInterval(statusInterval);
  }, [fetchAuthMe, fetchStatus, fetchTvData]);

  // Load admin data whenever authenticated
  useEffect(() => {
    if (!auth.authenticated) return;
    fetchConfig();
    fetchSounds();

    const canReadHistory =
      hasPermission(auth, 'logs_view') || hasPermission(auth, 'dashboard_view');
    if (canReadHistory) {
      fetchHistory();
    } else {
      setHistory([]);
    }

    const histInterval = setInterval(() => {
      if (canReadHistory) {
        fetchHistory();
      }
    }, 10000);
    return () => clearInterval(histInterval);
  }, [auth, fetchConfig, fetchSounds, fetchHistory]);

  // Ensure active tab is permitted for the current user's group
  useEffect(() => {
    if (!auth.authenticated || activeTab === 'tv' || activeTab === 'account') return;
    const tabPermMap: Record<string, PermissionKey> = {
      dashboard: 'dashboard_view',
      schedules: 'schedules_edit',
      radio: 'radio_control',
      sounds: 'sounds_manage',
      calendar: 'calendar_edit',
      volume: 'volume_edit',
      debian: 'debian_view',
      logs: 'logs_view',
    };
    const needed = tabPermMap[activeTab];
    if (needed && !hasPermission(auth, needed)) {
      setActiveTab(getDefaultTabForPermissions(auth.permissions));
    }
  }, [auth, activeTab]);

  // Refresh public /tv data periodically while in TV mode
  useEffect(() => {
    if (activeTab !== 'tv') return;
    fetchTvData();
    const tvInterval = setInterval(() => {
      fetchTvData();
    }, 10000);
    return () => clearInterval(tvInterval);
  }, [activeTab, fetchTvData]);

  // Keep URL synced when entering/exiting /tv mode & listen to browser back button
  useEffect(() => {
    const onPopState = () => {
      const isTvPath =
        window.location.pathname === '/tv' || window.location.search.includes('tv=1');
      setActiveTab(isTvPath ? 'tv' : 'dashboard');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === 'tv') {
      if (window.location.pathname !== '/tv') {
        window.history.pushState({}, '', '/tv');
      }
    } else if (window.location.pathname === '/tv') {
      window.history.pushState({}, '', '/');
    }
  };

  const handleLoginSuccess = (data: {
    userId: string;
    username: string;
    displayName: string;
    groupId: string;
    groupName: string;
    permissions: PermissionKey[];
    mustChangePassword: boolean;
    token?: string;
  }) => {
    if (data.token) {
      setStoredAuthToken(data.token);
    }
    setAuth({
      authenticated: true,
      userId: data.userId,
      username: data.username,
      displayName: data.displayName,
      groupId: data.groupId,
      groupName: data.groupName,
      permissions: data.permissions,
      mustChangePassword: data.mustChangePassword,
    });
    const nextDefaultTab = getDefaultTabForPermissions(data.permissions);
    if (activeTab === 'tv') {
      handleTabChange(nextDefaultTab);
    } else {
      setActiveTab(nextDefaultTab);
    }
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore error on logout
    }
    setStoredAuthToken(null);
    setAuth((prev) => ({
      ...prev,
      authenticated: false,
      userId: null,
      username: null,
      displayName: null,
      groupId: null,
      groupName: null,
      permissions: [],
    }));
    setActiveTab('dashboard');
  };

  // Handle Save Config
  const handleSaveConfig = async (updatedConfig: AppConfig) => {
    try {
      const res = await apiFetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (res.ok) {
        setConfig(updatedConfig);
        await fetchStatus();
        await fetchTvData();
        showNotification('Konfiguracja została pomyślnie zapisana na serwerze Debian!', 'success');
      } else {
        const errData = await res.json().catch(() => null);
        showNotification(errData?.error || 'Błąd zapisu konfiguracji.', 'error');
      }
    } catch (e: any) {
      showNotification(`Błąd komunikacji z serwerem: ${e.message}`, 'error');
    }
  };

  // Handle Manual Bell Trigger
  const handleTriggerBell = async (soundId: string, type: string, title: string, volume: number) => {
    try {
      const res = await apiFetch('/api/trigger-bell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ soundId, type, title, customVolume: volume }),
      });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      const data = await res.json();
      if (data.success) {
        showNotification(`Wyzwolono dzwonek: ${data.message}`, 'success');
        await fetchHistory();
      } else {
        showNotification(`Błąd odtworzenia dzwonka: ${data.error}`, 'error');
      }
    } catch (e: any) {
      showNotification(`Błąd połączenia: ${e.message}`, 'error');
    }
  };

  // Test speaker
  const handleTestSpeaker = async () => {
    const res = await apiFetch('/api/test-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ soundId: config.defaultStartSoundId, volume: config.masterVolume }),
    });
    if (res.status === 401) {
      handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (data.success) {
      showNotification('Sygnał testowy został wysłany do wzmacniacza.', 'success');
      await fetchHistory();
    } else {
      showNotification(`Błąd testu: ${data.error}`, 'error');
    }
  };

  // Toggle Mute
  const handleToggleMute = async () => {
    const isCurrentlyMuted = status?.isMuted;
    let nextMute: string | null = null;
    if (!isCurrentlyMuted) {
      const midnight = new Date();
      midnight.setHours(23, 59, 59, 999);
      nextMute = midnight.toISOString();
    }

    try {
      const res = await apiFetch('/api/set-mute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ muteUntil: nextMute }),
      });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (res.ok) {
        await fetchStatus();
        showNotification(
          nextMute ? 'Dzwonki zostały wyciszone do końca dnia!' : 'Dzwonki zostały przywrócone!',
          'info'
        );
      }
    } catch {}
  };

  // Quick Profile Change
  const handleQuickProfileChange = async (profileId: string) => {
    const updated = { ...config, activeProfileId: profileId };
    await handleSaveConfig(updated);
  };

  // Upload Custom Sound
  const handleUploadCustomSound = async (soundData: {
    name: string;
    description: string;
    musicalKey: string;
    base64Data: string;
    filename: string;
  }) => {
    const res = await apiFetch('/api/sounds/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(soundData),
    });
    if (res.status === 401) {
      handleUnauthorized();
      return;
    }
    if (res.ok) {
      await fetchSounds();
      showNotification('Plik audio dodany do bazy dzwonków!', 'success');
    } else {
      throw new Error('Błąd wgrywania');
    }
  };

  // Delete Custom Sound
  const handleDeleteCustomSound = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten plik audio?')) return;
    const res = await apiFetch(`/api/sounds/${id}`, { method: 'DELETE' });
    if (res.status === 401) {
      handleUnauthorized();
      return;
    }
    if (res.ok) {
      await fetchSounds();
      showNotification('Plik został usunięty.', 'info');
    }
  };

  // Clear History
  const handleClearHistory = async () => {
    if (!confirm('Czy na pewno chcesz wyczyścić historię zdarzeń?')) return;
    const res = await apiFetch('/api/history/clear', { method: 'POST' });
    if (res.status === 401) {
      handleUnauthorized();
      return;
    }
    if (res.ok) {
      setHistory([]);
      showNotification('Historia została wyczyszczona.', 'info');
    }
  };

  // Update default sounds
  const handleUpdateDefaultSounds = async (updates: {
    defaultStartSoundId?: string;
    defaultEndSoundId?: string;
    defaultWarningSoundId?: string;
  }) => {
    const updated = { ...config, ...updates };
    await handleSaveConfig(updated);
  };

  // Start / Stop Internet Radio on Debian server
  const handlePlayRadioLinux = async (stationId: string, volume?: number) => {
    try {
      const res = await apiFetch('/api/radio/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationId, volume }),
      });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      const data = await res.json();
      if (data.success) {
        await fetchStatus();
        await fetchHistory();
        showNotification(data.message || 'Uruchomiono radio w radiowęźle!', 'success');
      } else {
        showNotification(data.error || 'Błąd uruchamiania stacji radiowej.', 'error');
      }
    } catch (e: any) {
      showNotification(`Błąd połączenia: ${e.message}`, 'error');
    }
  };

  const handleStopRadioLinux = async () => {
    try {
      const res = await apiFetch('/api/radio/stop', { method: 'POST' });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (res.ok) {
        await fetchStatus();
        await fetchHistory();
        showNotification('Zatrzymano radio w radiowęźle.', 'info');
      }
    } catch (e: any) {
      showNotification(`Błąd zatrzymywania radia: ${e.message}`, 'error');
    }
  };

  // Control Amplifier Power (1 = ON, 0 = OFF, auto = resume schedule)
  const handleControlAmplifier = async (
    action: 'on' | 'off' | 'auto',
    options?: { devicePath?: string; appendNewline?: boolean }
  ) => {
    try {
      const res = await apiFetch('/api/amplifier/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ...(options?.devicePath ? { devicePath: options.devicePath } : {}),
          ...(typeof options?.appendNewline === 'boolean'
            ? { appendNewline: options.appendNewline }
            : {}),
        }),
      });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        await fetchStatus();
        if (hasPermission(auth, 'logs_view') || hasPermission(auth, 'dashboard_view')) {
          await fetchHistory();
        }
        showNotification(data.message || 'Zaktualizowano stan wzmacniacza.', 'success');
      } else {
        showNotification(data.error || 'Błąd sterowania wzmacniaczem.', 'error');
      }
    } catch (e: any) {
      showNotification(`Błąd komunikacji ze sterownikiem wzmacniacza: ${e.message}`, 'error');
    }
  };

  // 1. Public fullscreen TV mode ALWAYS works without authentication
  if (activeTab === 'tv') {
    return (
      <TvDisplayView
        status={status}
        config={config}
        tvData={tvData}
        onExitTvMode={() => handleTabChange('dashboard')}
      />
    );
  }

  // 2. Loading auth session state
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-300 flex items-center justify-center text-xs font-mono">
        Sprawdzanie sesji HarmoniaBell...
      </div>
    );
  }

  // 3. Unauthenticated -> show Login screen with /tv bypass
  if (!auth.authenticated) {
    return (
      <LoginView
        mustChangePasswordHint={auth.mustChangePassword}
        onLoginSuccess={handleLoginSuccess}
        onOpenTvMode={() => handleTabChange('tv')}
      />
    );
  }

  const canDashboard = hasPermission(auth, 'dashboard_view');
  const canManualBell = hasPermission(auth, 'manual_bell');
  const canSchedules = hasPermission(auth, 'schedules_edit');
  const canRadio = hasPermission(auth, 'radio_control');
  const canSounds = hasPermission(auth, 'sounds_manage');
  const canCalendar = hasPermission(auth, 'calendar_edit');
  const canVolume = hasPermission(auth, 'volume_edit');
  const canDebian = hasPermission(auth, 'debian_view');
  const canLogs = hasPermission(auth, 'logs_view');

  const noAccessCard = (
    <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-8 text-center space-y-2 max-w-lg mx-auto my-8">
      <ShieldAlert className="w-8 h-8 text-amber-400 mx-auto" />
      <h3 className="text-base font-bold text-white">Brak dostępu do tego modułu</h3>
      <p className="text-xs text-slate-400">
        Twoja grupa uprawnień ({auth.groupName || 'Brak'}) nie posiada dostępu do tej zakładki. Skontaktuj się z administratorem systemu.
      </p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <TopBar
        status={status}
        auth={auth}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onOpenManualBell={() => setIsManualBellOpen(true)}
        onToggleMute={handleToggleMute}
        onLogout={handleLogout}
      />

      {/* Floating Toast Notification */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 animate-bounce-in">
          <div
            className={`px-4 py-2.5 rounded-lg border shadow-xl text-xs font-medium flex items-center gap-2 ${
              notification.type === 'success'
                ? 'bg-emerald-950/95 border-emerald-800 text-emerald-200'
                : notification.type === 'error'
                ? 'bg-rose-950/95 border-rose-800 text-rose-200'
                : 'bg-slate-800/95 border-slate-700 text-slate-200'
            }`}
          >
            <span>{notification.msg}</span>
          </div>
        </div>
      )}

      {/* Default credentials reminder banner */}
      {auth.mustChangePassword && activeTab !== 'account' && (
        <div className="bg-amber-500/10 border-b border-amber-500/25">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-amber-200">
              <KeyRound className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                {auth.username === 'admin' ? (
                  <>
                    Używasz domyślnego hasła logowania (<code className="font-mono font-bold">admin / admin</code>). Zalecamy ustawienie własnego loginu i hasła w zakładce Moje konto.
                  </>
                ) : (
                  'Używasz hasła tymczasowego nadanego przez administratora. Zalecamy ustawienie własnego hasła w zakładce Moje konto.'
                )}
              </span>
            </div>
            <button
              onClick={() => handleTabChange('account')}
              className="px-3 py-1 rounded-md bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              Zmień hasło
            </button>
          </div>
        </div>
      )}

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'dashboard' &&
          (canDashboard ? (
            <DashboardView
              status={status}
              config={config}
              sounds={sounds}
              history={history}
              onOpenManualBell={() => setIsManualBellOpen(true)}
              onRefreshStatus={fetchStatus}
              onTriggerBell={handleTriggerBell}
              onTestSpeaker={handleTestSpeaker}
              onQuickProfileChange={handleQuickProfileChange}
              onPlayRadioLinux={handlePlayRadioLinux}
              onStopRadioLinux={handleStopRadioLinux}
              onOpenRadioTab={() => handleTabChange('radio')}
              onOpenTvMode={() => handleTabChange('tv')}
              canManualBell={canManualBell}
              canChangeSchedule={canSchedules}
              canControlRadio={canRadio}
            />
          ) : (
            noAccessCard
          ))}

        {activeTab === 'schedules' &&
          (canSchedules ? (
            <SchedulesView
              config={config}
              sounds={sounds}
              status={status}
              onSaveConfig={handleSaveConfig}
              onControlAmplifier={handleControlAmplifier}
            />
          ) : (
            noAccessCard
          ))}

        {activeTab === 'radio' &&
          (canRadio ? (
            <RadioView
              config={config}
              status={status}
              onSaveConfig={handleSaveConfig}
              onPlayRadioLinux={handlePlayRadioLinux}
              onStopRadioLinux={handleStopRadioLinux}
            />
          ) : (
            noAccessCard
          ))}

        {activeTab === 'sounds' &&
          (canSounds ? (
            <SoundsView
              config={config}
              sounds={sounds}
              status={status}
              onUploadCustomSound={handleUploadCustomSound}
              onDeleteCustomSound={handleDeleteCustomSound}
              onUpdateDefaultSounds={handleUpdateDefaultSounds}
              onSaveConfig={handleSaveConfig}
              onRefreshSounds={async () => {
                await fetchSounds();
                await fetchConfig();
                await fetchStatus();
              }}
            />
          ) : (
            noAccessCard
          ))}

        {activeTab === 'calendar' &&
          (canCalendar ? (
            <CalendarView config={config} onSaveConfig={handleSaveConfig} />
          ) : (
            noAccessCard
          ))}

        {activeTab === 'volume' &&
          (canVolume ? (
            <VolumeView
              config={config}
              status={status}
              onSaveConfig={handleSaveConfig}
              onTestSpeaker={handleTestSpeaker}
              onControlAmplifier={handleControlAmplifier}
            />
          ) : (
            noAccessCard
          ))}

        {activeTab === 'debian' &&
          (canDebian ? (
            <DebianGuideView config={config} onImportConfig={handleSaveConfig} />
          ) : (
            noAccessCard
          ))}

        {activeTab === 'logs' &&
          (canLogs ? (
            <LogsView history={history} onClearHistory={handleClearHistory} />
          ) : (
            noAccessCard
          ))}

        {activeTab === 'account' && (
          <AccountView
            auth={auth}
            onCredentialsUpdated={(nextAuth) => {
              setAuth(nextAuth);
              showNotification('Dane logowania zostały zaktualizowane.', 'success');
            }}
            onRefreshAuth={fetchAuthMe}
            onLogout={handleLogout}
          />
        )}
      </main>

      {/* Manual Bell Trigger Modal */}
      <ManualBellModal
        isOpen={isManualBellOpen}
        onClose={() => setIsManualBellOpen(false)}
        sounds={sounds}
        onTriggerBell={handleTriggerBell}
      />

      {/* Institutional Footer */}
      <footer className="mt-auto border-t border-slate-800 py-6 text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-300">HarmoniaBell</span>
            <span>·</span>
            <span>System Bezstresowych Dzwonków Szkolnych dla Linux Debian 13</span>
          </div>

          <div className="flex items-center gap-4 text-slate-400">
            <span>Sterownik ALSA / PulseAudio</span>
            <span>·</span>
            <span>Port 3000</span>
            <span>·</span>
            <span className="font-mono text-slate-300">Debian 13 (Trixie) Ready</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
