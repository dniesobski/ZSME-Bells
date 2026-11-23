import React, { useState, useEffect, useCallback } from 'react';
import {
  Volume2,
  Speaker,
  Save,
  Check,
  Plus,
  Trash2,
  Cpu,
  Power,
  Terminal,
  RefreshCw,
  Tv,
  Palette,
  RotateCcw,
  Eye,
  Type,
  LayoutGrid,
} from 'lucide-react';
import { AppConfig, DetectedSerialPort, SystemStatus, TvDisplayConfig, VolumeRule } from '../types/bell';
import { DEFAULT_TV_DISPLAY_CONFIG } from '../data/defaultConfig';
import { apiFetch } from '../utils/apiClient';

interface TvColorPreset {
  id: string;
  label: string;
  colors: Pick<
    TvDisplayConfig,
    | 'backgroundColor'
    | 'panelColor'
    | 'textColor'
    | 'mutedTextColor'
    | 'accentColor'
    | 'lessonColor'
    | 'breakColor'
  >;
}

const TV_COLOR_PRESETS: TvColorPreset[] = [
  {
    id: 'default_dark',
    label: 'Domyślny Ciemny',
    colors: {
      backgroundColor: DEFAULT_TV_DISPLAY_CONFIG.backgroundColor,
      panelColor: DEFAULT_TV_DISPLAY_CONFIG.panelColor,
      textColor: DEFAULT_TV_DISPLAY_CONFIG.textColor,
      mutedTextColor: DEFAULT_TV_DISPLAY_CONFIG.mutedTextColor,
      accentColor: DEFAULT_TV_DISPLAY_CONFIG.accentColor,
      lessonColor: DEFAULT_TV_DISPLAY_CONFIG.lessonColor,
      breakColor: DEFAULT_TV_DISPLAY_CONFIG.breakColor,
    },
  },
  {
    id: 'school_navy',
    label: 'Granat Szkolny',
    colors: {
      backgroundColor: '#071126',
      panelColor: '#0f2147',
      textColor: '#f8fafc',
      mutedTextColor: '#94a3b8',
      accentColor: '#38bdf8',
      lessonColor: '#60a5fa',
      breakColor: '#34d399',
    },
  },
  {
    id: 'high_contrast',
    label: 'Wysoki Kontrast',
    colors: {
      backgroundColor: '#000000',
      panelColor: '#111827',
      textColor: '#ffffff',
      mutedTextColor: '#d1d5db',
      accentColor: '#facc15',
      lessonColor: '#fb923c',
      breakColor: '#4ade80',
    },
  },
  {
    id: 'light_day',
    label: 'Jasny Dzienny',
    colors: {
      backgroundColor: '#f1f5f9',
      panelColor: '#ffffff',
      textColor: '#0f172a',
      mutedTextColor: '#475569',
      accentColor: '#d97706',
      lessonColor: '#b45309',
      breakColor: '#059669',
    },
  },
];

