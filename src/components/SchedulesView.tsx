import React, { useState } from 'react';
import {
  Clock,
  Plus,
  Trash2,
  Copy,
  Save,
  Wand2,
  Play,
  Check,
  ChevronDown,
  Layers,
  ArrowUp,
  ArrowDown,
  Power,
  RotateCcw,
} from 'lucide-react';
import {
  AmplifierRule,
  AppConfig,
  BellItem,
  ScheduleProfile,
  SoundTrack,
  SystemStatus,
} from '../types/bell';
import { bellPlayer } from '../utils/audioPlayer';

interface SchedulesViewProps {
  config: AppConfig;
  sounds: SoundTrack[];
  status?: SystemStatus | null;
  onSaveConfig: (updatedConfig: AppConfig) => Promise<void>;
  onControlAmplifier?: (action: 'on' | 'off' | 'auto') => Promise<void>;
}

export const SchedulesView: React.FC<SchedulesViewProps> = ({
  config,
  sounds,
  status,
  onSaveConfig,
  onControlAmplifier,
}) => {
  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    config.activeProfileId || config.schedules[0]?.id || ''
  );
  const [localProfiles, setLocalProfiles] = useState<ScheduleProfile[]>(config.schedules);
  const [localWeekMapping, setLocalWeekMapping] = useState(config.weekMapping);
  const [amplifierControlEnabled, setAmplifierControlEnabled] = useState<boolean>(
    Boolean(config.amplifierControlEnabled)
  );
  const [amplifierRespectHolidays, setAmplifierRespectHolidays] = useState<boolean>(
    config.amplifierRespectHolidays !== false
  );
  const [localAmplifierSchedule, setLocalAmplifierSchedule] = useState<AmplifierRule[]>(
    config.amplifierSchedule && config.amplifierSchedule.length > 0
      ? config.amplifierSchedule
      : [
          {
            id: 'amp_rule_main',
            name: 'Praca wzmacniacza w trakcie lekcji',
            enabled: true,
            daysOfWeek: [1, 2, 3, 4, 5, 6],
            powerOnTime: '07:45',
            powerOffTime: '15:30',
          },
        ]
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);

  const weekDays = [
    { key: 1, name: 'Poniedziałek', short: 'Pn' },
    { key: 2, name: 'Wtorek', short: 'Wt' },
    { key: 3, name: 'Środa', short: 'Śr' },
    { key: 4, name: 'Czwartek', short: 'Cz' },
    { key: 5, name: 'Piątek', short: 'Pt' },
    { key: 6, name: 'Sobota', short: 'Sb' },
    { key: 0, name: 'Niedziela', short: 'Nd' },
  ];

  // Generator wizard parameters
  const [genStartHour, setGenStartHour] = useState('08:00');
  const [genCount, setGenCount] = useState(8);
  const [genLessonDuration, setGenLessonDuration] = useState(45);
  const [genStandardBreak, setGenStandardBreak] = useState(5);
  const [genLongBreaks, setGenLongBreaks] = useState<{ afterLesson: number; durationMinutes: number }[]>([
    { afterLesson: 4, durationMinutes: 15 },
  ]);

  const currentProfile =
    localProfiles.find((p) => p.id === selectedProfileId) || localProfiles[0];

  // Helper to add minutes to HH:MM string
  const addMinutesToTime = (timeStr: string, minutesToAdd: number): string => {
    const [h, m] = timeStr.split(':').map(Number);
    const totalMin = h * 60 + m + minutesToAdd;
    const finalH = Math.floor(totalMin / 60) % 24;
    const finalM = totalMin % 60;
    return `${String(finalH).padStart(2, '0')}:${String(finalM).padStart(2, '0')}`;
  };

  const handleUpdateItem = (itemId: string, updates: Partial<BellItem>) => {
    setLocalProfiles((prev) =>
      prev.map((profile) => {
        if (profile.id !== selectedProfileId) return profile;
        return {
          ...profile,
          items: profile.items.map((item) => (item.id === itemId ? { ...item, ...updates } : item)),
        };
      })
    );
  };

  const handleAddItem = () => {
    const items = currentProfile.items;
    const lastItem = items[items.length - 1];
    const nextNum = items.length + 1;

    let nextStart = '08:00';
    if (lastItem) {
      nextStart = addMinutesToTime(lastItem.endTime, 10);
    }
    const nextEnd = addMinutesToTime(nextStart, currentProfile.lessonDurationMinutes || 45);

    const newItem: BellItem = {
      id: `lesson_${Date.now()}`,
      lessonNumber: nextNum,
      name: `Lekcja ${nextNum}`,
      startTime: nextStart,
      endTime: nextEnd,
      warningMinutesBefore: config.defaultWarningMinutes || 1,
      startSoundId: config.defaultStartSoundId,
      endSoundId: config.defaultEndSoundId,
      warningSoundId: config.defaultWarningSoundId,
      enabled: true,
    };

    setLocalProfiles((prev) =>
      prev.map((p) => (p.id === selectedProfileId ? { ...p, items: [...p.items, newItem] } : p))
    );
  };

  const handleDeleteItem = (itemId: string) => {
    setLocalProfiles((prev) =>
      prev.map((profile) => {
        if (profile.id !== selectedProfileId) return profile;
        const filtered = profile.items.filter((item) => item.id !== itemId);
        // re-number lessons
        const renumbered = filtered.map((item, idx) => ({
          ...item,
          lessonNumber: idx + 1,
        }));
        return { ...profile, items: renumbered };
      })
    );
  };

  const handleMoveItem = (index: number, direction: 'up' | 'down') => {
    const items = [...currentProfile.items];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= items.length) return;

    const temp = items[index];
    items[index] = items[targetIdx];
    items[targetIdx] = temp;

    // re-number
    const renumbered = items.map((item, idx) => ({ ...item, lessonNumber: idx + 1 }));

    setLocalProfiles((prev) =>
      prev.map((p) => (p.id === selectedProfileId ? { ...p, items: renumbered } : p))
    );
  };

  const handleCreateProfile = () => {
    const newId = `profile_${Date.now()}`;
    const newProfile: ScheduleProfile = {
      id: newId,
      name: 'Nowy harmonogram',
      description: 'Niestandardowy plan dzwonków szkolnych',
      lessonDurationMinutes: 45,
      items: [
        {
          id: `lesson_${Date.now()}_1`,
          lessonNumber: 1,
          name: 'Lekcja 1',
          startTime: '08:00',
          endTime: '08:45',
          warningMinutesBefore: 1,
          startSoundId: config.defaultStartSoundId,
          endSoundId: config.defaultEndSoundId,
          warningSoundId: config.defaultWarningSoundId,
          enabled: true,
        },
      ],
    };

    setLocalProfiles([...localProfiles, newProfile]);
    setSelectedProfileId(newId);
  };

  const handleDuplicateProfile = () => {
    const copyId = `profile_copy_${Date.now()}`;
    const copyProfile: ScheduleProfile = {
      ...currentProfile,
      id: copyId,
      name: `${currentProfile.name} (Kopia)`,
      items: currentProfile.items.map((i) => ({ ...i, id: `item_${Date.now()}_${Math.random()}` })),
    };
    setLocalProfiles([...localProfiles, copyProfile]);
    setSelectedProfileId(copyId);
  };

  const handleDeleteProfile = () => {
    if (localProfiles.length <= 1) {
      alert('Nie można usunąć jedynego profilu harmonogramu.');
      return;
    }
    const remaining = localProfiles.filter((p) => p.id !== selectedProfileId);
    setLocalProfiles(remaining);
    setSelectedProfileId(remaining[0].id);
  };

  const maxPossibleLongBreaks = Math.max(0, genCount - 1);

  const handleGenCountChange = (nextCountRaw: number) => {
    const nextCount = Math.max(1, Math.min(20, Number.isFinite(nextCountRaw) ? Math.floor(nextCountRaw) : 1));
    setGenCount(nextCount);
    const maxBreaks = Math.max(0, nextCount - 1);
    setGenLongBreaks((prev) => {
      const valid = prev
        .filter((lb) => lb.afterLesson >= 1 && lb.afterLesson <= maxBreaks)
        .slice(0, maxBreaks);
      return valid;
    });
  };

  const handleLongBreakCountChange = (targetCountRaw: number) => {
    const targetCount = Math.max(0, Math.min(maxPossibleLongBreaks, targetCountRaw));
    setGenLongBreaks((prev) => {
      if (targetCount <= prev.length) {
        return prev.slice(0, targetCount);
      }
      const next = [...prev];
      const usedLessons = new Set(next.map((b) => b.afterLesson));
      const preferredOrder = [4, 5, 3, 6, 2, 7, 1, 8, 9, 10, 11, 12];
      while (next.length < targetCount) {
        let candidate = preferredOrder.find((n) => n <= maxPossibleLongBreaks && !usedLessons.has(n));
        if (candidate === undefined) {
          for (let n = 1; n <= maxPossibleLongBreaks; n++) {
            if (!usedLessons.has(n)) {
              candidate = n;
              break;
            }
          }
        }
        if (candidate === undefined) break;
        usedLessons.add(candidate);
        next.push({ afterLesson: candidate, durationMinutes: 15 });
      }
      return next;
    });
  };

  const handleUpdateLongBreak = (
    idx: number,
    updates: Partial<{ afterLesson: number; durationMinutes: number }>
  ) => {
    setGenLongBreaks((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, ...updates } : item))
    );
  };

  const handleRemoveLongBreak = (idx: number) => {
    setGenLongBreaks((prev) => prev.filter((_, i) => i !== idx));
  };

  // Run Generator Wizard
  const handleRunGenerator = () => {
    const safeCount = Math.max(1, Math.min(20, genCount || 1));
    const safeLessonDur = Math.max(1, genLessonDuration || 45);
    const safeStdBreak = Math.max(0, Number.isFinite(genStandardBreak) ? genStandardBreak : 5);
    const longBreakMap = new Map<number, number>();
    for (const lb of genLongBreaks) {
      if (lb.afterLesson >= 1 && lb.afterLesson < safeCount) {
        longBreakMap.set(lb.afterLesson, Math.max(1, lb.durationMinutes || 15));
      }
    }

    const newItems: BellItem[] = [];
    let currentTime = genStartHour || '08:00';

    for (let i = 1; i <= safeCount; i++) {
      const lessonStart = currentTime;
      const lessonEnd = addMinutesToTime(lessonStart, safeLessonDur);

      newItems.push({
        id: `gen_lesson_${i}_${Date.now()}`,
        lessonNumber: i,
        name: `Lekcja ${i}`,
        startTime: lessonStart,
        endTime: lessonEnd,
        warningMinutesBefore: 1,
        startSoundId: config.defaultStartSoundId,
        endSoundId: config.defaultEndSoundId,
        warningSoundId: config.defaultWarningSoundId,
        enabled: true,
      });

      // Break duration after this lesson
      if (i < safeCount) {
        const breakMins = longBreakMap.get(i) ?? safeStdBreak;
        currentTime = addMinutesToTime(lessonEnd, breakMins);
      }
    }

    setLocalProfiles((prev) =>
      prev.map((p) =>
        p.id === selectedProfileId
          ? {
              ...p,
              lessonDurationMinutes: safeLessonDur,
              items: newItems,
            }
          : p
      )
    );
    setShowGenerator(false);
  };

  const handleAddAmplifierRule = () => {
    const newRule: AmplifierRule = {
      id: `amp_${Date.now()}`,
      name: 'Okno pracy wzmacniacza',
      enabled: true,
      daysOfWeek: [1, 2, 3, 4, 5],
      powerOnTime: '07:45',
      powerOffTime: '15:30',
    };
    setLocalAmplifierSchedule((prev) => [...prev, newRule]);
  };

  const handleUpdateAmplifierRule = (id: string, updates: Partial<AmplifierRule>) => {
    setLocalAmplifierSchedule((prev) =>
      prev.map((rule) => (rule.id === id ? { ...rule, ...updates } : rule))
    );
  };

  const handleToggleAmplifierDay = (ruleId: string, dayKey: number) => {
    setLocalAmplifierSchedule((prev) =>
      prev.map((rule) => {
        if (rule.id !== ruleId) return rule;
        const exists = rule.daysOfWeek.includes(dayKey);
        return {
          ...rule,
          daysOfWeek: exists
            ? rule.daysOfWeek.filter((d) => d !== dayKey)
            : [...rule.daysOfWeek, dayKey],
        };
      })
    );
  };

  const handleDeleteAmplifierRule = (id: string) => {
    setLocalAmplifierSchedule((prev) => prev.filter((rule) => rule.id !== id));
  };

  const handleSaveAll = async () => {
    try {
      setIsSaving(true);
      const updatedConfig: AppConfig = {
        ...config,
        schedules: localProfiles,
        activeProfileId: selectedProfileId,
        weekMapping: localWeekMapping,
        weekMappingVersion: 2,
        amplifierControlEnabled,
        amplifierRespectHolidays,
        amplifierSchedule: localAmplifierSchedule,
      };
      await onSaveConfig(updatedConfig);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Controls: Profile Selection & Management */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-700/60">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-amber-400" />
              Zarządzanie Harmonogramami Lekcji
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Definiuj godziny lekcji, przerw oraz melodie dzwonków dla różnych typów dni szkolnych
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowGenerator(!showGenerator)}
              className="px-3 py-1.5 text-xs font-medium text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>Kreator Rozkładu</span>
            </button>

            <button
              onClick={handleDuplicateProfile}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-700/80 hover:bg-slate-700 border border-slate-600/70 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Duplikuj Profil</span>
            </button>

            <button
              onClick={handleCreateProfile}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-700/80 hover:bg-slate-700 border border-slate-600/70 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nowy Profil</span>
            </button>

            <button
              onClick={handleSaveAll}
              disabled={isSaving}
              className="px-4 py-1.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 active:bg-amber-500 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
            >
              {saveSuccess ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              <span>{isSaving ? 'Zapisywanie...' : saveSuccess ? 'Zapisano!' : 'Zapisz Plan'}</span>
            </button>
          </div>
        </div>

        {/* Profile Tabs & Details */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          <div className="md:col-span-4 flex flex-wrap gap-2">
            {localProfiles.map((p) => {
              const isSelected = p.id === selectedProfileId;
              const isActiveInSystem = p.id === config.activeProfileId;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedProfileId(p.id)}
                  className={`px-3 py-2 text-xs rounded-lg border text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-amber-500/15 border-amber-500/60 text-white font-semibold shadow-sm'
                      : 'bg-slate-900/60 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{p.name}</span>
                    {isActiveInSystem && (
                      <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 rounded">
                        Aktywny
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                    {p.items.length} lekcji · {p.lessonDurationMinutes}m
                  </div>
                </button>
              );
            })}
          </div>

          <div className="md:col-span-8 bg-slate-900/70 border border-slate-800 rounded-lg p-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Nazwa profilu</label>
              <input
                type="text"
                value={currentProfile.name}
                onChange={(e) => {
                  const val = e.target.value;
                  setLocalProfiles((prev) =>
                    prev.map((p) => (p.id === selectedProfileId ? { ...p, name: val } : p))
                  );
                }}
                className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-amber-400"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Opis profilu</label>
              <input
                type="text"
                value={currentProfile.description}
                onChange={(e) => {
                  const val = e.target.value;
                  setLocalProfiles((prev) =>
                    prev.map((p) => (p.id === selectedProfileId ? { ...p, description: val } : p))
                  );
                }}
                className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-amber-400"
              />
            </div>

            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={handleDeleteProfile}
                disabled={localProfiles.length <= 1}
                className="w-full py-1.5 px-3 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 rounded text-xs transition-colors cursor-pointer disabled:opacity-40"
              >
                Usuń ten profil
              </button>
            </div>
          </div>
        </div>

        {/* Generator Wizard Drawer (Expandable) */}
        {showGenerator && (
          <div className="p-4 bg-slate-900 border border-amber-500/30 rounded-xl space-y-4 animate-fade-in">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-amber-400" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Kreator Automatycznego Rozkładu Dnia
                </h4>
              </div>
              <span className="text-[11px] text-slate-400">
                Automatycznie przeliczy kolejne godziny lekcji, zwykłych przerw (domyślnie 5 min) i długich przerw
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-xs">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Godzina 1. lekcji</label>
                <input
                  type="time"
                  value={genStartHour}
                  onChange={(e) => setGenStartHour(e.target.value)}
                  className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Liczba lekcji</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={genCount}
                  onChange={(e) => handleGenCountChange(Number(e.target.value))}
                  className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Długość lekcji (min)</label>
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={genLessonDuration}
                  onChange={(e) => setGenLessonDuration(Math.max(1, Number(e.target.value)))}
                  className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Zwykła przerwa (min)</label>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={genStandardBreak}
                  onChange={(e) => setGenStandardBreak(Math.max(0, Number(e.target.value)))}
                  className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Ilość długich przerw</label>
                <select
                  value={genLongBreaks.length}
                  disabled={maxPossibleLongBreaks === 0}
                  onChange={(e) => handleLongBreakCountChange(Number(e.target.value))}
                  className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-amber-300 font-mono disabled:opacity-50"
                >
                  {Array.from({ length: maxPossibleLongBreaks + 1 }, (_, i) => i).map((cnt) => (
                    <option key={cnt} value={cnt}>
                      {cnt === 0 ? '0 (brak)' : cnt}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Individual Long Breaks List */}
            {genLongBreaks.length > 0 && (
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-amber-300 uppercase tracking-wider">
                    Konfiguracja długich przerw ({genLongBreaks.length})
                  </span>
                  <span className="text-slate-400">
                    Wybierz po której lekcji ma nastąpić dana długa przerwa oraz jej czas w minutach
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
                  {genLongBreaks.map((lb, idx) => {
                    const takenByOthers = new Set(
                      genLongBreaks.filter((_, i) => i !== idx).map((other) => other.afterLesson)
                    );
                    return (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg bg-slate-900 border border-slate-700/80 flex items-end gap-2"
                      >
                        <div className="flex-1 min-w-0">
                          <label className="block text-[10px] text-slate-400 mb-1">
                            Długa przerwa #{idx + 1} — po lekcji
                          </label>
                          <select
                            value={lb.afterLesson}
                            onChange={(e) =>
                              handleUpdateLongBreak(idx, { afterLesson: Number(e.target.value) })
                            }
                            className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-200 text-xs"
                          >
                            {Array.from({ length: maxPossibleLongBreaks }, (_, i) => i + 1).map((n) => (
                              <option key={n} value={n} disabled={takenByOthers.has(n)}>
                                Po {n}. lekcji{takenByOthers.has(n) ? ' (zajęta)' : ''}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="w-24 shrink-0">
                          <label className="block text-[10px] text-slate-400 mb-1">Czas (min)</label>
                          <input
                            type="number"
                            min={1}
                            max={120}
                            value={lb.durationMinutes}
                            onChange={(e) =>
                              handleUpdateLongBreak(idx, {
                                durationMinutes: Math.max(1, Number(e.target.value)),
                              })
                            }
                            className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-amber-300 font-mono text-xs"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveLongBreak(idx)}
                          title="Usuń tę długą przerwę"
                          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Quick Live Preview of Generated Hours */}
            <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80 text-[11px] space-y-1.5">
              <div className="text-slate-400 font-medium">Podgląd wyliczonych godzin:</div>
              <div className="flex flex-wrap gap-1.5">
                {(() => {
                  const previewItems: React.ReactNode[] = [];
                  const longBreakMap = new Map<number, number>();
                  for (const lb of genLongBreaks) {
                    if (lb.afterLesson >= 1 && lb.afterLesson < genCount) {
                      longBreakMap.set(lb.afterLesson, Math.max(1, lb.durationMinutes || 15));
                    }
                  }
                  let t = genStartHour || '08:00';
                  const safeDur = Math.max(1, genLessonDuration || 45);
                  const safeStd = Math.max(0, Number.isFinite(genStandardBreak) ? genStandardBreak : 5);
                  for (let i = 1; i <= genCount; i++) {
                    const start = t;
                    const end = addMinutesToTime(start, safeDur);
                    const breakDur = i < genCount ? (longBreakMap.get(i) ?? safeStd) : null;
                    const isLong = i < genCount && longBreakMap.has(i);
                    previewItems.push(
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-700/80 font-mono text-slate-200"
                      >
                        <span className="text-amber-300 font-bold">{i}.</span>
                        <span>
                          {start}–{end}
                        </span>
                        {breakDur !== null && (
                          <span
                            className={`text-[10px] px-1 rounded ${
                              isLong
                                ? 'bg-amber-500/20 text-amber-300 font-semibold'
                                : 'text-slate-400'
                            }`}
                          >
                            +{breakDur}m
                          </span>
                        )}
                      </span>
                    );
                    if (breakDur !== null) {
                      t = addMinutesToTime(end, breakDur);
                    }
                  }
                  return previewItems;
                })()}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowGenerator(false)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Anuluj
              </button>
              <button
                type="button"
                onClick={handleRunGenerator}
                className="px-4 py-1.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg shadow-sm cursor-pointer"
              >
                Zastosuj i Wypełnij Harmonogram
              </button>
            </div>
          </div>
        )}

        {/* Quick Weekday Assignment Strip (Mon–Sun including Saturday) */}
        <div className="pt-4 border-t border-slate-700/60 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
              Przypisanie profili do dni tygodnia (Poniedziałek – Sobota / Niedziela)
            </span>
            <span className="text-[11px] text-slate-400">
              Możesz ustawić osobny plan lekcji np. dla soboty lub wyłączyć dzwonki w wybrane dni
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2 text-xs">
            {weekDays.map((d) => {
              const currentVal =
                localWeekMapping[d.key] || (d.key === 0 ? '__silent__' : selectedProfileId);
              const isSilent = currentVal === '__silent__';
              return (
                <div
                  key={d.key}
                  className={`p-2 rounded-lg border space-y-1 ${
                    isSilent
                      ? 'bg-slate-900/40 border-slate-800'
                      : 'bg-slate-900/80 border-slate-700/70'
                  }`}
                >
                  <span className="block font-medium text-[11px] text-slate-300">{d.name}</span>
                  <select
                    aria-label={`Profil dla dnia ${d.name}`}
                    value={currentVal}
                    onChange={(e) =>
                      setLocalWeekMapping({
                        ...localWeekMapping,
                        [d.key]: e.target.value,
                      })
                    }
                    className={`w-full px-1.5 py-1 bg-slate-800 border border-slate-700 rounded text-[11px] focus:outline-none focus:border-amber-400 ${
                      isSilent ? 'text-slate-400' : 'text-amber-300'
                    }`}
                  >
                    <option value="__silent__">Brak zajęć (Wolne)</option>
                    {localProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bells Table Editor */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Godziny Lekcji i Przypisane Melodie
            </h3>
          </div>

          <button
            onClick={handleAddItem}
            className="px-3 py-1.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Dodaj kolejną lekcję</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 uppercase tracking-wider text-[11px]">
                <th className="py-2.5 px-2 w-10">Lp</th>
                <th className="py-2.5 px-2 min-w-[120px]">Nazwa</th>
                <th className="py-2.5 px-2 w-24">Początek</th>
                <th className="py-2.5 px-2 w-24">Koniec</th>
                <th className="py-2.5 px-2 min-w-[160px]">Dźwięk na Lekcję</th>
                <th className="py-2.5 px-2 min-w-[160px]">Dźwięk na Przerwę</th>
                <th className="py-2.5 px-2 w-28">Dzwonek 1 min</th>
                <th className="py-2.5 px-2 min-w-[165px]">Radio na Przerwie</th>
                <th className="py-2.5 px-2 w-16 text-center">Stan</th>
                <th className="py-2.5 px-2 w-20 text-right">Akcje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {currentProfile.items.map((item, index) => {
                return (
                  <tr key={item.id} className="hover:bg-slate-750 transition-colors">
                    {/* Index & Reorder */}
                    <td className="py-2.5 px-2 font-mono font-bold text-amber-400">
                      <div className="flex items-center gap-1">
                        <span>{item.lessonNumber}</span>
                        <div className="flex flex-col">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => handleMoveItem(index, 'up')}
                            className="p-0.5 text-slate-500 hover:text-white disabled:opacity-20 cursor-pointer"
                          >
                            <ArrowUp className="w-2.5 h-2.5" />
                          </button>
                          <button
                            type="button"
                            disabled={index === currentProfile.items.length - 1}
                            onClick={() => handleMoveItem(index, 'down')}
                            className="p-0.5 text-slate-500 hover:text-white disabled:opacity-20 cursor-pointer"
                          >
                            <ArrowDown className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* Lesson name */}
                    <td className="py-2.5 px-2">
                      <input
                        type="text"
                        value={item.name}
                        onChange={(e) => handleUpdateItem(item.id, { name: e.target.value })}
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs focus:outline-none focus:border-amber-400"
                      />
                    </td>

                    {/* Start Time */}
                    <td className="py-2.5 px-2">
                      <input
                        type="time"
                        value={item.startTime}
                        onChange={(e) => handleUpdateItem(item.id, { startTime: e.target.value })}
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200 font-mono text-xs focus:outline-none focus:border-amber-400"
                      />
                    </td>

                    {/* End Time */}
                    <td className="py-2.5 px-2">
                      <input
                        type="time"
                        value={item.endTime}
                        onChange={(e) => handleUpdateItem(item.id, { endTime: e.target.value })}
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200 font-mono text-xs focus:outline-none focus:border-amber-400"
                      />
                    </td>

                    {/* Start Sound Selector */}
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-1.5">
                        <select
                          value={item.startSoundId}
                          onChange={(e) => handleUpdateItem(item.id, { startSoundId: e.target.value })}
                          className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs focus:outline-none focus:border-amber-400"
                        >
                          {sounds.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => bellPlayer.playSound(item.startSoundId, { volume: 0.6 })}
                          className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
                          title="Podgląd"
                        >
                          <Play className="w-3 h-3 fill-current" />
                        </button>
                      </div>
                    </td>

                    {/* End Sound Selector */}
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-1.5">
                        <select
                          value={item.endSoundId}
                          onChange={(e) => handleUpdateItem(item.id, { endSoundId: e.target.value })}
                          className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs focus:outline-none focus:border-amber-400"
                        >
                          {sounds.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => bellPlayer.playSound(item.endSoundId, { volume: 0.6 })}
                          className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
                          title="Podgląd"
                        >
                          <Play className="w-3 h-3 fill-current" />
                        </button>
                      </div>
                    </td>

                    {/* Warning Bell Option */}
                    <td className="py-2.5 px-2">
                      <select
                        value={item.warningMinutesBefore}
                        onChange={(e) =>
                          handleUpdateItem(item.id, { warningMinutesBefore: Number(e.target.value) })
                        }
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs focus:outline-none focus:border-amber-400"
                      >
                        <option value={0}>Brak (Wyłączony)</option>
                        <option value={1}>1 min przed</option>
                        <option value={2}>2 min przed</option>
                        <option value={3}>3 min przed</option>
                      </select>
                    </td>

                    {/* Radio on break after this lesson */}
                    <td className="py-2.5 px-2">
                      {index < currentProfile.items.length - 1 ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={Boolean(item.playRadioOnBreak)}
                            onChange={(e) =>
                              handleUpdateItem(item.id, { playRadioOnBreak: e.target.checked })
                            }
                            title="Włącz radio internetowe na przerwie po tej lekcji"
                            className="rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer shrink-0"
                          />
                          <select
                            disabled={!item.playRadioOnBreak}
                            value={item.radioStationId || ''}
                            onChange={(e) =>
                              handleUpdateItem(item.id, {
                                radioStationId: e.target.value === '' ? undefined : e.target.value,
                              })
                            }
                            className="w-full px-1.5 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs disabled:opacity-40 focus:outline-none focus:border-amber-400"
                          >
                            <option value="">Domyślna stacja</option>
                            {(config.radioStations || []).map((st) => (
                              <option key={st.id} value={st.id}>
                                {st.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500">Koniec zajęć</span>
                      )}
                    </td>

                    {/* Enabled checkbox */}
                    <td className="py-2.5 px-2 text-center">
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        onChange={(e) => handleUpdateItem(item.id, { enabled: e.target.checked })}
                        className="rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
                      />
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleDeleteItem(item.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors cursor-pointer"
                        title="Usuń lekcję"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Bottom Save Bar */}
        <div className="pt-3 border-t border-slate-700 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            Pamiętaj o kliknięciu <strong>Zapisz Plan</strong>, aby zaktualizować harmonogram w systemie Linux.
          </span>
          <button
            onClick={handleSaveAll}
            disabled={isSaving}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
          >
            {saveSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            <span>{isSaving ? 'Zapisywanie...' : saveSuccess ? 'Plan Zapisany!' : 'Zapisz Plan'}</span>
          </button>
        </div>
      </div>

      {/* Amplifier Work Schedule */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Power className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Harmonogram Pracy Wzmacniacza (Sterowanie 1 / 0)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Automatyczne włączanie (<code className="font-mono text-emerald-300">1</code>) i wyłączanie (
                <code className="font-mono text-rose-300">0</code>) sterownika pod ścieżką:{' '}
                <code className="font-mono text-amber-300">{config.amplifierDevicePath || '/dev/tty1'}</code>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
                  ? 'WŁĄCZONY (1)'
                  : status.amplifierStatus.powerState === 'off'
                  ? 'WYŁĄCZONY (0)'
                  : 'Stan nieznany'}
              </span>
            )}

            {onControlAmplifier && (
              <>
                <button
                  type="button"
                  onClick={() => onControlAmplifier('on')}
                  className="px-2.5 py-1.5 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors cursor-pointer"
                >
                  Włącz (1)
                </button>
                <button
                  type="button"
                  onClick={() => onControlAmplifier('off')}
                  className="px-2.5 py-1.5 text-xs font-semibold text-rose-100 bg-rose-700 hover:bg-rose-600 rounded-lg transition-colors cursor-pointer"
                >
                  Wyłącz (0)
                </button>
                {status?.amplifierStatus?.mode === 'manual' && (
                  <button
                    type="button"
                    onClick={() => onControlAmplifier('auto')}
                    title="Przywróć automatyczne sterowanie z harmonogramu"
                    className="px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Auto</span>
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              onClick={handleAddAmplifierRule}
              className="px-3 py-1.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Dodaj okno pracy</span>
            </button>
          </div>
        </div>

        {/* Enable & Holiday toggles */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-3 rounded-lg bg-slate-900/60 border border-slate-700/60 text-xs">
          <div className="flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={amplifierControlEnabled}
                onChange={(e) => setAmplifierControlEnabled(e.target.checked)}
                className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
              />
              <span className="font-semibold text-slate-200">
                Włącz automatyczny harmonogram pracy wzmacniacza
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={amplifierRespectHolidays}
                onChange={(e) => setAmplifierRespectHolidays(e.target.checked)}
                className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
              />
              <span className="text-slate-300">
                Wyłącz wzmacniacz w święta i dni wolne z kalendarza
              </span>
            </label>
          </div>

          {!amplifierControlEnabled && (
            <span className="text-[11px] text-amber-300/90">
              Harmonogram jest zapisany, ale sterowanie automatyczne jest obecnie wyłączone.
            </span>
          )}
        </div>

        {/* Amplifier Time Windows List */}
        {localAmplifierSchedule.length === 0 ? (
          <div className="p-6 text-center rounded-lg bg-slate-900/40 border border-slate-800 text-xs text-slate-400">
            Brak zdefiniowanych przedziałów pracy wzmacniacza. Kliknij „Dodaj okno pracy”, aby ustawić godziny włączania i wyłączania.
          </div>
        ) : (
          <div className="space-y-3">
            {localAmplifierSchedule.map((rule) => (
              <div
                key={rule.id}
                className="p-3.5 rounded-lg bg-slate-900/70 border border-slate-700/60 grid grid-cols-1 lg:grid-cols-12 gap-3 items-center text-xs"
              >
                <div className="lg:col-span-3">
                  <label className="block text-[10px] text-slate-400 mb-1">Nazwa harmonogramu</label>
                  <input
                    type="text"
                    value={rule.name}
                    onChange={(e) => handleUpdateAmplifierRule(rule.id, { name: e.target.value })}
                    className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 text-xs focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div className="lg:col-span-3 grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-emerald-400 mb-1">
                      Włącz (sygnał 1)
                    </label>
                    <input
                      type="time"
                      value={rule.powerOnTime}
                      onChange={(e) =>
                        handleUpdateAmplifierRule(rule.id, { powerOnTime: e.target.value })
                      }
                      className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 font-mono text-xs focus:outline-none focus:border-emerald-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-rose-400 mb-1">
                      Wyłącz (sygnał 0)
                    </label>
                    <input
                      type="time"
                      value={rule.powerOffTime}
                      onChange={(e) =>
                        handleUpdateAmplifierRule(rule.id, { powerOffTime: e.target.value })
                      }
                      className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 font-mono text-xs focus:outline-none focus:border-rose-400"
                    />
                  </div>
                </div>

                <div className="lg:col-span-4">
                  <label className="block text-[10px] text-slate-400 mb-1">Dni aktywności</label>
                  <div className="flex flex-wrap gap-1">
                    {weekDays.map((d) => {
                      const active = rule.daysOfWeek.includes(d.key);
                      return (
                        <button
                          key={d.key}
                          type="button"
                          onClick={() => handleToggleAmplifierDay(rule.id, d.key)}
                          className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
                            active
                              ? 'bg-amber-400 text-slate-950 border-amber-400 font-semibold'
                              : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                          }`}
                        >
                          {d.short}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="lg:col-span-2 flex items-center justify-end gap-3 pt-2 lg:pt-4">
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) =>
                        handleUpdateAmplifierRule(rule.id, { enabled: e.target.checked })
                      }
                      className="rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
                    />
                    <span>Aktywny</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => handleDeleteAmplifierRule(rule.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors cursor-pointer"
                    title="Usuń przedział"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="pt-3 border-t border-slate-700 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            Zapisanie planu aktualizuje zarówno harmonogramy dzwonków, jak i harmonogram pracy wzmacniacza.
          </span>
          <button
            onClick={handleSaveAll}
            disabled={isSaving}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
          >
            {saveSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            <span>{isSaving ? 'Zapisywanie...' : saveSuccess ? 'Plan Zapisany!' : 'Zapisz Harmonogram'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
