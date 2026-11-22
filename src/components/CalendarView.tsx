import React, { useState } from 'react';
import { Calendar, Plus, Trash2, Save, Check, ShieldAlert, Sparkles } from 'lucide-react';
import { AppConfig, SchoolHoliday } from '../types/bell';

interface CalendarViewProps {
  config: AppConfig;
  onSaveConfig: (updatedConfig: AppConfig) => Promise<void>;
}

export const CalendarView: React.FC<CalendarViewProps> = ({ config, onSaveConfig }) => {
  const [holidays, setHolidays] = useState<SchoolHoliday[]>(config.holidays);
  const [weekMapping, setWeekMapping] = useState(config.weekMapping);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // New holiday form
  const [newName, setNewName] = useState('');
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [newType, setNewType] = useState<'holiday' | 'special_schedule' | 'silent_day'>('holiday');
  const [newOverrideProfile, setNewOverrideProfile] = useState(config.schedules[0]?.id || '');

  const dayNames = [
    { key: 1, name: 'Poniedziałek' },
    { key: 2, name: 'Wtorek' },
    { key: 3, name: 'Środa' },
    { key: 4, name: 'Czwartek' },
    { key: 5, name: 'Piątek' },
    { key: 6, name: 'Sobota' },
    { key: 0, name: 'Niedziela' },
  ];

  const handleAddHoliday = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newStart) return;

    const newH: SchoolHoliday = {
      id: `hol_${Date.now()}`,
      name: newName,
      startDate: newStart,
      endDate: newEnd || newStart,
      type: newType,
      overrideProfileId: newType === 'special_schedule' ? newOverrideProfile : undefined,
    };

    setHolidays([...holidays, newH]);
    setNewName('');
    setNewStart('');
    setNewEnd('');
  };

  const handleDeleteHoliday = (id: string) => {
    setHolidays(holidays.filter((h) => h.id !== id));
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await onSaveConfig({
        ...config,
        holidays,
        weekMapping,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Calendar className="w-5 h-5 text-amber-400" />
            Kalendarz Szkolny i Dni Wolne
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Zdefiniuj ferie, święta państwowe oraz przypisz plany lekcji do konkretnych dni tygodnia
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
        >
          {saveSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          <span>{isSaving ? 'Zapisywanie...' : saveSuccess ? 'Zapisano!' : 'Zapisz Kalendarz'}</span>
        </button>
      </div>

      {/* Weekday Profile Assignment */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Harmonogram Dni Tygodnia (Poniedziałek – Niedziela)
          </h3>
          <span className="text-[11px] text-slate-400">
            Wybierz profil lekcji dla każdego dnia (w tym dla soboty) lub ustaw dzień wolny
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3 text-xs">
          {dayNames.map((d) => {
            const currentVal = weekMapping[d.key] || (d.key === 0 ? '__silent__' : config.activeProfileId);
            const isSilent = currentVal === '__silent__';
            return (
              <div
                key={d.key}
                className={`p-3 rounded-lg border space-y-1.5 ${
                  isSilent
                    ? 'bg-slate-900/40 border-slate-800'
                    : 'bg-slate-900/80 border-slate-700/60'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-semibold text-slate-200">{d.name}</span>
                  {isSilent && (
                    <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                      Wolne
                    </span>
                  )}
                </div>
                <select
                  value={currentVal}
                  onChange={(e) =>
                    setWeekMapping({
                      ...weekMapping,
                      [d.key]: e.target.value,
                    })
                  }
                  className={`w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-amber-400 ${
                    isSilent ? 'text-slate-400' : 'text-amber-300'
                  }`}
                >
                  <option value="__silent__">Brak zajęć (Dzień wolny)</option>
                  {config.schedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      {/* Holidays & Exceptions Manager */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Form: Add holiday (5 cols) */}
        <div className="lg:col-span-5 bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-700/60">
            <Plus className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Dodaj Dzień Wolny / Wyjątek
            </h3>
          </div>

          <form onSubmit={handleAddHoliday} className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-300 mb-1">Nazwa święta / okazji</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="np. Dzień Edukacji Narodowej, Rekolekcje"
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-amber-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-300 mb-1">Data początkowa</label>
                <input
                  type="date"
                  required
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                  className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">Data końcowa (opcjonalnie)</label>
                <input
                  type="date"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                  className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 mb-1">Zachowanie dzwonków</label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as any)}
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-amber-400"
              >
                <option value="holiday">Dzień wolny (Całkowite wyciszenie dzwonków)</option>
                <option value="special_schedule">Wyjątek rozkładu (Uruchom specjalny profil)</option>
                <option value="silent_day">Dzień cichy (Egzaminy / Cisza)</option>
              </select>
            </div>

            {newType === 'special_schedule' && (
              <div>
                <label className="block text-slate-300 mb-1">Wybierz profil zastępczy</label>
                <select
                  value={newOverrideProfile}
                  onChange={(e) => setNewOverrideProfile(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-amber-300"
                >
                  {config.schedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="submit"
              className="w-full py-2 px-4 rounded-lg bg-amber-400 hover:bg-amber-300 active:bg-amber-500 text-slate-950 font-semibold text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Dodaj do Kalendarza</span>
            </button>
          </form>
        </div>

        {/* List of holidays (7 cols) */}
        <div className="lg:col-span-7 bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Zarejestrowane Dni Wolne i Wyjątki ({holidays.length})
            </h3>
            <span className="text-xs text-slate-400">Rok Szkolny 2026/2027</span>
          </div>

          <div className="divide-y divide-slate-700/50 max-h-[420px] overflow-y-auto pr-1">
            {holidays.map((h) => {
              const isDateRange = h.startDate !== h.endDate;
              return (
                <div key={h.id} className="py-2.5 flex items-center justify-between text-xs hover:bg-slate-750">
                  <div>
                    <div className="font-semibold text-white">{h.name}</div>
                    <div className="font-mono text-[11px] text-slate-400">
                      {h.startDate} {isDateRange ? ` do ${h.endDate}` : ''}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded border ${
                        h.type === 'holiday'
                          ? 'bg-amber-950/60 text-amber-300 border-amber-800/80'
                          : h.type === 'special_schedule'
                          ? 'bg-sky-950/60 text-sky-300 border-sky-800/80'
                          : 'bg-rose-950/60 text-rose-300 border-rose-800/80'
                      }`}
                    >
                      {h.type === 'holiday' ? 'Dzień Wolny' : h.type === 'special_schedule' ? 'Profil Specjalny' : 'Cisza'}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleDeleteHoliday(h.id)}
                      className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors cursor-pointer"
                      title="Usuń"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
