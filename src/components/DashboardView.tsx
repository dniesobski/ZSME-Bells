import React, { useEffect, useState } from 'react';
import {
  Clock,
  Bell,
  Play,
  Square,
  Volume2,
  Calendar,
  CheckCircle2,
  RefreshCw,
  Terminal,
  Radio,
  Tv,
  Activity,
  Cpu,
  MemoryStick,
  Thermometer,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AppConfig,
  BellHistoryEntry,
  SoundTrack,
  SystemMetricsPoint,
  SystemStatus,
} from '../types/bell';
import { bellPlayer } from '../utils/audioPlayer';
import { apiFetch } from '../utils/apiClient';

interface TelemetryTooltipProps {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    dataKey?: string;
    payload?: SystemMetricsPoint;
  }>;
  label?: string;
}

const formatRamAmount = (mb: number) => {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb} MB`;
};

const TelemetryTooltip: React.FC<TelemetryTooltipProps> = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="bg-slate-950/95 border border-slate-700 rounded-lg px-3 py-2 shadow-xl text-xs space-y-1.5">
      <div className="font-mono text-slate-300 font-semibold border-b border-slate-800 pb-1">
        Czas: {label || point.timeLabel}
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-amber-300">
          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
          Procesor (CPU):
        </span>
        <span className="font-mono font-bold tabular-nums text-white">
          {point.cpuPercent.toFixed(1)}%
        </span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-sky-300">
          <span className="w-2 h-2 rounded-full bg-sky-400 inline-block" />
          Pamięć RAM:
        </span>
        <span className="font-mono font-bold tabular-nums text-white">
          {point.ramPercent.toFixed(1)}% ({formatRamAmount(point.ramUsedMb)} / {formatRamAmount(point.ramTotalMb)})
        </span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-rose-300">
          <span className="w-2 h-2 rounded-full bg-rose-400 inline-block" />
          Temperatura CPU:
        </span>
        <span className="font-mono font-bold tabular-nums text-white">
          {typeof point.cpuTempC === 'number' ? `${point.cpuTempC.toFixed(1)}°C` : 'Brak czujnika'}
        </span>
      </div>
      <div className="text-[11px] text-slate-400 font-mono pt-0.5">
        Load avg (1m): {point.loadAvg1m.toFixed(2)} · Rdzenie: {point.cpuCores}
        {point.cpuTempSource ? ` · ${point.cpuTempSource}` : ''}
      </div>
    </div>
  );
};

interface DashboardViewProps {
  status: SystemStatus | null;
  config: AppConfig;
  sounds: SoundTrack[];
  history: BellHistoryEntry[];
  onOpenManualBell: () => void;
  onRefreshStatus: () => void;
  onTriggerBell: (soundId: string, type: string, title: string, volume: number) => Promise<void>;
  onTestSpeaker: () => Promise<void>;
  onQuickProfileChange: (profileId: string) => Promise<void>;
  onPlayRadioLinux: (stationId: string, volume?: number) => Promise<void>;
  onStopRadioLinux: () => Promise<void>;
  onOpenRadioTab: () => void;
  onOpenTvMode: () => void;
  canManualBell?: boolean;
  canChangeSchedule?: boolean;
  canControlRadio?: boolean;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  status,
  config,
  sounds,
  history,
  onOpenManualBell,
  onRefreshStatus,
  onTestSpeaker,
  onQuickProfileChange,
  onPlayRadioLinux,
  onStopRadioLinux,
  onOpenRadioTab,
  onOpenTvMode,
  canManualBell = true,
  canChangeSchedule = true,
  canControlRadio = true,
}) => {
  const [isTestingSpeaker, setIsTestingSpeaker] = useState(false);
  const [testingMsg, setTestingMsg] = useState<string | null>(null);
  const [metricsHistory, setMetricsHistory] = useState<SystemMetricsPoint[]>([]);

  useEffect(() => {
    let active = true;
    apiFetch('/api/system-metrics')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data || !Array.isArray(data.history)) return;
        setMetricsHistory(data.history.slice(-60));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const point = status?.telemetry;
    if (!point) return;
    setMetricsHistory((prev) => {
      if (prev.length > 0 && prev[prev.length - 1].timestamp === point.timestamp) {
        return prev;
      }
      const next = [...prev, point];
      return next.length > 60 ? next.slice(next.length - 60) : next;
    });
  }, [status?.telemetry]);

  const latestMetric = status?.telemetry || metricsHistory[metricsHistory.length - 1] || null;
  const hasTempData = metricsHistory.some(
    (m) => typeof m.cpuTempC === 'number' && Number.isFinite(m.cpuTempC)
  );
  const currentTempC =
    typeof latestMetric?.cpuTempC === 'number' && Number.isFinite(latestMetric.cpuTempC)
      ? latestMetric.cpuTempC
      : null;

  const activeProfile =
    config.schedules.find((s) => s.id === (status?.activeProfileId || config.activeProfileId)) ||
    config.schedules[0];

  const handleTestSpeakerClick = async () => {
    try {
      setIsTestingSpeaker(true);
      setTestingMsg('Wysyłanie sygnału testowego do wzmacniacza Linux...');
      await onTestSpeaker();
      setTestingMsg('Sygnał testowy odtworzony pomyślnie!');
      setTimeout(() => setTestingMsg(null), 3500);
    } catch {
      setTestingMsg('Błąd testu głośnika');
      setTimeout(() => setTestingMsg(null), 3500);
    } finally {
      setIsTestingSpeaker(false);
    }
  };

  // Format seconds to mm:ss or hh:mm:ss
  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const remM = m % 60;
      return `${h}h ${remM}m ${s}s`;
    }
    return `${m}m ${String(s).padStart(2, '0')}s`;
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Status Overview Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Main Clock & Current Period Card (7 cols) */}
        <div className="lg:col-span-7 bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-700/60">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <span className="font-semibold text-white tracking-wide uppercase">Radiowęzeł Szkolny</span>
              <span>·</span>
              <span className="text-amber-400 font-medium">{activeProfile.name}</span>
            </div>

            <div className="flex items-center gap-2">
              {status?.isMuted ? (
                <span className="text-xs text-rose-400 bg-rose-950/60 border border-rose-800 px-2.5 py-0.5 rounded-full font-medium">
                  Tryb cichy aktywny
                </span>
              ) : status?.isHoliday ? (
                <span className="text-xs text-amber-300 bg-amber-950/60 border border-amber-800 px-2.5 py-0.5 rounded-full font-medium">
                  Dzień wolny: {status.holidayName || 'Święto'}
                </span>
              ) : status?.isWeekend ? (
                <span className="text-xs text-slate-400 bg-slate-900 border border-slate-700 px-2.5 py-0.5 rounded-full">
                  Dzień bez zajęć
                </span>
              ) : (
                <span className="text-xs text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Harmonogram Aktywny
                </span>
              )}
              <button
                onClick={onRefreshStatus}
                title="Odśwież status serwera"
                className="p-1 text-slate-400 hover:text-white rounded-md hover:bg-slate-700 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Clock display */}
          <div className="py-5 flex flex-col md:flex-row md:items-baseline md:justify-between gap-4">
            <div>
              <div className="text-4xl sm:text-5xl md:text-6xl font-extrabold font-mono tabular-nums tracking-tight text-white drop-shadow-sm">
                {status?.currentTimeStr || '--:--:--'}
              </div>
              <div className="text-xs sm:text-sm text-slate-400 mt-1 flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <span>
                  {new Date().toLocaleDateString('pl-PL', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              </div>
            </div>

            {/* Current period indicator */}
            <div className="bg-slate-900/80 border border-slate-700/60 rounded-lg p-3 min-w-[220px]">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400 block mb-1">
                Aktualny stan zajęć
              </span>
              <div className="text-base font-bold text-amber-300">
                {status?.currentPeriod.label || 'Oczekiwanie'}
              </div>
              <div className="text-xs text-slate-300 font-mono mt-0.5">
                {status?.currentPeriod.timeRange}
              </div>
            </div>
          </div>

          {/* Progress Bar for Current Lesson / Break */}
          {status && status.currentPeriod.totalSeconds > 0 && (
            <div className="pt-2">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                <span>Postęp: {status.currentPeriod.progressPercent}%</span>
                <span className="font-mono tabular-nums text-slate-300">
                  Pozostało: {formatSeconds(status.currentPeriod.remainingSeconds)}
                </span>
              </div>
              <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all duration-1000 ease-linear rounded-full"
                  style={{ width: `${Math.min(100, Math.max(0, status.currentPeriod.progressPercent))}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Next Bell & Quick Actions Card (5 cols) */}
        <div className="lg:col-span-5 bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-slate-700/60">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Bell className="w-3.5 h-3.5 text-amber-400" />
                Następny Dzwonek
              </h3>
              <span className="font-mono text-xs text-amber-300 font-bold">
                {status?.nextBell ? status.nextBell.timeStr : 'Brak dziś'}
              </span>
            </div>

            {status?.nextBell ? (
              <div className="mt-3 p-3.5 rounded-lg bg-slate-900/90 border border-slate-700/70">
                <div className="text-sm font-bold text-white">{status.nextBell.label}</div>
                <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                  <span>Melodia:</span>
                  <span className="text-amber-300 font-medium">{status.nextBell.soundName}</span>
                </div>
                {status.dailyRandomBell?.enabled && status.dailyRandomBell.soundName && (
                  <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/70 text-[11px] text-emerald-300">
                    <span>Losowanie dnia:</span>
                    <strong className="font-semibold">{status.dailyRandomBell.soundName}</strong>
                  </div>
                )}
                <div className="mt-2.5 flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
                  <span className="text-slate-400">Czas do dzwonka:</span>
                  <span className="text-base font-extrabold font-mono tabular-nums text-emerald-400">
                    {formatSeconds(status.nextBell.secondsRemaining)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-3 p-4 rounded-lg bg-slate-900/50 border border-slate-800 text-xs text-slate-400 text-center">
                Wszystkie dzwonki zaplanowane na dzisiaj zostały zakończone lub dzień jest wolny od zajęć.
              </div>
            )}
          </div>

          {/* Quick Actions Panel */}
          <div className="pt-2 border-t border-slate-700/60 space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
              Szybkie Akcje
            </span>
            <div className="grid grid-cols-3 gap-2">
              {canManualBell && (
                <>
                  <button
                    type="button"
                    onClick={onOpenManualBell}
                    className="p-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 active:bg-amber-500 text-slate-950 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                  >
                    <Bell className="w-3.5 h-3.5 fill-current" />
                    <span>Zadzwoń</span>
                  </button>

                  <button
                    type="button"
                    disabled={isTestingSpeaker}
                    onClick={handleTestSpeakerClick}
                    className="p-2.5 rounded-lg bg-slate-700/80 hover:bg-slate-700 border border-slate-600/70 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Volume2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>{isTestingSpeaker ? 'Test...' : 'Test Audio'}</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={onOpenTvMode}
                className={`p-2.5 rounded-lg bg-slate-900 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  !canManualBell ? 'col-span-3' : ''
                }`}
                title="Otwórz pełnoekranowy widok dla telewizora na korytarzu (/tv)"
              >
                <Tv className="w-3.5 h-3.5 text-amber-400" />
                <span>Ekran TV</span>
              </button>
            </div>

            {testingMsg && (
              <div className="text-xs p-2 rounded bg-slate-900 border border-slate-700 text-amber-300 text-center animate-fade-in font-mono">
                {testingMsg}
              </div>
            )}

            {/* Quick Profile Switching */}
            {canChangeSchedule && (
              <div className="flex items-center gap-1 pt-1">
                <span className="text-[11px] text-slate-400 mr-1">Profil:</span>
                {config.schedules.map((sch) => {
                  const isActive = sch.id === (status?.activeProfileId || config.activeProfileId);
                  return (
                    <button
                      key={sch.id}
                      onClick={() => onQuickProfileChange(sch.id)}
                      className={`px-2 py-1 text-[11px] rounded transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/40'
                          : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                      }`}
                    >
                      {sch.lessonDurationMinutes}m
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Linux Engine Hardware Status Strip + Live Radio Control */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 bg-slate-800/50 border border-slate-700/60 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
              <Terminal className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="font-medium text-slate-200">
                Host: <span className="font-mono text-amber-300">Debian 13 (Linux)</span>
                <span className="text-slate-500 mx-2">·</span>
                Silnik Audio: <span className="font-mono text-emerald-400 font-semibold">{status?.detectedAudioTool}</span>
                <span className="text-slate-500 mx-2">·</span>
                Wyjście: <span className="font-mono text-slate-300">{config.audioDevice || 'default'}</span>
              </div>
              <div className="text-[11px] text-slate-400">
                Głośność dzwonków: <span className="font-mono text-slate-200">{config.masterVolume}%</span>
                <span className="mx-2">·</span>
                Przywoławczy: <span className={config.warningBellEnabled ? 'text-emerald-400' : 'text-slate-500'}>
                  {config.warningBellEnabled ? `${config.defaultWarningMinutes} min` : 'Wyłączony'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Live Break Radio Widget */}
        <div className="lg:col-span-5 bg-slate-800/50 border border-slate-700/60 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-7 h-7 rounded-md border flex items-center justify-center shrink-0 ${
              status?.radioStatus?.isPlaying
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                : 'bg-slate-900 border-slate-700 text-slate-400'
            }`}>
              <Radio className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <div className="font-medium text-slate-200 truncate">
                {status?.radioStatus?.isPlaying ? (
                  <>
                    <span className="text-emerald-400 font-semibold">Gra radio: </span>
                    <span className="text-white">{status.radioStatus.stationName}</span>
                  </>
                ) : (
                  <span>
                    Radio na przerwach:{' '}
                    <span className={config.radioEnabled ? 'text-amber-300 font-medium' : 'text-slate-500'}>
                      {config.radioEnabled ? 'Gotowe (auto)' : 'Wyłączone'}
                    </span>
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {status?.radioStatus?.isPlaying
                  ? status.radioStatus.mode === 'auto_break'
                    ? 'Emisja automatyczna w czasie przerwy'
                    : 'Emisja ręczna'
                  : `Domyślna: ${
                      config.radioStations?.find((s) => s.id === config.defaultRadioStationId)?.name || 'Brak'
                    }`}
              </div>
            </div>
          </div>

          {canControlRadio && (
            <div className="flex items-center gap-1.5 shrink-0">
              {status?.radioStatus?.isPlaying ? (
                <button
                  type="button"
                  onClick={onStopRadioLinux}
                  className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!config.defaultRadioStationId}
                  onClick={() => onPlayRadioLinux(config.defaultRadioStationId, config.radioVolume)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-amber-300 font-medium flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-40"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Włącz</span>
                </button>
              )}
              <button
                type="button"
                onClick={onOpenRadioTab}
                className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-700 border border-slate-700 text-slate-300 cursor-pointer whitespace-nowrap"
              >
                Stacje
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Real-time Debian CPU, Temperature & RAM Performance Chart (Recharts) */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Wydajność Serwera Debian w Czasie Rzeczywistym (CPU, RAM i Temperatura)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Bieżące obciążenie procesora, temperatura CPU (sensors) oraz zajętość pamięci z ostatnich 60 sekund
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-slate-900/80 border border-slate-700/70 flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-slate-400">CPU:</span>
              <span className="font-mono font-bold tabular-nums text-amber-300">
                {latestMetric ? `${latestMetric.cpuPercent.toFixed(1)}%` : '—'}
              </span>
              {latestMetric && (
                <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">
                  ({latestMetric.cpuCores} rdzeni · load {latestMetric.loadAvg1m.toFixed(2)})
                </span>
              )}
            </div>

            <div
              className="px-3 py-1.5 rounded-lg bg-slate-900/80 border border-slate-700/70 flex items-center gap-2"
              title={latestMetric?.cpuTempSource || 'Czujnik temperatury lm-sensors / sysfs'}
            >
              <Thermometer
                className={`w-3.5 h-3.5 ${
                  currentTempC === null
                    ? 'text-slate-500'
                    : currentTempC >= 80
                    ? 'text-rose-400'
                    : currentTempC >= 65
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }`}
              />
              <span className="text-slate-400">Temp. CPU:</span>
              <span
                className={`font-mono font-bold tabular-nums ${
                  currentTempC === null
                    ? 'text-slate-400'
                    : currentTempC >= 80
                    ? 'text-rose-400'
                    : currentTempC >= 65
                    ? 'text-amber-300'
                    : 'text-emerald-300'
                }`}
              >
                {currentTempC !== null ? `${currentTempC.toFixed(1)}°C` : 'Brak czujnika'}
              </span>
              {latestMetric?.cpuTempSource && (
                <span className="text-[11px] text-slate-500 font-mono hidden xl:inline">
                  ({latestMetric.cpuTempSource})
                </span>
              )}
            </div>

            <div className="px-3 py-1.5 rounded-lg bg-slate-900/80 border border-slate-700/70 flex items-center gap-2">
              <MemoryStick className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-slate-400">RAM:</span>
              <span className="font-mono font-bold tabular-nums text-sky-300">
                {latestMetric ? `${latestMetric.ramPercent.toFixed(1)}%` : '—'}
              </span>
              {latestMetric && (
                <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">
                  ({formatRamAmount(latestMetric.ramUsedMb)} / {formatRamAmount(latestMetric.ramTotalMb)})
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="w-full h-[230px]">
          {metricsHistory.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart
                data={metricsHistory}
                margin={{ top: 8, right: hasTempData ? 4 : 12, left: -16, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#fbbf24" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="ramGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="tempGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#fb7185" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#fb7185" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis
                  dataKey="timeLabel"
                  stroke="#94a3b8"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                  minTickGap={28}
                />
                <YAxis
                  yAxisId="percent"
                  domain={[0, 100]}
                  stroke="#94a3b8"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v}%`}
                />
                <YAxis
                  yAxisId="temp"
                  orientation="right"
                  hide={!hasTempData}
                  domain={[0, (dataMax: number) => Math.max(100, Math.ceil((dataMax || 0) / 10) * 10)]}
                  stroke="#94a3b8"
                  tick={{ fill: '#fda4af', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v}°C`}
                />
                <Tooltip content={<TelemetryTooltip />} />
                <Area
                  yAxisId="percent"
                  type="monotone"
                  dataKey="cpuPercent"
                  name="CPU (%)"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#cpuGradient)"
                  isAnimationActive={false}
                />
                <Area
                  yAxisId="percent"
                  type="monotone"
                  dataKey="ramPercent"
                  name="RAM (%)"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#ramGradient)"
                  isAnimationActive={false}
                />
                <Area
                  yAxisId="temp"
                  type="monotone"
                  dataKey="cpuTempC"
                  name="Temperatura CPU (°C)"
                  stroke="#fb7185"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#tempGradient)"
                  connectNulls
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-slate-400 font-mono">
              Zbieranie pierwszych próbek wydajności z serwera Debian...
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 pt-1">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" />
              Obciążenie procesora (CPU %)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-sky-400 inline-block" />
              Wykorzystanie pamięci RAM (%)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-rose-400 inline-block" />
              Temperatura CPU (°C){!hasTempData && ' · brak czujnika sensors/sysfs'}
            </span>
          </div>
          <span className="font-mono text-slate-500 tabular-nums">
            Próbkowanie: 1 s · Okno: {metricsHistory.length}/60 s
          </span>
        </div>
      </div>

      {/* Today's Schedule Timeline & Table */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-700/60">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              Rozkład Dnia Szkolnego: {activeProfile.name}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">{activeProfile.description}</p>
          </div>

          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span>{activeProfile.items.length} lekcji</span>
            <span>·</span>
            <span>Lekcja: {activeProfile.lessonDurationMinutes} min</span>
          </div>
        </div>

        {/* Timeline Rows */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 uppercase tracking-wider text-[11px]">
                <th className="py-2.5 px-3">Nr</th>
                <th className="py-2.5 px-3">Nazwa</th>
                <th className="py-2.5 px-3">Godziny Lekcji</th>
                <th className="py-2.5 px-3">Czas</th>
                <th className="py-2.5 px-3">Dzwonek na Lekcję</th>
                <th className="py-2.5 px-3">Dzwonek na Przerwę</th>
                <th className="py-2.5 px-3">Radio na Przerwie</th>
                <th className="py-2.5 px-3">Dzwonek 1 min Przed</th>
                <th className="py-2.5 px-3 text-right">Odsłuch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {activeProfile.items.map((item, index) => {
                const startSound = sounds.find((s) => s.id === item.startSoundId) || sounds[0];
                const endSound = sounds.find((s) => s.id === item.endSoundId) || sounds[1];
                const breakRadioStation = item.playRadioOnBreak
                  ? config.radioStations?.find(
                      (st) => st.id === (item.radioStationId || config.defaultRadioStationId)
                    )
                  : null;

                const isCurrent = status?.currentPeriod.label === item.name;

                return (
                  <tr
                    key={item.id}
                    className={`transition-colors ${
                      isCurrent
                        ? 'bg-amber-500/10 text-white font-medium border-l-2 border-l-amber-400'
                        : 'hover:bg-slate-700/30 text-slate-300'
                    }`}
                  >
                    <td className="py-3 px-3 font-mono font-bold text-amber-400">{item.lessonNumber}</td>
                    <td className="py-3 px-3 font-medium text-white">{item.name}</td>
                    <td className="py-3 px-3 font-mono tabular-nums text-slate-200">
                      {item.startTime} - {item.endTime}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-400">{activeProfile.lessonDurationMinutes} min</td>
                    <td className="py-3 px-3">
                      <span className="text-slate-200">{startSound.name}</span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-slate-200">{endSound.name}</span>
                    </td>
                    <td className="py-3 px-3">
                      {index < activeProfile.items.length - 1 && item.playRadioOnBreak && config.radioEnabled ? (
                        <span className="text-emerald-400 font-medium text-[11px]">
                          {breakRadioStation ? breakRadioStation.name : 'Radio aktywne'}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      {item.warningMinutesBefore > 0 ? (
                        <span className="text-amber-300/90 font-mono text-[11px]">
                          {item.warningMinutesBefore} min przed
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={() =>
                          bellPlayer.playSound(item.startSoundId, {
                            volume: 0.7,
                            fileUrl: startSound.fileUrl,
                          })
                        }
                        title={`Odsłuchaj: ${startSound.name}`}
                        className="p-1.5 rounded bg-slate-700/60 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                      >
                        <Play className="w-3 h-3 fill-current" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Activity Mini-Feed */}
      {history.length > 0 && (
        <div className="bg-slate-800/60 border border-slate-700/70 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between pb-2 border-b border-slate-700/60 text-xs">
            <span className="font-semibold text-slate-300">Ostatnie Dzwonki (Dziennik Operacyjny)</span>
            <span className="text-slate-400 font-mono">{history.length} wpisów</span>
          </div>
          <div className="mt-2 divide-y divide-slate-700/40">
            {history.slice(0, 4).map((entry) => (
              <div key={entry.id} className="py-2 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono tabular-nums text-amber-300 font-semibold">{entry.timeStr}</span>
                  <span className="text-slate-300">{entry.title}</span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-400 text-[11px]">{entry.soundName}</span>
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  {entry.status === 'played_linux' ? (
                    <span className="text-emerald-400">Linux PA/ALSA OK</span>
                  ) : entry.status === 'simulated' ? (
                    <span className="text-sky-400">Serwer Web OK</span>
                  ) : (
                    <span className="text-rose-400">Błąd</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
