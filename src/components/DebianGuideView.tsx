import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Terminal,
  Download,
  Copy,
  Check,
  Server,
  Cable,
  ShieldCheck,
  AlertCircle,
  FileCode,
  FileText,
  Upload,
  RefreshCw,
  ArrowUpCircle,
  PackageCheck,
  GitBranch,
  Loader2,
  Link2,
  Unlink,
  RotateCw,
  Power,
} from 'lucide-react';
import {
  AppConfig,
  DebianGitConfig,
  DebianUpdateCheckResult,
  DebianUpdateJobStatus,
} from '../types/bell';
import { apiFetch } from '../utils/apiClient';

interface DebianGuideViewProps {
  config: AppConfig;
  onImportConfig: (config: AppConfig) => Promise<void>;
}

export const DebianGuideView: React.FC<DebianGuideViewProps> = ({ config, onImportConfig }) => {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [updateCheck, setUpdateCheck] = useState<DebianUpdateCheckResult | null>(null);
  const [updateJob, setUpdateJob] = useState<DebianUpdateJobStatus | null>(null);
  const [updateTarget, setUpdateTarget] = useState<'all' | 'app' | 'system'>('all');
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isStartingUpdate, setIsStartingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [gitConfig, setGitConfig] = useState<DebianGitConfig | null>(null);
  const [gitUrlInput, setGitUrlInput] = useState('');
  const [gitBranchInput, setGitBranchInput] = useState('');
  const [isSavingGitConfig, setIsSavingGitConfig] = useState(false);
  const [gitConfigMessage, setGitConfigMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [confirmPowerAction, setConfirmPowerAction] = useState<'service' | 'reboot' | null>(null);
  const [isTriggeringPowerAction, setIsTriggeringPowerAction] = useState(false);
  const [powerActionMsg, setPowerActionMsg] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const gitInputsInitializedRef = useRef(false);

  const fetchUpdateStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/debian/update-status');
      if (!res.ok) return;
      const data = await res.json();
      if (data.job) setUpdateJob(data.job);
      if (data.lastCheck) setUpdateCheck(data.lastCheck);
      if ('gitConfig' in data) {
        setGitConfig(data.gitConfig);
        if (!gitInputsInitializedRef.current) {
          const initialUrl = data.gitConfig?.repoUrl || data.lastCheck?.git?.repoUrl || '';
          const initialBranch = data.gitConfig?.branch || data.lastCheck?.git?.branch || '';
          setGitUrlInput(initialUrl);
          setGitBranchInput(initialBranch);
          gitInputsInitializedRef.current = true;
        }
      }
    } catch {
      // Ignore transient polling errors (e.g., while service restarts)
    }
  }, []);

  useEffect(() => {
    fetchUpdateStatus();
  }, [fetchUpdateStatus]);

  useEffect(() => {
    if (updateJob?.state !== 'running') return;
    const interval = setInterval(fetchUpdateStatus, 1000);
    return () => clearInterval(interval);
  }, [updateJob?.state, fetchUpdateStatus]);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [updateJob?.logs?.length]);

  const handleSaveGitConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingGitConfig(true);
    setGitConfigMessage(null);
    setUpdateError(null);
    try {
      const res = await apiFetch('/api/debian/git-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: gitUrlInput.trim(),
          branch: gitBranchInput.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Nie udało się zapisać repozytorium Git.');
      }
      if (data.gitConfig) {
        setGitConfig(data.gitConfig);
        setGitUrlInput(data.gitConfig.repoUrl);
        setGitBranchInput(data.gitConfig.branch);
      }
      if (data.result) {
        setUpdateCheck(data.result);
      }
      setGitConfigMessage({
        type: 'success',
        text: `Połączono z repozytorium Git (gałąź: ${data.gitConfig?.branch || 'main'}).`,
      });
    } catch (err: any) {
      setGitConfigMessage({
        type: 'error',
        text: err.message || 'Błąd połączenia z repozytorium Git.',
      });
    } finally {
      setIsSavingGitConfig(false);
    }
  };

  const handleDisconnectGitConfig = async () => {
    setIsSavingGitConfig(true);
    setGitConfigMessage(null);
    try {
      const res = await apiFetch('/api/debian/git-config', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Nie udało się odłączyć repozytorium.');
      }
      setGitConfig(null);
      setGitUrlInput('');
      setGitBranchInput('');
      if (data.result) {
        setUpdateCheck(data.result);
      }
      setGitConfigMessage({
        type: 'success',
        text: 'Odłączono skonfigurowane repozytorium Git.',
      });
    } catch (err: any) {
      setGitConfigMessage({
        type: 'error',
        text: err.message || 'Błąd odłączania repozytorium.',
      });
    } finally {
      setIsSavingGitConfig(false);
    }
  };

  const handleCheckUpdates = async () => {
    setIsCheckingUpdate(true);
    setUpdateError(null);
    try {
      const res = await apiFetch('/api/debian/check-update', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Nie udało się sprawdzić aktualizacji.');
      }
      if (data.result) {
        setUpdateCheck(data.result);
      }
    } catch (err: any) {
      setUpdateError(err.message || 'Błąd podczas sprawdzania aktualizacji.');
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleRunAutoUpdate = async () => {
    setIsStartingUpdate(true);
    setUpdateError(null);
    try {
      const res = await apiFetch('/api/debian/run-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: updateTarget }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Nie udało się uruchomić automatycznej aktualizacji.');
      }
      if (data.job) {
        setUpdateJob(data.job);
      }
    } catch (err: any) {
      setUpdateError(err.message || 'Błąd uruchamiania aktualizacji.');
    } finally {
      setIsStartingUpdate(false);
    }
  };

  const handleRestartService = async () => {
    setIsTriggeringPowerAction(true);
    setPowerActionMsg(null);
    try {
      const res = await apiFetch('/api/debian/restart-service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Nie udało się zrestartować usługi.');
      }
      setConfirmPowerAction(null);
      setPowerActionMsg({
        type: 'success',
        text: data.message || 'Zaplanowano restart usługi. Oczekiwanie na ponowne połączenie...',
      });
      setTimeout(() => {
        void fetchUpdateStatus();
      }, 4500);
    } catch (err: any) {
      setPowerActionMsg({
        type: 'error',
        text: err?.message || 'Błąd podczas restartu usługi.',
      });
    } finally {
      setIsTriggeringPowerAction(false);
    }
  };

  const handleRebootSystem = async () => {
    setIsTriggeringPowerAction(true);
    setPowerActionMsg(null);
    try {
      const res = await apiFetch('/api/debian/reboot-system', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Nie udało się zrestartować systemu.');
      }
      setConfirmPowerAction(null);
      setPowerActionMsg({
        type: 'info',
        text: data.message || 'Serwer Debian 13 uruchamia się ponownie. Panel wróci po starcie systemu.',
      });
    } catch (err: any) {
      setPowerActionMsg({
        type: 'error',
        text: err?.message || 'Błąd podczas zlecania restartu systemu.',
      });
    } finally {
      setIsTriggeringPowerAction(false);
    }
  };

  const copyToClipboard = (text: string, sectionId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(sectionId);
    setTimeout(() => setCopiedSection(null), 2500);
  };

  const handleDownloadFile = (filename: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportBackup = () => {
    const jsonStr = JSON.stringify(config, null, 2);
    handleDownloadFile(
      `harmoniabell_config_backup_${new Date().toISOString().split('T')[0]}.json`,
      jsonStr,
      'application/json'
    );
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed.schedules && parsed.activeProfileId) {
          await onImportConfig(parsed);
          alert('Kopia zapasowa konfiguracji została pomyślnie wczytana!');
        } else {
          alert('Nieprawidłowy format pliku kopii zapasowej.');
        }
      } catch (err: any) {
        alert(`Błąd odczytu pliku: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const quickInstallCommand = `# 1. Zaktualizuj system Debian 13 i zainstaluj pakiety bazowe (jako root)
apt update && apt install -y curl wget git alsa-utils mpv pulseaudio lm-sensors

# 2. Pobierz i zainstaluj Node.js LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 3. Sklonuj aplikację do katalogu /opt/harmonia-bell
git clone https://github.com/dniesobski/ZSME-Bells.git /opt/harmonia-bell
cd /opt/harmonia-bell

# 4. Zainstaluj biblioteki i uruchom
npm install
npm run build
npm start`;

  const systemdServiceContent = `[Unit]
Description=HarmoniaBell - System Bezstresowych Dzwonkow Szkolnych
After=network.target sound.target pulseaudio.service
Wants=sound.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/harmonia-bell
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target`;

  const bashScriptContent = `#!/usr/bin/env bash
# ==============================================================================
# HarmoniaBell - Skrypt automatycznej instalacji na Debian 13 (Trixie)
# ==============================================================================
set -e

echo "=== [1/5] Aktualizacja repozytoriów Debian 13 i instalacja audio ==="
apt update
apt install -y curl wget git alsa-utils mpv pulseaudio libasound2-dev lm-sensors

echo "=== [2/5] Instalacja Node.js LTS (wersja 20+) ==="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi

echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

echo "=== [3/5] Przygotowanie katalogu aplikacji ==="
mkdir -p /opt/harmonia-bell
cd /opt/harmonia-bell

npm install --no-audit --no-fund
npm run build

echo "=== [4/5] Konfiguracja usługi systemd (autostart) ==="
cat << 'EOF' > /etc/systemd/system/harmonia-bell.service
${systemdServiceContent}
EOF

systemctl daemon-reload
systemctl enable harmonia-bell.service
systemctl restart harmonia-bell.service

echo "=== [5/5] Sukces! HarmoniaBell uruchomiony! ==="
IP=$(hostname -I | awk '{print $1}')
echo "Dostęp do panelu WWW w Twojej sieci szkolnej:"
echo "http://$IP:3000"
echo "Status: systemctl status harmonia-bell"
`;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Wdrożenie na Linux Debian 13 (Trixie)</h2>
              <p className="text-xs text-slate-400">
                Instrukcja uruchomienia usługi w szkolnym radiowęźle, autostartu systemd oraz podłączenia wzmacniacza
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportBackup}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-700/80 hover:bg-slate-700 border border-slate-600/70 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Eksportuj Kopię (JSON)</span>
            </button>

            <label className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-700/80 hover:bg-slate-700 border border-slate-600/70 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5" />
              <span>Wczytaj Kopię</span>
              <input type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
            </label>
          </div>
        </div>
      </div>

      {/* Service Restart & Debian 13 System Reboot Controls */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Power className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Sterowanie Usługą i Systemem Debian 13
              </h3>
              <p className="text-xs text-slate-400">
                Szybki restart usługi kontrolera dzwonków (<code className="font-mono text-slate-300">harmoniabell.service</code>) lub pełny restart komputera Debian 13
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={isTriggeringPowerAction || updateJob?.state === 'running'}
              onClick={() => {
                setPowerActionMsg(null);
                setConfirmPowerAction((prev) => (prev === 'service' ? null : 'service'));
              }}
              className="px-3.5 py-2 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 text-sky-200 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isTriggeringPowerAction && confirmPowerAction === 'service' ? 'animate-spin' : ''}`} />
              <span>Restartuj usługę</span>
            </button>

            <button
              type="button"
              disabled={isTriggeringPowerAction || updateJob?.state === 'running'}
              onClick={() => {
                setPowerActionMsg(null);
                setConfirmPowerAction((prev) => (prev === 'reboot' ? null : 'reboot'));
              }}
              className="px-3.5 py-2 rounded-lg bg-rose-950/70 hover:bg-rose-900/80 border border-rose-700/80 text-rose-200 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Power className="w-3.5 h-3.5" />
              <span>Restartuj system (Reboot)</span>
            </button>
          </div>
        </div>

        {confirmPowerAction === 'service' && (
          <div className="p-3.5 rounded-lg bg-sky-950/40 border border-sky-700/70 flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-sky-100">
              Czy na pewno chcesz zrestartować usługę HarmoniaBell? Połączenie z panelem zostanie przerwane na kilka sekund.
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={isTriggeringPowerAction}
                onClick={() => setConfirmPowerAction(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium cursor-pointer"
              >
                Anuluj
              </button>
              <button
                type="button"
                disabled={isTriggeringPowerAction}
                onClick={handleRestartService}
                className="px-3.5 py-1.5 rounded-lg bg-sky-400 hover:bg-sky-300 text-slate-950 font-bold cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                <RotateCw className={`w-3.5 h-3.5 ${isTriggeringPowerAction ? 'animate-spin' : ''}`} />
                <span>{isTriggeringPowerAction ? 'Restartowanie...' : 'Potwierdź restart usługi'}</span>
              </button>
            </div>
          </div>
        )}

        {confirmPowerAction === 'reboot' && (
          <div className="p-3.5 rounded-lg bg-rose-950/50 border border-rose-700/80 flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-rose-100">
              Uwaga: spowoduje to pełne ponowne uruchomienie serwera Debian 13. Wszystkie połączenia zostaną rozłączone do czasu ponownego startu systemu.
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={isTriggeringPowerAction}
                onClick={() => setConfirmPowerAction(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium cursor-pointer"
              >
                Anuluj
              </button>
              <button
                type="button"
                disabled={isTriggeringPowerAction}
                onClick={handleRebootSystem}
                className="px-3.5 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-400 text-white font-bold cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                <Power className="w-3.5 h-3.5" />
                <span>{isTriggeringPowerAction ? 'Wysyłanie reboot...' : 'Potwierdź restart systemu'}</span>
              </button>
            </div>
          </div>
        )}

        {powerActionMsg && (
          <div
            className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
              powerActionMsg.type === 'error'
                ? 'bg-rose-950/60 border-rose-800/80 text-rose-200'
                : powerActionMsg.type === 'success'
                ? 'bg-emerald-950/50 border-emerald-800/80 text-emerald-200'
                : 'bg-amber-950/50 border-amber-800/80 text-amber-200'
            }`}
          >
            {powerActionMsg.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span>{powerActionMsg.text}</span>
          </div>
        )}
      </div>

      {/* Update Check & Auto-Update Panel */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <RefreshCw className={`w-4 h-4 ${isCheckingUpdate || updateJob?.state === 'running' ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Sprawdzanie i Automatyczna Aktualizacja (Debian 13 &amp; Aplikacja)
              </h3>
              <p className="text-xs text-slate-400">
                Weryfikacja nowych wersji aplikacji (Git) oraz pakietów systemowych APT z możliwością instalacji jednym kliknięciem
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={updateTarget}
              onChange={(e) => setUpdateTarget(e.target.value as 'all' | 'app' | 'system')}
              disabled={updateJob?.state === 'running' || isStartingUpdate}
              aria-label="Zakres automatycznej aktualizacji"
              className="px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-amber-400 disabled:opacity-50"
            >
              <option value="all">Wszystko: Aplikacja + Debian</option>
              <option value="app">Tylko aplikacja (Git)</option>
              <option value="system">Tylko pakiety Debian (APT)</option>
            </select>

            <button
              onClick={handleCheckUpdates}
              disabled={isCheckingUpdate || updateJob?.state === 'running'}
              className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 border border-slate-600/70"
            >
              {isCheckingUpdate ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span>{isCheckingUpdate ? 'Sprawdzanie...' : 'Sprawdź aktualizacje'}</span>
            </button>

            <button
              onClick={handleRunAutoUpdate}
              disabled={isStartingUpdate || updateJob?.state === 'running'}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
            >
              {updateJob?.state === 'running' || isStartingUpdate ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ArrowUpCircle className="w-3.5 h-3.5" />
              )}
              <span>
                {updateJob?.state === 'running' ? 'Aktualizacja w toku...' : 'Aktualizuj automatycznie'}
              </span>
            </button>
          </div>
        </div>

        {/* Git Repository URL Configuration */}
        <form
          onSubmit={handleSaveGitConfig}
          className="p-3.5 rounded-lg bg-slate-900/70 border border-slate-700/70 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <Link2 className="w-3.5 h-3.5 text-amber-400" />
              <span>Konfiguracja repozytorium Git (link do aplikacji)</span>
            </div>
            {(gitConfig?.repoUrl || updateCheck?.git?.repoUrl) && (
              <span className="text-[11px] text-emerald-300 bg-emerald-950/60 border border-emerald-800/80 px-2 py-0.5 rounded font-mono truncate max-w-md">
                {gitConfig?.repoUrl || updateCheck?.git?.repoUrl}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
            <div className="md:col-span-7">
              <label className="block text-[11px] text-slate-400 mb-1">
                Adres URL repozytorium (HTTPS, SSH lub właściciel/repozytorium)
              </label>
              <input
                type="text"
                value={gitUrlInput}
                onChange={(e) => setGitUrlInput(e.target.value)}
                placeholder="https://github.com/dniesobski/ZSME-Bells.git"
                disabled={isSavingGitConfig || updateJob?.state === 'running'}
                className="w-full px-3 py-1.5 text-xs text-slate-100 bg-slate-950 border border-slate-700 rounded-lg focus:outline-none focus:border-amber-400 placeholder:text-slate-600 font-mono disabled:opacity-50"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-[11px] text-slate-400 mb-1">Gałąź (opcjonalnie)</label>
              <input
                type="text"
                value={gitBranchInput}
                onChange={(e) => setGitBranchInput(e.target.value)}
                placeholder="auto (main)"
                disabled={isSavingGitConfig || updateJob?.state === 'running'}
                className="w-full px-3 py-1.5 text-xs text-slate-100 bg-slate-950 border border-slate-700 rounded-lg focus:outline-none focus:border-amber-400 placeholder:text-slate-600 font-mono disabled:opacity-50"
              />
            </div>

            <div className="md:col-span-3 flex items-end gap-2">
              <button
                type="submit"
                disabled={isSavingGitConfig || updateJob?.state === 'running' || !gitUrlInput.trim()}
                className="flex-1 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                {isSavingGitConfig ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <GitBranch className="w-3.5 h-3.5" />
                )}
                <span>{isSavingGitConfig ? 'Łączenie...' : 'Zapisz i połącz'}</span>
              </button>

              {(gitConfig || updateCheck?.git?.hasRemote) && (
                <button
                  type="button"
                  onClick={handleDisconnectGitConfig}
                  disabled={isSavingGitConfig || updateJob?.state === 'running'}
                  title="Odłącz repozytorium Git"
                  className="px-2.5 py-1.5 text-xs font-medium text-rose-300 bg-rose-950/50 hover:bg-rose-900/60 border border-rose-800/70 disabled:opacity-50 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                >
                  <Unlink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {gitConfigMessage && (
            <div
              className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${
                gitConfigMessage.type === 'success'
                  ? 'bg-emerald-950/50 border-emerald-800/80 text-emerald-200'
                  : 'bg-rose-950/60 border-rose-800/80 text-rose-200'
              }`}
            >
              {gitConfigMessage.type === 'success' ? (
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              )}
              <span>{gitConfigMessage.text}</span>
            </div>
          )}
        </form>

        {updateError && (
          <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800/80 text-xs text-rose-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{updateError}</span>
          </div>
        )}

        {updateCheck ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            {/* System & App Version */}
            <div className="p-3.5 rounded-lg bg-slate-900/70 border border-slate-700/60 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-200 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Środowisko systemu</span>
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                    updateCheck.isRoot
                      ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                      : 'bg-slate-800 border-slate-700 text-slate-300'
                  }`}
                >
                  {updateCheck.isRoot ? 'root' : 'użytkownik'}
                </span>
              </div>
              <div className="space-y-1 text-slate-300">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">System:</span>
                  <span className="font-medium text-right">{updateCheck.osName}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">Wersja aplikacji:</span>
                  <span className="font-mono text-amber-300 tabular-nums">{updateCheck.appVersion}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">Node.js:</span>
                  <span className="font-mono tabular-nums">{updateCheck.nodeVersion}</span>
                </div>
                <div className="text-[11px] text-slate-500 pt-1 tabular-nums">
                  Ostatnie sprawdzenie: {new Date(updateCheck.checkedAt).toLocaleString('pl-PL')}
                </div>
              </div>
            </div>

            {/* Git / App Updates */}
            <div className="p-3.5 rounded-lg bg-slate-900/70 border border-slate-700/60 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-200 flex items-center gap-1.5">
                  <GitBranch className="w-4 h-4 text-amber-400" />
                  <span>Aplikacja HarmoniaBell</span>
                </span>
                {updateCheck.git.updateAvailable ? (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-950/70 border border-amber-700 text-amber-300 tabular-nums">
                    +{updateCheck.git.commitsBehind} nowsze
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-950/60 border border-emerald-800 text-emerald-300">
                    {updateCheck.git.available && updateCheck.git.hasRemote ? 'Aktualna' : 'Lokalna'}
                  </span>
                )}
              </div>
              <p className="text-slate-300 leading-relaxed">{updateCheck.git.note}</p>
              {updateCheck.git.repoUrl && (
                <div className="text-[11px] text-slate-400 font-mono truncate" title={updateCheck.git.repoUrl}>
                  Źródło: {updateCheck.git.repoUrl}
                </div>
              )}
              {updateCheck.git.branch && (
                <div className="text-[11px] text-slate-400 font-mono flex flex-wrap gap-x-3 gap-y-1">
                  <span>Gałąź: {updateCheck.git.branch}</span>
                  {updateCheck.git.currentCommit && <span>Commit: {updateCheck.git.currentCommit}</span>}
                </div>
              )}
              {updateCheck.git.latestMessage && (
                <div className="text-[11px] text-slate-400 truncate" title={updateCheck.git.latestMessage}>
                  Ostatnia zmiana: {updateCheck.git.latestMessage}
                </div>
              )}
            </div>

            {/* Debian APT Packages */}
            <div className="p-3.5 rounded-lg bg-slate-900/70 border border-slate-700/60 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-200 flex items-center gap-1.5">
                  <PackageCheck className="w-4 h-4 text-sky-400" />
                  <span>Pakiety Debian 13 (APT)</span>
                </span>
                {updateCheck.apt.available ? (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border tabular-nums ${
                      updateCheck.apt.upgradableCount > 0
                        ? 'bg-amber-950/70 border-amber-700 text-amber-300'
                        : 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                    }`}
                  >
                    {updateCheck.apt.upgradableCount > 0
                      ? `${updateCheck.apt.upgradableCount} do aktualizacji`
                      : 'Brak zaległych'}
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 border border-slate-700 text-slate-400">
                    Niedostępne
                  </span>
                )}
              </div>
              <p className="text-slate-300 leading-relaxed">{updateCheck.apt.note}</p>
              {updateCheck.apt.upgradablePackages.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1 max-h-16 overflow-y-auto">
                  {updateCheck.apt.upgradablePackages.slice(0, 12).map((pkg) => (
                    <span
                      key={pkg}
                      className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300"
                    >
                      {pkg}
                    </span>
                  ))}
                  {updateCheck.apt.upgradablePackages.length > 12 && (
                    <span className="text-[10px] text-slate-400 px-1 py-0.5">
                      +{updateCheck.apt.upgradablePackages.length - 12} więcej
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-3.5 rounded-lg bg-slate-900/50 border border-slate-700/50 text-xs text-slate-400 flex items-center justify-between gap-3">
            <span>
              Kliknij „Sprawdź aktualizacje”, aby zweryfikować dostępność poprawek aplikacji oraz pakietów Debian 13.
            </span>
          </div>
        )}

        {updateJob && updateJob.state !== 'idle' && (
          <div className="space-y-2 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-200">Dziennik aktualizacji:</span>
                {updateJob.state === 'running' && (
                  <span className="px-2 py-0.5 rounded bg-amber-950/70 border border-amber-700 text-amber-300 text-[11px] font-medium">
                    Wykonywanie...
                  </span>
                )}
                {updateJob.state === 'completed' && (
                  <span className="px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-700 text-emerald-300 text-[11px] font-medium">
                    Zakończono pomyślnie
                  </span>
                )}
                {updateJob.state === 'error' && (
                  <span className="px-2 py-0.5 rounded bg-rose-950/70 border border-rose-700 text-rose-300 text-[11px] font-medium">
                    Błąd aktualizacji
                  </span>
                )}
                {updateJob.restartScheduled && (
                  <span className="px-2 py-0.5 rounded bg-sky-950/70 border border-sky-700 text-sky-300 text-[11px] font-medium">
                    Zaplanowano restart usługi systemd
                  </span>
                )}
              </div>
              {updateJob.finishedAt && (
                <span className="text-[11px] text-slate-500 tabular-nums">
                  Zakończono: {new Date(updateJob.finishedAt).toLocaleTimeString('pl-PL')}
                </span>
              )}
            </div>

            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 max-h-52 overflow-y-auto space-y-1">
              {updateJob.logs.map((line, index) => (
                <div key={index} className="whitespace-pre-wrap break-all leading-relaxed">
                  {line}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* 1-Click Installer Files */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* install-debian.sh card */}
        <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700/80 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white font-bold text-sm">
                <FileCode className="w-4 h-4 text-amber-400" />
                <span>Skrypt instalatora: install-debian.sh</span>
              </div>
              <span className="text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2 py-0.5 rounded">
                Gotowy
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-2">
              Samodzielny skrypt Bash, który instaluje Node.js, `mpv`, ALSA, konfiguruje katalog `/opt/harmonia-bell` oraz uruchamia usługę systemd.
            </p>
          </div>

          <div className="pt-2 flex items-center gap-2">
            <button
              onClick={() => handleDownloadFile('install-debian.sh', bashScriptContent, 'text/x-shellscript')}
              className="px-3 py-1.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Pobierz install-debian.sh</span>
            </button>
            <button
              onClick={() => copyToClipboard(bashScriptContent, 'installer')}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
            >
              {copiedSection === 'installer' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSection === 'installer' ? 'Skopiowano!' : 'Kopiuj kod'}</span>
            </button>
          </div>
        </div>

        {/* systemd service card */}
        <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700/80 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white font-bold text-sm">
                <FileText className="w-4 h-4 text-amber-400" />
                <span>Plik usługi: harmonia-bell.service</span>
              </div>
              <span className="text-[10px] text-amber-300 bg-amber-950/60 border border-amber-800 px-2 py-0.5 rounded">
                systemd
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-2">
              Plik jednostki `/etc/systemd/system/harmonia-bell.service` zapewniający autostart dzwonków po włączeniu zasilania oraz restart w przypadku awarii.
            </p>
          </div>

          <div className="pt-2 flex items-center gap-2">
            <button
              onClick={() =>
                handleDownloadFile('harmonia-bell.service', systemdServiceContent, 'text/plain')
              }
              className="px-3 py-1.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Pobierz harmonia-bell.service</span>
            </button>
            <button
              onClick={() => copyToClipboard(systemdServiceContent, 'systemd')}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
            >
              {copiedSection === 'systemd' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSection === 'systemd' ? 'Skopiowano!' : 'Kopiuj treść'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Terminal Steps Guide */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-700/60">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Terminal className="w-4 h-4 text-amber-400" />
            Szybka Instalacja w Terminalu Debian 13
          </h3>
          <button
            onClick={() => copyToClipboard(quickInstallCommand, 'quickCmd')}
            className="px-2.5 py-1 text-xs text-slate-300 hover:text-white bg-slate-700 rounded flex items-center gap-1 cursor-pointer"
          >
            {copiedSection === 'quickCmd' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>Kopiuj wszystkie polecenia</span>
          </button>
        </div>

        <div className="p-4 rounded-lg bg-slate-950 font-mono text-xs text-amber-300/90 overflow-x-auto whitespace-pre leading-relaxed border border-slate-800">
          {quickInstallCommand}
        </div>
      </div>

      {/* Hardware Connection: PC to School PA Amplifier */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-700/60">
          <Cable className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Podłączenie Sprzętowe Komputera do Wzmacniacza Radiowęzłowego (100V)
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-3.5 rounded-lg bg-slate-900/70 border border-slate-700/60 space-y-2">
            <div className="font-bold text-amber-300 flex items-center gap-1.5">
              <span>1. Wyjście Audio z Debiana</span>
            </div>
            <p className="text-slate-300 leading-relaxed">
              Użyj gniazda mini-jack 3.5mm w komputerze lub dedykowanej karty USB DAC (np. Behringer U-Control lub iBasso).
              Zapewnia to separację od szumów procesora i płyty głównej.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-900/70 border border-slate-700/60 space-y-2">
            <div className="font-bold text-amber-300 flex items-center gap-1.5">
              <span>2. Izolator Masy (Ważne!)</span>
            </div>
            <p className="text-slate-300 leading-relaxed">
              Zalecamy wpięcie pomiędzy komputer a wzmacniacz pasywnego izolatora masy (Ground Loop Isolator 1:1, koszt ok. 35 zł).
              Całkowicie eliminuje to przydźwięk sieciowy (buczenie 50 Hz w głośnikach szkolnych).
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-900/70 border border-slate-700/60 space-y-2">
            <div className="font-bold text-amber-300 flex items-center gap-1.5">
              <span>3. Wejście AUX / LINE IN</span>
            </div>
            <p className="text-slate-300 leading-relaxed">
              Podłącz przewód do gniazda AUX lub LINE IN wzmacniacza szkolnego (Rduch, Monacor, Tonsil).
              Ustaw suwak wzmocnienia kanału na ok. 60-70% i przetestuj dzwonek przyciskiem "Test Głośnika".
            </p>
          </div>
        </div>
      </div>

      {/* Useful system commands */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider pb-2 border-b border-slate-700/60">
          Przydatne Polecenia Konsolowe w Debian 13
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-700/60">
            <span className="text-slate-400 block mb-1">Sprawdzenie statusu usługi dzwonków:</span>
            <code className="text-amber-300 font-mono font-bold block bg-slate-950 p-2 rounded">
              systemctl status harmonia-bell
            </code>
          </div>

          <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-700/60">
            <span className="text-slate-400 block mb-1">Podgląd dziennika logów w czasie rzeczywistym:</span>
            <code className="text-amber-300 font-mono font-bold block bg-slate-950 p-2 rounded">
              journalctl -u harmonia-bell -f
            </code>
          </div>

          <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-700/60">
            <span className="text-slate-400 block mb-1">Test karty dźwiękowej ALSA:</span>
            <code className="text-amber-300 font-mono font-bold block bg-slate-950 p-2 rounded">
              speaker-test -t sine -f 440 -c 2 -l 1
            </code>
          </div>

          <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-700/60">
            <span className="text-slate-400 block mb-1">Regulacja miksera sprzętowego ALSA:</span>
            <code className="text-amber-300 font-mono font-bold block bg-slate-950 p-2 rounded">
              alsamixer
            </code>
          </div>

          <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-700/60 md:col-span-2">
            <span className="text-slate-400 block mb-1">
              Uruchomienie pełnoekranowego widoku na telewizorze szkolnym (tryb kiosku):
            </span>
            <code className="text-amber-300 font-mono font-bold block bg-slate-950 p-2 rounded">
              chromium --kiosk --noerrdialogs --disable-infobars http://ADRES_IP_DEBIANA:3000/tv
            </code>
          </div>
        </div>
      </div>
    </div>
  );
};