function previewHexToRgba(hex: string, alpha: number): string {
  const clean = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.slice(1) : '0f172a';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type TvColorField =
  | 'backgroundColor'
  | 'panelColor'
  | 'textColor'
  | 'mutedTextColor'
  | 'accentColor'
  | 'lessonColor'
  | 'breakColor';

type TvToggleField =
  | 'showHeader'
  | 'showDate'
  | 'showClockSeconds'
  | 'showProgressBar'
  | 'showNextBellBlock'
  | 'showRadioBlock'
  | 'showScheduleStrip';

const TV_BLOCK_OPTIONS: { key: TvToggleField; label: string; hint: string }[] = [
  { key: 'showHeader', label: 'Nagłówek z nazwą szkoły i profilem', hint: 'Górny pasek informacyjny na ekranie TV' },
  { key: 'showDate', label: 'Data i status systemu w nagłówku', hint: 'Bieżąca data oraz stan aktywności dzwonków' },
  { key: 'showClockSeconds', label: 'Sekundy w zegarze głównym', hint: 'Wyświetla GG:MM:SS zamiast samego GG:MM' },
  { key: 'showProgressBar', label: 'Pasek postępu i odliczanie lekcji/przerwy', hint: 'Procent postępu, pozostały czas i pasek na dole karty' },
  { key: 'showNextBellBlock', label: 'Blok "Następny Dzwonek"', hint: 'Prawa górna karta z godziną i nazwą kolejnego dzwonka' },
  { key: 'showRadioBlock', label: 'Blok "Radiowęzeł Szkolny"', hint: 'Prawa dolna karta ze statusem odtwarzania radia' },
  { key: 'showScheduleStrip', label: 'Dolny pasek z rozkładem lekcji', hint: 'Kafelki wszystkich aktywnych lekcji na dziś' },
];

const TV_COLOR_FIELDS: { key: TvColorField; label: string; hint: string }[] = [
  { key: 'backgroundColor', label: 'Tło całego ekranu', hint: 'Główne tło strony /tv' },
  { key: 'panelColor', label: 'Tło paneli i kart', hint: 'Kafelki dzwonka, radia i lekcji' },
  { key: 'textColor', label: 'Tekst główny', hint: 'Zegar, nagłówki i główne opisy' },
  { key: 'mutedTextColor', label: 'Tekst pomocniczy', hint: 'Podpisy, godziny i etykiety' },
  { key: 'accentColor', label: 'Kolor akcentu', hint: 'Ikony, nazwa profilu, ogłoszenia' },
  { key: 'lessonColor', label: 'Kolor lekcji', hint: 'Karta i pasek w trakcie trwania lekcji' },
  { key: 'breakColor', label: 'Kolor przerwy / odliczania', hint: 'Przerwa, status radia i licznik czasu' },
];

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
  const [tvDisplay, setTvDisplay] = useState<TvDisplayConfig>(() => ({
    ...DEFAULT_TV_DISPLAY_CONFIG,
    ...(config.tvDisplay || {}),
  }));
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

  useEffect(() => {
    setTvDisplay({
      ...DEFAULT_TV_DISPLAY_CONFIG,
      ...(config.tvDisplay || {}),
    });
  }, [config.tvDisplay]);

  const updateTvDisplay = (patch: Partial<TvDisplayConfig>) => {
    setTvDisplay((prev) => ({ ...prev, ...patch }));
  };

  const applyTvColorPreset = (preset: TvColorPreset) => {
    setTvDisplay((prev) => ({ ...prev, ...preset.colors }));
  };

  const resetTvDisplayToDefaults = () => {
    setTvDisplay({ ...DEFAULT_TV_DISPLAY_CONFIG });
  };

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
      const validHex = (val: string, fallback: string) =>
        /^#[0-9a-fA-F]{6}$/.test(val.trim()) ? val.trim().toLowerCase() : fallback;

      const normalizedTvDisplay: TvDisplayConfig = {
        ...tvDisplay,
        backgroundColor: validHex(tvDisplay.backgroundColor, DEFAULT_TV_DISPLAY_CONFIG.backgroundColor),
        panelColor: validHex(tvDisplay.panelColor, DEFAULT_TV_DISPLAY_CONFIG.panelColor),
        textColor: validHex(tvDisplay.textColor, DEFAULT_TV_DISPLAY_CONFIG.textColor),
        mutedTextColor: validHex(tvDisplay.mutedTextColor, DEFAULT_TV_DISPLAY_CONFIG.mutedTextColor),
        accentColor: validHex(tvDisplay.accentColor, DEFAULT_TV_DISPLAY_CONFIG.accentColor),
        lessonColor: validHex(tvDisplay.lessonColor, DEFAULT_TV_DISPLAY_CONFIG.lessonColor),
        breakColor: validHex(tvDisplay.breakColor, DEFAULT_TV_DISPLAY_CONFIG.breakColor),
      };
      setTvDisplay(normalizedTvDisplay);

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
        tvDisplay: normalizedTvDisplay,
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

      {/* Public TV Screen Customization (/tv) */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2.5">
            <Tv className="w-4 h-4 text-amber-400" />
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Personalizacja Publicznego Ekranu TV (Teksty, Bloki i Kolory)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Dostosuj napisy nagłówków, widoczność poszczególnych sekcji oraz paletę kolorów wyświetlaną na ekranie{' '}
                <code className="font-mono text-amber-300">/tv</code>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={resetTvDisplayToDefaults}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-900 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              <span>Przywróć domyślne</span>
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
            >
              {saveSuccess ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              <span>{isSaving ? 'Zapisywanie...' : saveSuccess ? 'Zapisano!' : 'Zapisz ustawienia TV'}</span>
            </button>
          </div>
        </div>

        {/* Color Presets Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-slate-900/60 border border-slate-700/60">
          <div className="flex items-center gap-2 text-xs text-slate-300 font-medium">
            <Palette className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Szybkie motywy kolorystyczne:</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {TV_COLOR_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyTvColorPreset(preset)}
                className="px-2.5 py-1.5 rounded-md bg-slate-950/80 hover:bg-slate-800 border border-slate-700 text-[11px] text-slate-200 flex items-center gap-2 transition-colors cursor-pointer"
              >
                <span className="flex items-center -space-x-1">
                  <span
                    className="w-3 h-3 rounded-full border border-white/20"
                    style={{ backgroundColor: preset.colors.backgroundColor }}
                  />
                  <span
                    className="w-3 h-3 rounded-full border border-white/20"
                    style={{ backgroundColor: preset.colors.accentColor }}
                  />
                  <span
                    className="w-3 h-3 rounded-full border border-white/20"
                    style={{ backgroundColor: preset.colors.breakColor }}
                  />
                </span>
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Live Mini-Preview */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-amber-400" />
              Podgląd układu i kolorów ekranu TV na żywo
            </span>
            <span className="text-[11px] text-slate-400">
              Zmiany są widoczne natychmiast na podglądzie — kliknij Zapisz, aby wysłać na ekran TV
            </span>
          </div>

          <div
            className="rounded-xl border border-slate-700 p-4 space-y-3 transition-colors duration-200"
            style={{
              backgroundColor: /^#[0-9a-fA-F]{6}$/.test(tvDisplay.backgroundColor)
                ? tvDisplay.backgroundColor
                : DEFAULT_TV_DISPLAY_CONFIG.backgroundColor,
              color: /^#[0-9a-fA-F]{6}$/.test(tvDisplay.textColor)
                ? tvDisplay.textColor
                : DEFAULT_TV_DISPLAY_CONFIG.textColor,
            }}
          >
            {tvDisplay.showHeader && (
              <div
                className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b"
                style={{ borderColor: previewHexToRgba(tvDisplay.textColor, 0.14) }}
              >
                <div>
                  <div className="text-sm font-bold leading-tight">
                    {tvDisplay.headerTitle.trim() || config.schoolSubtitle || config.schoolName}
                  </div>
                  <div className="text-[11px]" style={{ color: tvDisplay.mutedTextColor }}>
                    {tvDisplay.headerSubtitlePrefix ? `${tvDisplay.headerSubtitlePrefix} ` : ''}
                    <span className="font-semibold" style={{ color: tvDisplay.accentColor }}>
                      Standardowy (45 min)
                    </span>
                  </div>
                </div>
                {tvDisplay.showDate && (
                  <div className="text-right text-[11px]" style={{ color: tvDisplay.mutedTextColor }}>
                    <div className="font-semibold" style={{ color: tvDisplay.textColor }}>
                      Poniedziałek, 23 listopada
                    </div>
                    <div>System dzwonków aktywny</div>
                  </div>
                )}
              </div>
            )}

            {tvDisplay.announcementText.trim() && (
              <div
                className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
                style={{
                  backgroundColor: previewHexToRgba(tvDisplay.accentColor, 0.14),
                  borderColor: previewHexToRgba(tvDisplay.accentColor, 0.45),
                }}
              >
                {tvDisplay.announcementText}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div
                className={`${
                  tvDisplay.showNextBellBlock || tvDisplay.showRadioBlock ? 'md:col-span-7' : 'md:col-span-12'
                } rounded-lg border p-3.5 space-y-2`}
                style={{
                  backgroundColor: previewHexToRgba(tvDisplay.lessonColor, 0.13),
                  borderColor: previewHexToRgba(tvDisplay.lessonColor, 0.55),
                }}
              >
                <div className="flex items-center justify-between text-[11px] font-bold uppercase">
                  <span style={{ color: tvDisplay.lessonColor }}>TRWA LEKCJA</span>
                  {tvDisplay.showProgressBar && (
                    <span className="font-mono" style={{ color: tvDisplay.mutedTextColor }}>
                      Postęp: <strong style={{ color: tvDisplay.textColor }}>64%</strong>
                    </span>
                  )}
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums tracking-tight">
                  {tvDisplay.showClockSeconds ? '10:15:42' : '10:15'}
                </div>
                <div className="text-xs font-bold">Lekcja 3 (09:50–10:35)</div>
                {tvDisplay.showProgressBar && (
                  <div
                    className="w-full h-2 rounded-full overflow-hidden"
                    style={{ backgroundColor: previewHexToRgba(tvDisplay.backgroundColor, 0.7) }}
                  >
                    <div
                      className="h-full rounded-full w-2/3"
                      style={{ backgroundColor: tvDisplay.lessonColor }}
                    />
                  </div>
                )}
              </div>

              {(tvDisplay.showNextBellBlock || tvDisplay.showRadioBlock) && (
                <div className="md:col-span-5 flex flex-col gap-2.5">
                  {tvDisplay.showNextBellBlock && (
                    <div
                      className="rounded-lg border p-3 space-y-1 flex-1"
                      style={{
                        backgroundColor: tvDisplay.panelColor,
                        borderColor: previewHexToRgba(tvDisplay.textColor, 0.12),
                      }}
                    >
                      <div className="flex items-center justify-between text-[11px] font-bold uppercase">
                        <span>{tvDisplay.nextBellTitle || 'Następny Dzwonek'}</span>
                        <span className="font-mono" style={{ color: tvDisplay.accentColor }}>
                          10:35
                        </span>
                      </div>
                      <div className="text-xs font-semibold">Koniec Lekcji 3</div>
                      <div className="text-[11px] font-mono font-bold" style={{ color: tvDisplay.breakColor }}>
                        Odliczanie: 19:18
                      </div>
                    </div>
                  )}

                  {tvDisplay.showRadioBlock && (
                    <div
                      className="rounded-lg border p-3 space-y-1"
                      style={{
                        backgroundColor: previewHexToRgba(tvDisplay.breakColor, 0.14),
                        borderColor: previewHexToRgba(tvDisplay.breakColor, 0.55),
                      }}
                    >
                      <div className="flex items-center justify-between text-[11px] font-bold uppercase">
                        <span>{tvDisplay.radioBlockTitle || 'Radiowęzeł Szkolny'}</span>
                        <span style={{ color: tvDisplay.breakColor }}>Na antenie</span>
                      </div>
                      <div className="text-xs font-semibold">SomaFM Groove Salad</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {tvDisplay.showScheduleStrip && (
              <div
                className="pt-2.5 border-t space-y-2"
                style={{ borderColor: previewHexToRgba(tvDisplay.textColor, 0.12) }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="font-bold uppercase tracking-wider">
                    {tvDisplay.scheduleStripTitle || 'Dzisiejszy Rozkład Lekcji'}
                  </span>
                  {tvDisplay.footerModeText && (
                    <span className="font-mono" style={{ color: tvDisplay.mutedTextColor }}>
                      {tvDisplay.footerModeText}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {['Lekcja 1', 'Lekcja 2', 'Lekcja 3', 'Lekcja 4'].map((item, idx) => (
                    <div
                      key={item}
                      className="rounded border px-2 py-1.5 text-[10px]"
                      style={{
                        backgroundColor:
                          idx === 2 ? previewHexToRgba(tvDisplay.lessonColor, 0.16) : tvDisplay.panelColor,
                        borderColor:
                          idx === 2 ? tvDisplay.lessonColor : previewHexToRgba(tvDisplay.textColor, 0.12),
                        color: idx < 2 ? tvDisplay.mutedTextColor : tvDisplay.textColor,
                      }}
                    >
                      <div className="font-bold">{item}</div>
                      <div className="font-mono">0{8 + idx}:00</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Form Grid: Texts (Left) + Blocks & Colors (Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 text-xs">
          {/* Texts Editor */}
          <div className="lg:col-span-5 p-4 rounded-lg bg-slate-900/70 border border-slate-700/60 space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-700/60">
              <Type className="w-4 h-4 text-amber-400" />
              <h4 className="font-bold text-slate-200 uppercase tracking-wider text-[11px]">
                Teksty nagłówków i bloków
              </h4>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Tytuł główny w nagłówku (np. nazwa szkoły)
              </label>
              <input
                type="text"
                maxLength={120}
                value={tvDisplay.headerTitle}
                onChange={(e) => updateTvDisplay({ headerTitle: e.target.value })}
                placeholder="Zespół Szkół - Radiowęzeł Szkolny"
                className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-100 text-xs focus:outline-none focus:border-amber-400"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Prefiks podtytułu przed nazwą profilu
              </label>
              <input
                type="text"
                maxLength={120}
                value={tvDisplay.headerSubtitlePrefix}
                onChange={(e) => updateTvDisplay({ headerSubtitlePrefix: e.target.value })}
                placeholder="Harmonogram dnia:"
                className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-100 text-xs focus:outline-none focus:border-amber-400"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Nagłówek bloku dzwonka</label>
                <input
                  type="text"
                  maxLength={120}
                  value={tvDisplay.nextBellTitle}
                  onChange={(e) => updateTvDisplay({ nextBellTitle: e.target.value })}
                  placeholder="Następny Dzwonek"
                  className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-100 text-xs focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Nagłówek bloku radia</label>
                <input
                  type="text"
                  maxLength={120}
                  value={tvDisplay.radioBlockTitle}
                  onChange={(e) => updateTvDisplay({ radioBlockTitle: e.target.value })}
                  placeholder="Radiowęzeł Szkolny"
                  className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-100 text-xs focus:outline-none focus:border-amber-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Tytuł paska lekcji na dole</label>
                <input
                  type="text"
                  maxLength={120}
                  value={tvDisplay.scheduleStripTitle}
                  onChange={(e) => updateTvDisplay({ scheduleStripTitle: e.target.value })}
                  placeholder="Dzisiejszy Rozkład Lekcji"
                  className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-100 text-xs focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Tekst po prawej w stopce</label>
                <input
                  type="text"
                  maxLength={120}
                  value={tvDisplay.footerModeText}
                  onChange={(e) => updateTvDisplay({ footerModeText: e.target.value })}
                  placeholder="Tryb wyświetlania: Publiczny Ekran TV"
                  className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-100 text-xs focus:outline-none focus:border-amber-400"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Opcjonalny pasek ogłoszeń pod nagłówkiem
              </label>
              <input
                type="text"
                maxLength={200}
                value={tvDisplay.announcementText}
                onChange={(e) => updateTvDisplay({ announcementText: e.target.value })}
                placeholder="Zostaw puste, aby ukryć pasek ogłoszeń (np. Skrócone lekcje o 12:30)"
                className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-amber-200 text-xs focus:outline-none focus:border-amber-400 placeholder:text-slate-500"
              />
            </div>
          </div>

          {/* Blocks Visibility & Colors */}
          <div className="lg:col-span-7 space-y-4">
            {/* Blocks Toggles */}
            <div className="p-4 rounded-lg bg-slate-900/70 border border-slate-700/60 space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-700/60">
                <LayoutGrid className="w-4 h-4 text-amber-400" />
                <h4 className="font-bold text-slate-200 uppercase tracking-wider text-[11px]">
                  Widoczność bloków na ekranie TV
                </h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {TV_BLOCK_OPTIONS.map((opt) => (
                  <label
                    key={opt.key}
                    className="flex items-start gap-2.5 p-2 rounded-md bg-slate-950/60 border border-slate-800 hover:border-slate-700 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={tvDisplay[opt.key]}
                      onChange={(e) => updateTvDisplay({ [opt.key]: e.target.checked })}
                      className="mt-0.5 w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer shrink-0"
                    />
                    <span className="leading-tight">
                      <span className="block font-medium text-slate-200">{opt.label}</span>
                      <span className="block text-[10px] text-slate-400 mt-0.5">{opt.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Color Pickers */}
            <div className="p-4 rounded-lg bg-slate-900/70 border border-slate-700/60 space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-700/60">
                <Palette className="w-4 h-4 text-amber-400" />
                <h4 className="font-bold text-slate-200 uppercase tracking-wider text-[11px]">
                  Kolory elementów i bloków (HEX)
                </h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {TV_COLOR_FIELDS.map((field) => {
                  const pickerValue = /^#[0-9a-fA-F]{6}$/.test(tvDisplay[field.key])
                    ? tvDisplay[field.key]
                    : DEFAULT_TV_DISPLAY_CONFIG[field.key];
                  return (
                    <div
                      key={field.key}
                      className="p-2.5 rounded-md bg-slate-950/60 border border-slate-800 space-y-1.5"
                    >
                      <div className="text-[11px] font-semibold text-slate-200">{field.label}</div>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          aria-label={field.label}
                          value={pickerValue}
                          onChange={(e) => updateTvDisplay({ [field.key]: e.target.value })}
                          className="w-8 h-7 p-0.5 rounded bg-slate-900 border border-slate-700 cursor-pointer shrink-0"
                        />
                        <input
                          type="text"
                          maxLength={7}
                          value={tvDisplay[field.key]}
                          onChange={(e) => updateTvDisplay({ [field.key]: e.target.value })}
                          className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-slate-200 focus:outline-none focus:border-amber-400"
                        />
                      </div>
                      <div className="text-[10px] text-slate-400">{field.hint}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
