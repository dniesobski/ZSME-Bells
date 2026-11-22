import React, { useState, useEffect, useCallback } from 'react';
import { Volume2, Speaker, Save, Check, Plus, Trash2, Cpu, Power, Terminal, RefreshCw } from 'lucide-react';
import { AppConfig, DetectedSerialPort, SystemStatus, VolumeRule } from '../types/bell';
import { apiFetch } from '../utils/apiClient';

interface VolumeViewProps {
  config: AppConfig;
  status: SystemStatus | null;
  onSaveConfig: (updatedConfig: AppConfig) => Promise<void>;
  onTestSpeaker: () => Promise<void>;
  onControlAmplifier: (
    action: 'on' | 'off' | 'auto',
    options?: { devicePath?: string; appendNewline?: boolean }
  ) => Promise<void>;
}

export const VolumeView: React.FC<VolumeViewProps> = ({
  config,
  status,
  onSaveConfig,
  onTestSpeaker,
  onControlAmplifier,
}) => {
  const [masterVolume, setMasterVolume] = useState<number>(config.masterVolume);
  const [volumeRules, setVolumeRules] = useState<VolumeRule[]>(config.volumeSchedule);
  const [warningBellEnabled, setWarningBellEnabled] = useState(config.warningBellEnabled);
  const [defaultWarningMinutes, setDefaultWarningMinutes] = useState(config.defaultWarningMinutes);
  const [soundFadeInMs, setSoundFadeInMs] = useState(config.soundFadeInMs || 250);
  const [audioEngine, setAudioEngine] = useState(config.audioEngine || 'auto');
  const [audioDevice, setAudioDevice] = useState(config.audioDevice || 'default');
  const [amplifierControlEnabled, setAmplifierControlEnabled] = useState(
    Boolean(config.amplifierControlEnabled)
  );
  const [amplifierDevicePath, setAmplifierDevicePath] = useState(
    config.amplifierDevicePath || '/dev/tty1'
  );
  const [amplifierAppendNewline, setAmplifierAppendNewline] = useState(
    Boolean(config.amplifierAppendNewline)
  );
  const [isTestingAmp, setIsTestingAmp] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Available audio devices & serial ports from Linux
  const [detectedDevices, setDetectedDevices] = useState<{ id: string; name: string }[]>([]);
  const [detectedSerialPorts, setDetectedSerialPorts] = useState<DetectedSerialPort[]>([]);
  const [isLoadingSerialPorts, setIsLoadingSerialPorts] = useState(false);

  const fetchDetectedSerialPorts = useCallback(async () => {
    setIsLoadingSerialPorts(true);
    try {
      const res = await apiFetch('/api/amplifier/ports');
      if (!res.ok) return;
      const data = await res.json();
      if (data && Array.isArray(data.ports)) {
        setDetectedSerialPorts(data.ports);
      }
    } catch {
      // ignore transient errors
    } finally {
      setIsLoadingSerialPorts(false);
    }
  }, []);

  useEffect(() => {
    apiFetch('/api/audio-devices')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.devices) {
          setDetectedDevices(data.devices);
        }
      })
      .catch(() => {});

    void fetchDetectedSerialPorts();
  }, [fetchDetectedSerialPorts]);

  const handleAddRule = () => {
    const newRule: VolumeRule = {
      id: `v_${Date.now()}`,
      name: 'Strefa czasowa',
      timeFrom: '11:45',
      timeTo: '13:00',
      volumePercent: 85,
    };
    setVolumeRules([...volumeRules, newRule]);
  };

  const handleDeleteRule = (id: string) => {
    setVolumeRules(volumeRules.filter((r) => r.id !== id));
  };

  const handleUpdateRule = (id: string, updates: Partial<VolumeRule>) => {
    setVolumeRules(volumeRules.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  };

  const handleTest = async () => {
    try {
      setIsTesting(true);
      setTestResult('Wysyłanie próbki dźwiękowej na kartę dźwiękową...');
      await onTestSpeaker();
      setTestResult('Dźwięk testowy odtworzony!');
      setTimeout(() => setTestResult(null), 3500);
    } catch {
      setTestResult('Błąd testu audio.');
      setTimeout(() => setTestResult(null), 3500);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await onSaveConfig({
        ...config,
        masterVolume,
        volumeSchedule: volumeRules,
        warningBellEnabled,
        defaultWarningMinutes,
        soundFadeInMs,
        audioEngine: audioEngine as any,
        audioDevice,
        amplifierControlEnabled,
        amplifierDevicePath: amplifierDevicePath.trim() || '/dev/tty1',
        amplifierAppendNewline,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestAmplifier = async (action: 'on' | 'off') => {
    try {
      setIsTestingAmp(true);
      await onControlAmplifier(action, {
        devicePath: amplifierDevicePath.trim(),
        appendNewline: amplifierAppendNewline,
      });
    } finally {
      setIsTestingAmp(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-amber-400" />
            Ustawienia Głośności i Wyjścia Audio (Debian 13)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Dopasuj poziom głośności w zależności od pory dnia oraz skonfiguruj kartę dźwiękową ALSA / PulseAudio
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isTesting}
            onClick={handleTest}
            className="px-3.5 py-2 text-xs font-medium text-slate-300 bg-slate-700/80 hover:bg-slate-700 border border-slate-600/70 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Speaker className="w-3.5 h-3.5 text-amber-400" />
            <span>{isTesting ? 'Odtwarzanie...' : 'Przetestuj Głośnik'}</span>
          </button>

          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
          >
            {saveSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            <span>{isSaving ? 'Zapisywanie...' : saveSuccess ? 'Zapisano!' : 'Zapisz Ustawienia'}</span>
          </button>
        </div>
      </div>

      {testResult && (
        <div className="p-3 rounded-lg bg-slate-800 border border-amber-500/40 text-amber-300 text-xs text-center font-mono animate-fade-in">
          {testResult}
        </div>
      )}

      {/* Grid: Master volume & Schedule */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Master Volume & Acoustic Controls (5 cols) */}
        <div className="lg:col-span-5 bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-5">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider pb-2 border-b border-slate-700/60">
            Główna Głośność i Akustyka
          </h3>

          {/* Master Volume Slider */}
          <div>
            <div className="flex items-center justify-between text-xs text-slate-200 mb-2">
              <span className="font-semibold">Poziom Głośności Głównej</span>
              <span className="text-base font-bold font-mono tabular-nums text-amber-300">{masterVolume}%</span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              value={masterVolume}
              onChange={(e) => setMasterVolume(Number(e.target.value))}
              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
            />
            <p className="text-[11px] text-slate-400 mt-1.5">
              Stosowana jako domyślna głośność dla wszystkich dzwonków szkolnych poza zaplanowanymi strefami czasowymi.
            </p>
          </div>

          {/* Soft Attack Fade-in */}
          <div>
            <div className="flex items-center justify-between text-xs text-slate-200 mb-1">
              <span className="font-semibold">Czas narastania dźwięku (Soft Attack)</span>
              <span className="font-mono text-amber-300">{soundFadeInMs} ms</span>
            </div>
            <select
              value={soundFadeInMs}
              onChange={(e) => setSoundFadeInMs(Number(e.target.value))}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-400"
            >
              <option value={100}>100 ms (Szybki atak)</option>
              <option value={250}>250 ms (Zalecany - optymalna bezstresowość)</option>
              <option value={500}>500 ms (Bardzo płynny, aksamitny wstęp)</option>
              <option value={800}>800 ms (Dla szkół specjalnych i przedszkoli)</option>
            </select>
          </div>

          {/* Warning pre-bell switch */}
          <div className="pt-2 border-t border-slate-700/60 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-semibold text-xs text-slate-200 block">Dzwonek Przywoławczy (Pre-Bell)</span>
                <span className="text-[11px] text-slate-400">
                  Krótki, dyskretny sygnał przed końcem przerwy
                </span>
              </div>
              <input
                type="checkbox"
                checked={warningBellEnabled}
                onChange={(e) => setWarningBellEnabled(e.target.checked)}
                className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
              />
            </div>

            {warningBellEnabled && (
              <div className="pt-2 flex items-center justify-between text-xs">
                <span className="text-slate-300">Ile minut przed dzwonkiem na lekcję:</span>
                <select
                  value={defaultWarningMinutes}
                  onChange={(e) => setDefaultWarningMinutes(Number(e.target.value))}
                  className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-amber-300"
                >
                  <option value={1}>1 minuta</option>
                  <option value={2}>2 minuty</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Right: Hourly Volume Schedule (7 cols) */}
        <div className="lg:col-span-7 bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-700/60">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Harmonogram Głośności w Ciągu Dnia
              </h3>
              <p className="text-xs text-slate-400">
                Automatyczne dopasowanie poziomu hałasu (np. cichsze dzwonki o 8:00, głośniejsze na korytarzu w południe)
              </p>
            </div>
            <button
              onClick={handleAddRule}
              className="px-2.5 py-1 text-xs font-medium text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded transition-colors cursor-pointer flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              <span>Dodaj strefę</span>
            </button>
          </div>

          <div className="space-y-2.5">
            {volumeRules.map((rule) => (
              <div
                key={rule.id}
                className="p-3 rounded-lg bg-slate-900/70 border border-slate-700/60 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center text-xs"
              >
                <div className="sm:col-span-4">
                  <label className="text-[10px] text-slate-400 block mb-0.5">Nazwa strefy</label>
                  <input
                    type="text"
                    value={rule.name}
                    onChange={(e) => handleUpdateRule(rule.id, { name: e.target.value })}
                    className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-200 text-xs"
                  />
                </div>

                <div className="sm:col-span-4 flex items-center gap-1.5">
                  <div className="w-1/2">
                    <label className="text-[10px] text-slate-400 block mb-0.5">Od</label>
                    <input
                      type="time"
                      value={rule.timeFrom}
                      onChange={(e) => handleUpdateRule(rule.id, { timeFrom: e.target.value })}
                      className="w-full px-1.5 py-1 bg-slate-800 border border-slate-700 rounded text-slate-200 font-mono text-xs"
                    />
                  </div>
                  <div className="w-1/2">
                    <label className="text-[10px] text-slate-400 block mb-0.5">Do</label>
                    <input
                      type="time"
                      value={rule.timeTo}
                      onChange={(e) => handleUpdateRule(rule.id, { timeTo: e.target.value })}
                      className="w-full px-1.5 py-1 bg-slate-800 border border-slate-700 rounded text-slate-200 font-mono text-xs"
                    />
                  </div>
                </div>

                <div className="sm:col-span-3">
                  <div className="flex justify-between text-[11px] text-slate-300 mb-0.5">
                    <span>Głośność</span>
                    <span className="font-mono text-amber-300 font-bold">{rule.volumePercent}%</span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="100"
                    value={rule.volumePercent}
                    onChange={(e) => handleUpdateRule(rule.id, { volumePercent: Number(e.target.value) })}
                    className="w-full h-1.5 bg-slate-700 rounded appearance-none cursor-pointer accent-amber-400"
                  />
                </div>

                <div className="sm:col-span-1 text-right">
                  <button
                    type="button"
                    onClick={() => handleDeleteRule(rule.id)}
                    className="p-1 text-slate-400 hover:text-rose-400 rounded cursor-pointer"
                    title="Usuń"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Linux Debian 13 Sound Hardware Config */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-700/60">
          <Cpu className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Konfiguracja Karty Dźwiękowej i Silnika Linux (Debian 13)
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block text-slate-300 font-medium mb-1">
              Silnik odtwarzania w Debianie (Player binary)
            </label>
            <select
              value={audioEngine}
              onChange={(e) => setAudioEngine(e.target.value as any)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-amber-400"
            >
              <option value="auto">Auto-detect (mpv &gt; paplay &gt; aplay &gt; ffplay)</option>
              <option value="mpv">mpv (Zalecany - bezstratny, niski jitter)</option>
              <option value="paplay">paplay (PulseAudio client)</option>
              <option value="aplay">aplay (Bezpośredni sterownik ALSA kernel)</option>
              <option value="ffplay">ffplay (FFmpeg multimedia)</option>
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              Domyślny tryb auto wykrywa zainstalowane pakiety audio w systemie Debian 13.
            </p>
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">
              Urządzenie wyjściowe audio (ALSA Sink / Device)
            </label>
            <select
              value={audioDevice}
              onChange={(e) => setAudioDevice(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-amber-400"
            >
              <option value="default">Domyślne wyjście systemowe (System Default)</option>
              {detectedDevices
                .filter((d) => d.id !== 'default')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              <option value="hw:0,0">hw:0,0 (Zintegrowana karta analogowa Jack 3.5mm)</option>
              <option value="hw:1,0">hw:1,0 (Karta zewnętrzna USB DAC / Radiowęzeł)</option>
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              Wybierz gniazdo, do którego podłączony jest przewód AUX / XLR szkolnego wzmacniacza radiowęzłowego.
            </p>
          </div>
        </div>
      </div>

      {/* Amplifier Power Controller Device Path (/dev/tty1 etc.) */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <Power className="w-4 h-4 text-amber-400" />
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Sterownik Wzmacniacza (Zasilanie przez urządzenie Linux)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Wysłanie <code className="font-mono text-emerald-300 font-bold">1</code> do wskazanego urządzenia uruchamia wzmacniacz, a wysłanie{' '}
                <code className="font-mono text-rose-300 font-bold">0</code> wyłącza go
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {status?.amplifierStatus && (
              <span
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                  status.amplifierStatus.powerState === 'on'
                    ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                    : status.amplifierStatus.powerState === 'off'
                    ? 'bg-slate-900 border-slate-700 text-slate-300'
                    : 'bg-slate-900 border-slate-700 text-slate-400'
                }`}
              >
                {status.amplifierStatus.powerState === 'on'
                  ? 'Stan: WŁĄCZONY (1)'
                  : status.amplifierStatus.powerState === 'off'
                  ? 'Stan: WYŁĄCZONY (0)'
                  : 'Stan: Nieznany'}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 text-xs">
          <div className="lg:col-span-7 space-y-3">
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Ścieżka do sterownika / urządzenia wzmacniacza
              </label>
              <div className="relative">
                <Terminal className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={amplifierDevicePath}
                  onChange={(e) => setAmplifierDevicePath(e.target.value)}
                  placeholder="/dev/tty1"
                  className="w-full pl-8 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-amber-300 font-mono text-xs focus:outline-none focus:border-amber-400 placeholder:text-slate-600"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                Wpisz ścieżkę urządzenia w <code className="font-mono text-slate-200">/dev/</code> lub wybierz wykryty port szeregowy poniżej.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-700/60 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-300">
                  Wykryte porty ({detectedSerialPorts.length}):
                </span>
                <button
                  type="button"
                  onClick={() => void fetchDetectedSerialPorts()}
                  disabled={isLoadingSerialPorts}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-300 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 text-amber-400 ${isLoadingSerialPorts ? 'animate-spin' : ''}`} />
                  <span>{isLoadingSerialPorts ? 'Skanowanie...' : 'Odśwież porty'}</span>
                </button>
              </div>

              {detectedSerialPorts.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {detectedSerialPorts.map((port) => {
                    const isSelected = amplifierDevicePath === port.path;
                    return (
                      <button
                        key={port.path}
                        type="button"
                        onClick={() => setAmplifierDevicePath(port.path)}
                        title={
                          port.byIdPath
                            ? `${port.description} · stały link: ${port.byIdPath}`
                            : port.description
                        }
                        className={`px-2.5 py-1 rounded-md text-left border transition-colors cursor-pointer flex items-center gap-2 ${
                          isSelected
                            ? 'bg-amber-400/15 border-amber-500/70 text-amber-300'
                            : 'bg-slate-950/70 border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
                        }`}
                      >
                        <span className="font-mono text-[11px] font-semibold">{port.path}</span>
                        <span className="text-[10px] text-slate-400">{port.description}</span>
                        {!port.writable && (
                          <span className="text-[10px] text-rose-400 font-medium">(brak zapisu)</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-slate-400">
                  {isLoadingSerialPorts
                    ? 'Skanowanie urządzeń szeregowych w systemie...'
                    : 'Nie wykryto dostępnych portów szeregowych w systemie (np. ttyUSB, ttyACM, aktywne ttyS). Podłącz adapter lub wpisz ścieżkę ręcznie powyżej.'}
                </p>
              )}
            </div>

            <div className="pt-1 space-y-2">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={amplifierControlEnabled}
                  onChange={(e) => setAmplifierControlEnabled(e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
                />
                <span className="text-slate-200 font-medium">
                  Aktywuj automatyczne sterowanie wzmacniaczem według harmonogramu (zakładka Harmonogramy)
                </span>
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={amplifierAppendNewline}
                  onChange={(e) => setAmplifierAppendNewline(e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
                />
                <span className="text-slate-300">
                  Dodaj znak nowej linii po sygnale (<code className="font-mono">1\n</code> /{' '}
                  <code className="font-mono">0\n</code>, jak polecenie <code className="font-mono">echo</code>)
                </span>
              </label>
            </div>
          </div>

          <div className="lg:col-span-5 p-4 rounded-lg bg-slate-900/70 border border-slate-700/60 flex flex-col justify-between space-y-3">
            <div className="space-y-1.5">
              <span className="font-semibold text-slate-200 block">Test ręczny sterownika wzmacniacza</span>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Wyślij sygnał bezpośrednio do wpisanego urządzenia, aby sprawdzić załączanie i wyłączanie przekaźnika wzmacniacza.
              </p>
              {status?.amplifierStatus?.lastResult && (
                <div className="p-2 rounded bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300 break-words">
                  {status.amplifierStatus.lastResult}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={isTestingAmp}
                onClick={() => handleTestAmplifier('on')}
                className="flex-1 px-3 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Power className="w-3.5 h-3.5" />
                <span>Włącz (wyślij 1)</span>
              </button>

              <button
                type="button"
                disabled={isTestingAmp}
                onClick={() => handleTestAmplifier('off')}
                className="flex-1 px-3 py-2 text-xs font-semibold text-rose-100 bg-rose-700 hover:bg-rose-600 disabled:opacity-50 rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Power className="w-3.5 h-3.5" />
                <span>Wyłącz (wyślij 0)</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
