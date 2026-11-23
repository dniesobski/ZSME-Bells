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
  Megaphone,
} from 'lucide-react';
import { AppConfig, SystemStatus, TvDisplayConfig, TvPublicData } from '../types/bell';
import { DEFAULT_TV_DISPLAY_CONFIG } from '../data/defaultConfig';

interface TvDisplayViewProps {
  status: SystemStatus | null;
  config: AppConfig;
  tvData?: TvPublicData | null;
  onExitTvMode: () => void;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.slice(1) : '0f172a';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

  const tvCfg: TvDisplayConfig = {
    ...DEFAULT_TV_DISPLAY_CONFIG,
    ...(config.tvDisplay || {}),
    ...(tvData?.tvDisplay || {}),
  };

  const activeProfile =
    tvData?.activeProfile ||
    config.schedules.find((s) => s.id === (status?.activeProfileId || config.activeProfileId)) ||
    config.schedules[0];

  const schoolTitle =
    tvCfg.headerTitle.trim() ||
    tvData?.schoolSubtitle ||
    tvData?.schoolName ||
    config.schoolSubtitle ||
    config.schoolName;

  const radioEnabled = tvData ? tvData.radioEnabled : config.radioEnabled;
  const radioStations = tvData?.radioStations || config.radioStations || [];
  const defaultRadioStationId = tvData?.defaultRadioStationId || config.defaultRadioStationId;

  const rawTime = status?.currentTimeStr || fallbackTime;
  const displayTime = tvCfg.showClockSeconds ? rawTime : rawTime.slice(0, 5);
  const periodType = status?.currentPeriod.type || 'before_school';
  const nowHHMM = rawTime.slice(0, 5);

  const todayFormatted = new Date().toLocaleDateString('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // Determine hero visual state with custom theme colors
  const getStatePresentation = () => {
    if (status?.isMuted) {
      const color = '#f43f5e';
      return {
        badge: 'TRYB CICHY AKTYWNY',
        headline: 'Dzwonki zostały tymczasowo wyciszone',
        subline: status.currentPeriod.timeRange,
        icon: VolumeX,
        accent: color,
        cardBg: hexToRgba(color, 0.12),
        cardBorder: hexToRgba(color, 0.55),
      };
    }
    if (status?.isHoliday) {
      return {
        badge: 'DZIEŃ WOLNY OD ZAJĘĆ',
        headline: status.holidayName || 'Święto / Dzień wolny',
        subline: 'Harmonogram dzwonków wstrzymany',
        icon: Moon,
        accent: tvCfg.accentColor,
        cardBg: hexToRgba(tvCfg.accentColor, 0.1),
        cardBorder: hexToRgba(tvCfg.accentColor, 0.45),
      };
    }
    if (status?.isWeekend) {
      return {
        badge: 'DZIEŃ BEZ ZAJĘĆ',
        headline: 'Brak zajęć szkolnych',
        subline: 'Harmonogram dzwonków jest dziś wyłączony',
        icon: Moon,
        accent: tvCfg.mutedTextColor,
        cardBg: hexToRgba(tvCfg.panelColor, 0.85),
        cardBorder: hexToRgba(tvCfg.textColor, 0.14),
      };
    }
    if (periodType === 'break') {
      return {
        badge: 'TRWA PRZERWA',
        headline: status?.currentPeriod.label || 'Przerwa',
        subline: status?.currentPeriod.timeRange || '',
        icon: Coffee,
        accent: tvCfg.breakColor,
        cardBg: hexToRgba(tvCfg.breakColor, 0.14),
        cardBorder: hexToRgba(tvCfg.breakColor, 0.6),
      };
    }
    if (periodType === 'lesson') {
      return {
        badge: 'TRWA LEKCJA',
        headline: status?.currentPeriod.label || 'Lekcja',
        subline: status?.currentPeriod.timeRange || '',
        icon: BookOpen,
        accent: tvCfg.lessonColor,
        cardBg: hexToRgba(tvCfg.lessonColor, 0.13),
        cardBorder: hexToRgba(tvCfg.lessonColor, 0.6),
      };
    }
    if (periodType === 'before_school') {
      return {
        badge: 'PRZED ZAJĘCIAMI',
        headline: 'Oczekiwanie na pierwszą lekcję',
        subline: status?.currentPeriod.timeRange || '',
        icon: Clock,
        accent: tvCfg.accentColor,
        cardBg: hexToRgba(tvCfg.accentColor, 0.1),
        cardBorder: hexToRgba(tvCfg.accentColor, 0.45),
      };
    }
    return {
      badge: 'PO ZAJĘCIACH',
      headline: 'Zajęcia na dziś zostały zakończone',
      subline: status?.currentPeriod.timeRange || '',
      icon: Moon,
      accent: tvCfg.mutedTextColor,
      cardBg: hexToRgba(tvCfg.panelColor, 0.85),
      cardBorder: hexToRgba(tvCfg.textColor, 0.14),
    };
  };

  const stateInfo = getStatePresentation();
  const StateIcon = stateInfo.icon;
  const hasRightColumn = tvCfg.showNextBellBlock || tvCfg.showRadioBlock;
  const subtleBorder = hexToRgba(tvCfg.textColor, 0.12);

  return (
    <div
      className="min-h-screen flex flex-col justify-between p-5 sm:p-8 lg:p-10 select-none relative overflow-hidden transition-colors duration-300"
      style={{
        backgroundColor: tvCfg.backgroundColor,
        color: tvCfg.textColor,
      }}
    >
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
      {tvCfg.showHeader && (
        <header
          className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b"
          style={{ borderColor: subtleBorder }}
        >
          <div className="flex items-center gap-4">
            <div
              className="w-11 h-11 rounded-xl border flex items-center justify-center shrink-0"
              style={{
                backgroundColor: hexToRgba(tvCfg.accentColor, 0.14),
                borderColor: hexToRgba(tvCfg.accentColor, 0.35),
                color: tvCfg.accentColor,
              }}
            >
              <Radio className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: tvCfg.textColor }}>
                {schoolTitle}
              </h1>
              <div className="text-xs sm:text-sm flex items-center gap-2" style={{ color: tvCfg.mutedTextColor }}>
                {tvCfg.headerSubtitlePrefix && <span>{tvCfg.headerSubtitlePrefix}</span>}
                <span className="font-semibold" style={{ color: tvCfg.accentColor }}>
                  {activeProfile.name}
                </span>
              </div>
            </div>
          </div>

          {tvCfg.showDate && (
            <div className="flex items-center gap-3 text-right">
              <div>
                <div
                  className="text-base sm:text-xl font-semibold capitalize flex items-center gap-2 justify-end"
                  style={{ color: tvCfg.textColor }}
                >
                  <Calendar className="w-5 h-5 hidden sm:inline" style={{ color: tvCfg.accentColor }} />
                  <span>{todayFormatted}</span>
                </div>
                <div className="text-xs sm:text-sm font-mono" style={{ color: tvCfg.mutedTextColor }}>
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
          )}
        </header>
      )}

