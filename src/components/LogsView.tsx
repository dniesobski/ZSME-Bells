import React, { useState } from 'react';
import { History, Download, Trash2, Search, CheckCircle2, AlertTriangle, Filter } from 'lucide-react';
import { BellHistoryEntry, BellType } from '../types/bell';

interface LogsViewProps {
  history: BellHistoryEntry[];
  onClearHistory: () => Promise<void>;
}

export const LogsView: React.FC<LogsViewProps> = ({ history, onClearHistory }) => {
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredHistory = history.filter((entry) => {
    if (filterType !== 'all' && entry.bellType !== filterType) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        entry.title.toLowerCase().includes(q) ||
        entry.soundName.toLowerCase().includes(q) ||
        entry.timeStr.includes(q)
      );
    }
    return true;
  });

  const handleExportCSV = () => {
    const headers = ['Czas', 'Data', 'Typ', 'Nazwa', 'Melodia', 'Status', 'Szczegóły'];
    const rows = filteredHistory.map((e) => [
      e.timeStr,
      e.timestamp,
      e.bellType,
      `"${e.title.replace(/"/g, '""')}"`,
      `"${e.soundName.replace(/"/g, '""')}"`,
      e.status,
      `"${(e.details || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dziennik_dzwonkow_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <History className="w-5 h-5 text-amber-400" />
            Dziennik Zdarzeń i Wyzwoleń Dzwonków
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Szczegółowa historia odtworzonych sygnałów dźwiękowych, statusów karty audio oraz wyzwoleń ręcznych
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            disabled={history.length === 0}
            className="px-3.5 py-2 text-xs font-medium text-slate-300 bg-slate-700/80 hover:bg-slate-700 border border-slate-600/70 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Eksportuj do CSV</span>
          </button>

          <button
            onClick={onClearHistory}
            disabled={history.length === 0}
            className="px-3.5 py-2 text-xs font-medium text-rose-300 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Wyczyść Dziennik</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <div className="flex flex-wrap gap-1">
            {[
              { id: 'all', label: 'Wszystkie' },
              { id: 'lesson_start', label: 'Na Lekcję' },
              { id: 'lesson_end', label: 'Na Przerwę' },
              { id: 'warning', label: 'Przywoławcze' },
              { id: 'manual', label: 'Ręczne' },
              { id: 'radio_start', label: 'Radio Start' },
              { id: 'radio_stop', label: 'Radio Stop' },
              { id: 'amplifier_on', label: 'Wzmacniacz Wł.' },
              { id: 'amplifier_off', label: 'Wzmacniacz Wył.' },
              { id: 'bell_draw', label: 'Losowanie' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilterType(f.id)}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                  filterType === f.id
                    ? 'bg-amber-400 text-slate-950 font-semibold'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Szukaj po nazwie, melodii..."
            className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs focus:outline-none focus:border-amber-400"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
        {filteredHistory.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            Brak zdarzeń spełniających wybrane kryteria wyszukiwania.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400 uppercase tracking-wider text-[11px]">
                  <th className="py-2.5 px-3">Godzina</th>
                  <th className="py-2.5 px-3">Zdarzenie / Tytuł</th>
                  <th className="py-2.5 px-3">Typ Dzwonka</th>
                  <th className="py-2.5 px-3">Użyta Melodia</th>
                  <th className="py-2.5 px-3">Status Silnika Audio</th>
                  <th className="py-2.5 px-3">Szczegóły</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {filteredHistory.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-750 transition-colors">
                    <td className="py-3 px-3 font-mono font-bold tabular-nums text-amber-300">
                      {item.timeStr}
                    </td>
                    <td className="py-3 px-3 font-semibold text-white">{item.title}</td>
                    <td className="py-3 px-3">
                      <span className="text-[11px] px-2 py-0.5 rounded border bg-slate-900 border-slate-700 text-slate-300">
                        {item.bellType === 'lesson_start'
                          ? 'Dzwonek na lekcję'
                          : item.bellType === 'lesson_end'
                          ? 'Dzwonek na przerwę'
                          : item.bellType === 'warning'
                          ? 'Przywoławczy (1 min)'
                          : item.bellType === 'emergency'
                          ? 'Sygnał alarmowy'
                          : item.bellType === 'radio_start'
                          ? 'Radio - Start'
                          : item.bellType === 'radio_stop'
                          ? 'Radio - Stop'
                          : item.bellType === 'amplifier_on'
                          ? 'Wzmacniacz Wł. (1)'
                          : item.bellType === 'amplifier_off'
                          ? 'Wzmacniacz Wył. (0)'
                          : item.bellType === 'bell_draw'
                          ? 'Losowanie dzwonków'
                          : 'Wyzwolenie ręczne'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-300">{item.soundName}</td>
                    <td className="py-3 px-3">
                      {item.status === 'played_linux' ? (
                        <span className="text-emerald-400 font-medium flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Linux ALSA/Pulse OK
                        </span>
                      ) : item.status === 'simulated' ? (
                        <span className="text-sky-400 font-medium flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Serwer Web OK
                        </span>
                      ) : (
                        <span className="text-rose-400 font-medium flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Błąd odtwarzania
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] text-slate-400">
                      {item.details || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
