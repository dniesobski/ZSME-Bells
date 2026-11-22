import React, { useEffect, useState } from 'react';
import {
  Bell,
  Clock,
  Coffee,
  Maximize2,
  Minimize2,
  ArrowLeft,
  Radio,
  BookOpen,
  Calendar,
  VolumeX,
  Moon,
} from 'lucide-react';
import { AppConfig, SystemStatus, TvPublicData } from '../types/bell';

interface TvDisplayViewProps {
  status: SystemStatus | null;
  config: AppConfig;
  tvData?: TvPublicData | null;
  onExitTvMode: () => void;
}

export const TvDisplayView: React.FC<TvDisplayViewProps> = ({
  status,
  config,
  tvData,
  onExitTvMode,
}) => {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(Boolean(document.fullscreenElement));
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const [fallbackTime, setFallbackTime] = useState<string>(() =>
    new Date().toLocaleTimeString('pl-PL', { hour12: false })
  );

  // Fallback clock tick if status is briefly unavailable
  useEffect(() => {
    const t = setInterval(() => {
      setFallbackTime(new Date().toLocaleTimeString('pl-PL', { hour12: false }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Track fullscreen changes
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Screen Wake Lock so public TV / kiosk screen stays awake
  useEffect(() => {
    let wakeLock: { release: () => Promise<void> } | null = null;
    const requestWakeLock = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
        };
        if (nav.wakeLock) {
          wakeLock = await nav.wakeLock.request('screen');
        }
      } catch {
        // Ignore if not supported or blocked
      }
    };
    requestWakeLock();
    return () => {
      wakeLock?.release().catch(() => {});
    };
  }, []);

  // Auto-hide corner controls after 3.5s of no mouse movement
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const resetTimer = () => {
      setControlsVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => setControlsVisible(false), 3500);
    };
    resetTimer();
    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('touchstart', resetTimer);
    window.addEventListener('keydown', resetTimer);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('touchstart', resetTimer);
      window.removeEventListener('keydown', resetTimer);
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore fullscreen denial in restricted iframes
    }
  };

  const handleExit = async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {}
    }
    onExitTvMode();
  };

  const formatCountdown = (sec: number) => {
    const total = Math.max(0, Math.floor(sec));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${h} godz. ${String(m).padStart(2, '0')} min ${String(s).padStart(2, '0')} s`;
    }
    return `${m} min ${String(s).padStart(2, '0')} s`;
  };

  const formatCountdownCompact = (sec: number) => {
    const total = Math.max(0, Math.floor(sec));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const activeProfile =
    tvData?.activeProfile ||
    config.schedules.find((s) => s.id === (status?.activeProfileId || config.activeProfileId)) ||
    config.schedules[0];

  const schoolTitle = tvData?.schoolSubtitle || tvData?.schoolName || config.schoolSubtitle || config.schoolName;
  const radioEnabled = tvData ? tvData.radioEnabled : config.radioEnabled;
  const radioStations = tvData?.radioStations || config.radioStations || [];
  const defaultRadioStationId = tvData?.defaultRadioStationId || config.defaultRadioStationId;

  const displayTime = status?.currentTimeStr || fallbackTime;
  const periodType = status?.currentPeriod.type || 'before_school';
  const nowHHMM = displayTime.slice(0, 5);

  const todayFormatted = new Date().toLocaleDateString('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // Determine hero visual state
  const getStatePresentation = () => {
    if (status?.isMuted) {
      return {
        badge: 'TRYB CICHY AKTYWNY',
        headline: 'Dzwonki zostały tymczasowo wyciszone',
        subline: status.currentPeriod.timeRange,
        icon: VolumeX,
        cardBorder: 'border-rose-700/70',
        cardBg: 'bg-rose-950/30',
        badgeText: 'text-rose-300',
        barColor: 'bg-rose-500',
      };
    }
    if (status?.isHoliday) {
      return {
        badge: 'DZIEŃ WOLNY OD ZAJĘĆ',
        headline: status.holidayName || 'Święto / Dzień wolny',
        subline: 'Harmonogram dzwonków wstrzymany',
        icon: Moon,
        cardBorder: 'border-amber-700/60',
        cardBg: 'bg-amber-950/20',
        badgeText: 'text-amber-300',
        barColor: 'bg-amber-400',
      };
    }
    if (status?.isWeekend) {
      return {
        badge: 'DZIEŃ BEZ ZAJĘĆ',
        headline: 'Brak zajęć szkolnych',
        subline: 'Harmonogram dzwonków jest dziś wyłączony',
        icon: Moon,
        cardBorder: 'border-slate-700',
        cardBg: 'bg-slate-900/60',
        badgeText: 'text-slate-300',
        barColor: 'bg-slate-500',
      };
    }
    if (periodType === 'break') {
      return {
        badge: 'TRWA PRZERWA',
        headline: status?.currentPeriod.label || 'Przerwa',
        subline: status?.currentPeriod.timeRange || '',
        icon: Coffee,
        cardBorder: 'border-emerald-600/70',
        cardBg: 'bg-emerald-950/30',
        badgeText: 'text-emerald-300',
        barColor: 'bg-emerald-400',
      };
    }
    if (periodType === 'lesson') {
      return {
        badge: 'TRWA LEKCJA',
        headline: status?.currentPeriod.label || 'Lekcja',
        subline: status?.currentPeriod.timeRange || '',
        icon: BookOpen,
        cardBorder: 'border-amber-500/70',
        cardBg: 'bg-amber-500/10',
        badgeText: 'text-amber-300',
        barColor: 'bg-amber-400',
      };
    }
    if (periodType === 'before_school') {
      return {
        badge: 'PRZED ZAJĘCIAMI',
        headline: 'Oczekiwanie na pierwszą lekcję',
        subline: status?.currentPeriod.timeRange || '',
        icon: Clock,
        cardBorder: 'border-sky-700/60',
        cardBg: 'bg-sky-950/20',
        badgeText: 'text-sky-300',
        barColor: 'bg-sky-400',
      };
    }
    return {
      badge: 'PO ZAJĘCIACH',
      headline: 'Zajęcia na dziś zostały zakończone',
      subline: status?.currentPeriod.timeRange || '',
      icon: Moon,
      cardBorder: 'border-slate-700',
      cardBg: 'bg-slate-900/60',
      badgeText: 'text-slate-300',
      barColor: 'bg-slate-500',
    };
  };

  const stateInfo = getStatePresentation();
  const StateIcon = stateInfo.icon;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-5 sm:p-8 lg:p-10 select-none relative overflow-hidden">
      {/* Subtle auto-hiding top-right kiosk controls */}
      <div
        className={`fixed top-4 right-4 z-50 flex items-center gap-2 transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <button
          type="button"
          onClick={toggleFullscreen}
          className="px-3 py-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1.5 shadow-lg cursor-pointer whitespace-nowrap"
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          <span>{isFullscreen ? 'Wyjdź z pełnego ekranu' : 'Pełny ekran'}</span>
        </button>

        <button
          type="button"
          onClick={handleExit}
          className="px-3 py-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-amber-300 flex items-center gap-1.5 shadow-lg cursor-pointer whitespace-nowrap"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Powrót do panelu</span>
        </button>
      </div>

      {/* 1. TV Header Bar */}
      <header className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-800/90">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <Radio className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              {schoolTitle}
            </h1>
            <div className="text-xs sm:text-sm text-slate-400 flex items-center gap-2">
              <span>Harmonogram dnia:</span>
              <span className="text-amber-300 font-semibold">{activeProfile.name}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-right">
          <div>
            <div className="text-base sm:text-xl font-semibold text-white capitalize flex items-center gap-2 justify-end">
              <Calendar className="w-5 h-5 text-amber-400 hidden sm:inline" />
              <span>{todayFormatted}</span>
            </div>
            <div className="text-xs sm:text-sm text-slate-400 font-mono">
              {status?.isHoliday
                ? `Dzień wolny: ${status.holidayName}`
                : status?.isWeekend
                ? 'Dzień bez zajęć'
                : status?.isMuted
                ? 'System wyciszony'
                : 'System dzwonków aktywny'}
            </div>
          </div>
        </div>
      </header>

      {/* 2. Center Main Grid: Massive Clock + State + Next Bell + Radio */}
      <main className="my-auto py-6 grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {/* Left Focal Card: Digital Clock & Current Lesson / Break State (7 cols) */}
        <section
          className={`xl:col-span-7 rounded-2xl border p-6 sm:p-8 lg:p-10 flex flex-col justify-between gap-6 ${stateInfo.cardBorder} ${stateInfo.cardBg}`}
        >
          {/* Clock Row */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 text-sm sm:text-base font-bold tracking-wider uppercase">
              <StateIcon className={`w-6 h-6 ${stateInfo.badgeText}`} />
              <span className={stateInfo.badgeText}>{stateInfo.badge}</span>
            </div>

            {status && status.currentPeriod.totalSeconds > 0 && !status.isHoliday && !status.isWeekend && (
              <div className="text-sm sm:text-base font-mono tabular-nums text-slate-300">
                Postęp: <span className="font-bold text-white">{status.currentPeriod.progressPercent}%</span>
              </div>
            )}
          </div>

          {/* Giant Clock */}
          <div>
            <div className="text-[4.25rem] sm:text-[6.25rem] lg:text-[7.5rem] leading-none font-extrabold font-mono tabular-nums tracking-tight text-white">
              {displayTime}
            </div>
          </div>

          {/* Current Lesson / Break Headline + Progress Bar */}
          <div className="space-y-4 pt-4 border-t border-slate-800/80">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <div className="text-2xl sm:text-4xl font-bold text-white tracking-tight">
                  {stateInfo.headline}
                </div>
                {stateInfo.subline && (
                  <div className="text-base sm:text-xl font-mono tabular-nums text-slate-300 mt-1">
                    Godziny: {stateInfo.subline}
                  </div>
                )}
              </div>

              {status && status.currentPeriod.remainingSeconds > 0 && !status.isHoliday && !status.isWeekend && (
                <div className="text-right">
                  <span className="text-xs uppercase tracking-wider text-slate-400 block">
                    Do końca pozostało
                  </span>
                  <span className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-white">
                    {formatCountdown(status.currentPeriod.remainingSeconds)}
                  </span>
                </div>
              )}
            </div>

            {status && status.currentPeriod.totalSeconds > 0 && !status.isHoliday && !status.isWeekend && (
              <div className="w-full h-4 bg-slate-900/90 rounded-full overflow-hidden border border-slate-800">
                <div
                  className={`h-full ${stateInfo.barColor} transition-all duration-1000 ease-linear rounded-full`}
                  style={{
                    width: `${Math.min(100, Math.max(0, status.currentPeriod.progressPercent))}%`,
                  }}
                />
              </div>
            )}
          </div>
        </section>

        {/* Right Info Stack: Next Bell + Radio Status (5 cols) */}
        <section className="xl:col-span-5 flex flex-col gap-6 justify-between">
          {/* Next Bell Panel */}
          <div className="flex-1 rounded-2xl bg-slate-900/90 border border-slate-800 p-6 sm:p-8 flex flex-col justify-between">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5 text-sm font-bold uppercase tracking-wider text-slate-300">
                <Bell className="w-5 h-5 text-amber-400" />
                <span>Następny Dzwonek</span>
              </div>
              {status?.nextBell && (
                <span className="text-xl sm:text-2xl font-extrabold font-mono tabular-nums text-amber-300">
                  {status.nextBell.timeStr}
                </span>
              )}
            </div>

            {status?.nextBell && !status.isHoliday && !status.isWeekend ? (
              <div className="py-4 space-y-4">
                <div>
                  <div className="text-xl sm:text-2xl font-bold text-white">
                    {status.nextBell.label}
                  </div>
                  <div className="text-sm sm:text-base text-slate-400 mt-1">
                    Melodia: <span className="text-amber-300 font-medium">{status.nextBell.soundName}</span>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-800/80 flex items-baseline justify-between">
                  <span className="text-sm text-slate-400 uppercase tracking-wider font-medium">
                    Odliczanie
                  </span>
                  <span className="text-3xl sm:text-4xl font-extrabold font-mono tabular-nums text-emerald-400">
                    {formatCountdownCompact(status.nextBell.secondsRemaining)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-base text-slate-400">
                Brak zaplanowanych dzwonków na pozostałą część dnia.
              </div>
            )}
          </div>

          {/* Radio On-Air Panel */}
          <div
            className={`rounded-2xl border p-6 sm:p-7 flex flex-col justify-between ${
              status?.radioStatus?.isPlaying
                ? 'bg-emerald-950/30 border-emerald-700/60'
                : 'bg-slate-900/90 border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
              <div className="flex items-center gap-2.5 text-sm font-bold uppercase tracking-wider text-slate-300">
                <Radio
                  className={`w-5 h-5 ${
                    status?.radioStatus?.isPlaying ? 'text-emerald-400' : 'text-slate-400'
                  }`}
                />
                <span>Radiowęzeł Szkolny</span>
              </div>
              <span
                className={`text-xs font-bold uppercase tracking-wider ${
                  status?.radioStatus?.isPlaying ? 'text-emerald-400' : 'text-slate-500'
                }`}
              >
                {status?.radioStatus?.isPlaying ? 'Na antenie' : 'Cisza'}
              </span>
            </div>

            <div className="pt-4">
              {status?.radioStatus?.isPlaying ? (
                <div>
                  <div className="text-xl sm:text-2xl font-bold text-white">
                    {status.radioStatus.stationName}
                  </div>
                  <div className="text-sm text-emerald-300 mt-1">
                    {status.radioStatus.mode === 'auto_break'
                      ? 'Automatyczna muzyka podczas przerwy'
                      : 'Audycja uruchomiona ręcznie'}
                  </div>
                </div>
              ) : (
                <div className="text-sm sm:text-base text-slate-400">
                  {radioEnabled
                    ? `Radio włączy się automatycznie na wybranych przerwach (${
                        radioStations.find((s) => s.id === defaultRadioStationId)?.name ||
                        'Stacja domyślna'
                      }).`
                    : 'Automatyczna emisja radia na przerwach jest obecnie wyłączona.'}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* 3. Bottom Strip: Today's Lesson & Break Timeline */}
      <footer className="pt-5 border-t border-slate-800/90 space-y-3">
        <div className="flex items-center justify-between text-xs sm:text-sm text-slate-400">
          <span className="font-semibold uppercase tracking-wider text-slate-300">
            Dzisiejszy Rozkład Lekcji ({activeProfile.items.length} lekcji)
          </span>
          <span className="font-mono text-slate-400">
            Tryb wyświetlania: Publiczny Ekran TV
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
          {activeProfile.items
            .filter((item) => item.enabled)
            .map((item, idx, arr) => {
              const isCurrentLesson =
                periodType === 'lesson' && status?.currentPeriod.label === item.name;
              const isPast = !isCurrentLesson && nowHHMM >= item.endTime;
              const hasRadioBreak =
                idx < arr.length - 1 && radioEnabled && item.playRadioOnBreak;

              return (
                <div
                  key={item.id}
                  className={`rounded-xl border p-3 transition-colors ${
                    isCurrentLesson
                      ? 'bg-amber-500/15 border-amber-400 text-white'
                      : isPast
                      ? 'bg-slate-900/40 border-slate-800/70 text-slate-500'
                      : 'bg-slate-900/80 border-slate-800 text-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className={isCurrentLesson ? 'text-amber-300' : ''}>
                      {item.name}
                    </span>
                    {isCurrentLesson && (
                      <span className="text-[10px] uppercase text-amber-300 font-mono">Teraz</span>
                    )}
                  </div>
                  <div className="text-sm font-mono tabular-nums font-semibold mt-1">
                    {item.startTime}–{item.endTime}
                  </div>
                  {hasRadioBreak && (
                    <div className="text-[11px] text-emerald-400/90 mt-1 flex items-center gap-1">
                      <Radio className="w-3 h-3 shrink-0" />
                      <span className="truncate">Radio na przerwie</span>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </footer>
    </div>
  );
};