      {/* Optional Announcement Banner */}
      {tvCfg.announcementText && (
        <div
          className="mt-4 rounded-xl border px-5 py-3 flex items-center gap-3"
          style={{
            backgroundColor: hexToRgba(tvCfg.accentColor, 0.12),
            borderColor: hexToRgba(tvCfg.accentColor, 0.45),
          }}
        >
          <Megaphone className="w-5 h-5 shrink-0" style={{ color: tvCfg.accentColor }} />
          <span className="text-sm sm:text-lg font-semibold tracking-tight" style={{ color: tvCfg.textColor }}>
            {tvCfg.announcementText}
          </span>
        </div>
      )}

      {/* 2. Center Main Grid: Massive Clock + State + Next Bell + Radio */}
      <main className="my-auto py-6 grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {/* Left Focal Card: Digital Clock & Current Lesson / Break State */}
        <section
          className={`${
            hasRightColumn ? 'xl:col-span-7' : 'xl:col-span-12'
          } rounded-2xl border p-6 sm:p-8 lg:p-10 flex flex-col justify-between gap-6`}
          style={{
            backgroundColor: stateInfo.cardBg,
            borderColor: stateInfo.cardBorder,
          }}
        >
          {/* Clock Row */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 text-sm sm:text-base font-bold tracking-wider uppercase">
              <StateIcon className="w-6 h-6" style={{ color: stateInfo.accent }} />
              <span style={{ color: stateInfo.accent }}>{stateInfo.badge}</span>
            </div>

            {tvCfg.showProgressBar &&
              status &&
              status.currentPeriod.totalSeconds > 0 &&
              !status.isHoliday &&
              !status.isWeekend && (
                <div className="text-sm sm:text-base font-mono tabular-nums" style={{ color: tvCfg.mutedTextColor }}>
                  Postęp:{' '}
                  <span className="font-bold" style={{ color: tvCfg.textColor }}>
                    {status.currentPeriod.progressPercent}%
                  </span>
                </div>
              )}
          </div>

          {/* Giant Clock */}
          <div>
            <div
              className="text-[4.25rem] sm:text-[6.25rem] lg:text-[7.5rem] leading-none font-extrabold font-mono tabular-nums tracking-tight"
              style={{ color: tvCfg.textColor }}
            >
              {displayTime}
            </div>
          </div>

          {/* Current Lesson / Break Headline + Progress Bar */}
          <div className="space-y-4 pt-4 border-t" style={{ borderColor: subtleBorder }}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <div className="text-2xl sm:text-4xl font-bold tracking-tight" style={{ color: tvCfg.textColor }}>
                  {stateInfo.headline}
                </div>
                {stateInfo.subline && (
                  <div
                    className="text-base sm:text-xl font-mono tabular-nums mt-1"
                    style={{ color: tvCfg.mutedTextColor }}
                  >
                    Godziny: {stateInfo.subline}
                  </div>
                )}
              </div>

              {tvCfg.showProgressBar &&
                status &&
                status.currentPeriod.remainingSeconds > 0 &&
                !status.isHoliday &&
                !status.isWeekend && (
                  <div className="text-right">
                    <span className="text-xs uppercase tracking-wider block" style={{ color: tvCfg.mutedTextColor }}>
                      Do końca pozostało
                    </span>
                    <span
                      className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums"
                      style={{ color: tvCfg.textColor }}
                    >
                      {formatCountdown(status.currentPeriod.remainingSeconds)}
                    </span>
                  </div>
                )}
            </div>

            {tvCfg.showProgressBar &&
              status &&
              status.currentPeriod.totalSeconds > 0 &&
              !status.isHoliday &&
              !status.isWeekend && (
                <div
                  className="w-full h-4 rounded-full overflow-hidden border"
                  style={{
                    backgroundColor: hexToRgba(tvCfg.backgroundColor, 0.75),
                    borderColor: subtleBorder,
                  }}
                >
                  <div
                    className="h-full transition-all duration-1000 ease-linear rounded-full"
                    style={{
                      width: `${Math.min(100, Math.max(0, status.currentPeriod.progressPercent))}%`,
                      backgroundColor: stateInfo.accent,
                    }}
                  />
                </div>
              )}
          </div>
        </section>

        {/* Right Info Stack: Next Bell + Radio Status (5 cols) */}
        {hasRightColumn && (
          <section className="xl:col-span-5 flex flex-col gap-6 justify-between">
            {/* Next Bell Panel */}
            {tvCfg.showNextBellBlock && (
              <div
                className="flex-1 rounded-2xl border p-6 sm:p-8 flex flex-col justify-between"
                style={{
                  backgroundColor: tvCfg.panelColor,
                  borderColor: subtleBorder,
                }}
              >
                <div
                  className="flex items-center justify-between pb-3 border-b"
                  style={{ borderColor: subtleBorder }}
                >
                  <div
                    className="flex items-center gap-2.5 text-sm font-bold uppercase tracking-wider"
                    style={{ color: tvCfg.textColor }}
                  >
                    <Bell className="w-5 h-5" style={{ color: tvCfg.accentColor }} />
                    <span>{tvCfg.nextBellTitle}</span>
                  </div>
                  {status?.nextBell && (
                    <span
                      className="text-xl sm:text-2xl font-extrabold font-mono tabular-nums"
                      style={{ color: tvCfg.accentColor }}
                    >
                      {status.nextBell.timeStr}
                    </span>
                  )}
                </div>

                {status?.nextBell && !status.isHoliday && !status.isWeekend ? (
                  <div className="py-4 space-y-4">
                    <div>
                      <div className="text-xl sm:text-2xl font-bold" style={{ color: tvCfg.textColor }}>
                        {status.nextBell.label}
                      </div>
                      <div className="text-sm sm:text-base mt-1" style={{ color: tvCfg.mutedTextColor }}>
                        Melodia:{' '}
                        <span className="font-medium" style={{ color: tvCfg.accentColor }}>
                          {status.nextBell.soundName}
                        </span>
                      </div>
                    </div>

                    <div
                      className="pt-4 border-t flex items-baseline justify-between"
                      style={{ borderColor: subtleBorder }}
                    >
                      <span
                        className="text-sm uppercase tracking-wider font-medium"
                        style={{ color: tvCfg.mutedTextColor }}
                      >
                        Odliczanie
                      </span>
                      <span
                        className="text-3xl sm:text-4xl font-extrabold font-mono tabular-nums"
                        style={{ color: tvCfg.breakColor }}
                      >
                        {formatCountdownCompact(status.nextBell.secondsRemaining)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="py-8 text-center text-base" style={{ color: tvCfg.mutedTextColor }}>
                    Brak zaplanowanych dzwonków na pozostałą część dnia.
                  </div>
                )}
              </div>
            )}

            {/* Radio On-Air Panel */}
            {tvCfg.showRadioBlock && (
              <div
                className="rounded-2xl border p-6 sm:p-7 flex flex-col justify-between"
                style={{
                  backgroundColor: status?.radioStatus?.isPlaying
                    ? hexToRgba(tvCfg.breakColor, 0.14)
                    : tvCfg.panelColor,
                  borderColor: status?.radioStatus?.isPlaying
                    ? hexToRgba(tvCfg.breakColor, 0.55)
                    : subtleBorder,
                }}
              >
                <div
                  className="flex items-center justify-between pb-3 border-b"
                  style={{ borderColor: subtleBorder }}
                >
                  <div
                    className="flex items-center gap-2.5 text-sm font-bold uppercase tracking-wider"
                    style={{ color: tvCfg.textColor }}
                  >
                    <Radio
                      className="w-5 h-5"
                      style={{
                        color: status?.radioStatus?.isPlaying ? tvCfg.breakColor : tvCfg.mutedTextColor,
                      }}
                    />
                    <span>{tvCfg.radioBlockTitle}</span>
                  </div>
                  <span
                    className="text-xs font-bold uppercase tracking-wider"
                    style={{
                      color: status?.radioStatus?.isPlaying ? tvCfg.breakColor : tvCfg.mutedTextColor,
                    }}
                  >
                    {status?.radioStatus?.isPlaying ? 'Na antenie' : 'Cisza'}
                  </span>
                </div>

                <div className="pt-4">
                  {status?.radioStatus?.isPlaying ? (
                    <div>
                      <div className="text-xl sm:text-2xl font-bold" style={{ color: tvCfg.textColor }}>
                        {status.radioStatus.stationName}
                      </div>
                      <div className="text-sm mt-1" style={{ color: tvCfg.breakColor }}>
                        {status.radioStatus.mode === 'auto_break'
                          ? 'Automatyczna muzyka podczas przerwy'
                          : 'Audycja uruchomiona ręcznie'}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm sm:text-base" style={{ color: tvCfg.mutedTextColor }}>
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
            )}
          </section>
        )}
      </main>

      {/* 3. Bottom Strip: Today's Lesson & Break Timeline */}
      {tvCfg.showScheduleStrip && (
        <footer className="pt-5 border-t space-y-3" style={{ borderColor: subtleBorder }}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
            <span className="font-semibold uppercase tracking-wider" style={{ color: tvCfg.textColor }}>
              {tvCfg.scheduleStripTitle} ({activeProfile.items.length} lekcji)
            </span>
            {tvCfg.footerModeText && (
              <span className="font-mono" style={{ color: tvCfg.mutedTextColor }}>
                {tvCfg.footerModeText}
              </span>
            )}
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
                    className="rounded-xl border p-3 transition-colors"
                    style={{
                      backgroundColor: isCurrentLesson
                        ? hexToRgba(tvCfg.lessonColor, 0.16)
                        : isPast
                        ? hexToRgba(tvCfg.panelColor, 0.45)
                        : tvCfg.panelColor,
                      borderColor: isCurrentLesson ? tvCfg.lessonColor : subtleBorder,
                      color: isPast ? tvCfg.mutedTextColor : tvCfg.textColor,
                      opacity: isPast ? 0.72 : 1,
                    }}
                  >
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span style={{ color: isCurrentLesson ? tvCfg.accentColor : undefined }}>
                        {item.name}
                      </span>
                      {isCurrentLesson && (
                        <span className="text-[10px] uppercase font-mono" style={{ color: tvCfg.accentColor }}>
                          Teraz
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-mono tabular-nums font-semibold mt-1">
                      {item.startTime}–{item.endTime}
                    </div>
                    {hasRadioBreak && (
                      <div
                        className="text-[11px] mt-1 flex items-center gap-1"
                        style={{ color: tvCfg.breakColor }}
                      >
                        <Radio className="w-3 h-3 shrink-0" />
                        <span className="truncate">Radio na przerwie</span>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </footer>
      )}
    </div>
  );
};

