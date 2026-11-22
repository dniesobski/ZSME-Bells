import React, { useState, useRef, useEffect } from 'react';
import {
  Radio,
  Play,
  Square,
  Plus,
  Trash2,
  Save,
  Check,
  Volume2,
  Wifi,
  Clock,
  Sliders,
  Edit2,
  Headphones,
  Speaker,
  AlertCircle,
} from 'lucide-react';
import { AppConfig, RadioStation, SystemStatus } from '../types/bell';
import { apiFetch } from '../utils/apiClient';

interface RadioViewProps {
  config: AppConfig;
  status: SystemStatus | null;
  onSaveConfig: (updatedConfig: AppConfig) => Promise<void>;
  onPlayRadioLinux: (stationId: string, volume?: number) => Promise<void>;
  onStopRadioLinux: () => Promise<void>;
}

interface StreamCheckResult {
  checking?: boolean;
  ok?: boolean;
  status?: number;
  contentType?: string;
  icyName?: string | null;
  bitrate?: string | null;
  error?: string;
}

export const RadioView: React.FC<RadioViewProps> = ({
  config,
  status,
  onSaveConfig,
  onPlayRadioLinux,
  onStopRadioLinux,
}) => {
  const [stations, setStations] = useState<RadioStation[]>(config.radioStations || []);
  const [radioEnabled, setRadioEnabled] = useState<boolean>(config.radioEnabled ?? true);
  const [defaultStationId, setDefaultStationId] = useState<string>(
    config.defaultRadioStationId || config.radioStations?.[0]?.id || ''
  );
  const [radioVolume, setRadioVolume] = useState<number>(config.radioVolume ?? 45);
  const [startDelaySec, setStartDelaySec] = useState<number>(config.radioStartDelaySeconds ?? 5);
  const [stopBeforeSec, setStopBeforeSec] = useState<number>(config.radioStopBeforeBellSeconds ?? 3);

  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    config.activeProfileId || config.schedules[0]?.id || ''
  );
  const [localSchedules, setLocalSchedules] = useState(config.schedules);

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Add / Edit station form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formGenre, setFormGenre] = useState('');
  const [formDesc, setFormDesc] = useState('');

  // Browser preview audio player
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [previewStationId, setPreviewStationId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Stream check diagnostics per station
  const [streamChecks, setStreamChecks] = useState<Record<string, StreamCheckResult>>({});

  // Sync local state if config changes externally
  useEffect(() => {
    setStations(config.radioStations || []);
    setRadioEnabled(config.radioEnabled ?? true);
    setDefaultStationId(config.defaultRadioStationId || config.radioStations?.[0]?.id || '');
    setRadioVolume(config.radioVolume ?? 45);
    setStartDelaySec(config.radioStartDelaySeconds ?? 5);
    setStopBeforeSec(config.radioStopBeforeBellSeconds ?? 3);
    setLocalSchedules(config.schedules);
  }, [config]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    };
  }, []);

  const handleToggleBrowserPreview = async (station: RadioStation) => {
    setPreviewError(null);
    if (previewStationId === station.id) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      setPreviewStationId(null);
      return;
    }

    if (!audioRef.current) {
      audioRef.current = new Audio();
    }

    audioRef.current.pause();
    audioRef.current.src = station.streamUrl;
    audioRef.current.volume = Math.min(1, Math.max(0.1, radioVolume / 100));
    setPreviewStationId(station.id);

    try {
      await audioRef.current.play();
    } catch {
      setPreviewStationId(null);
      setPreviewError(
        `Przeglądarka nie mogła bezpośrednio otworzyć strumienia "${station.name}" (np. blokada CORS lub format AAC). Na serwerze Debian 13 (mpv) strumień będzie działał poprawnie.`
      );
    }
  };

  const handleCheckStream = async (station: RadioStation) => {
    setStreamChecks((prev) => ({
      ...prev,
      [station.id]: { checking: true },
    }));

    try {
      const res = await apiFetch('/api/radio/check-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamUrl: station.streamUrl }),
      });
      const data = await res.json();
      setStreamChecks((prev) => ({
        ...prev,
        [station.id]: { checking: false, ...data },
      }));
    } catch (err: any) {
      setStreamChecks((prev) => ({
        ...prev,
        [station.id]: { checking: false, ok: false, error: err.message },
      }));
    }
  };

  const handleSaveStationForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formUrl.trim()) return;

    if (editingId) {
      setStations((prev) =>
        prev.map((s) =>
          s.id === editingId
            ? {
                ...s,
                name: formName.trim(),
                streamUrl: formUrl.trim(),
                genre: formGenre.trim() || 'Radio internetowe',
                description: formDesc.trim(),
              }
            : s
        )
      );
      setEditingId(null);
    } else {
      const newStation: RadioStation = {
        id: `radio_${Date.now()}`,
        name: formName.trim(),
        streamUrl: formUrl.trim(),
        genre: formGenre.trim() || 'Radio internetowe',
        description: formDesc.trim() || 'Stacja dodana przez administratora',
      };
      setStations((prev) => [...prev, newStation]);
      if (!defaultStationId) {
        setDefaultStationId(newStation.id);
      }
    }

    setFormName('');
    setFormUrl('');
    setFormGenre('');
    setFormDesc('');
  };

  const handleStartEditStation = (station: RadioStation) => {
    setEditingId(station.id);
    setFormName(station.name);
    setFormUrl(station.streamUrl);
    setFormGenre(station.genre);
    setFormDesc(station.description || '');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setFormName('');
    setFormUrl('');
    setFormGenre('');
    setFormDesc('');
  };

  const handleDeleteStation = (id: string) => {
    if (stations.length <= 1) {
      alert('W systemie powinna pozostać przynajmniej jedna stacja radiowa.');
      return;
    }
    const nextStations = stations.filter((s) => s.id !== id);
    setStations(nextStations);
    if (defaultStationId === id && nextStations[0]) {
      setDefaultStationId(nextStations[0].id);
    }
  };

  const handleToggleBreakRadio = (lessonId: string, enabled: boolean) => {
    setLocalSchedules((prev) =>
      prev.map((profile) => {
        if (profile.id !== selectedProfileId) return profile;
        return {
          ...profile,
          items: profile.items.map((item) =>
            item.id === lessonId ? { ...item, playRadioOnBreak: enabled } : item
          ),
        };
      })
    );
  };

  const handleChangeBreakStation = (lessonId: string, stationId: string) => {
    setLocalSchedules((prev) =>
      prev.map((profile) => {
        if (profile.id !== selectedProfileId) return profile;
        return {
          ...profile,
          items: profile.items.map((item) =>
            item.id === lessonId
              ? { ...item, radioStationId: stationId === '' ? undefined : stationId }
              : item
          ),
        };
      })
    );
  };

  const handleSaveAll = async () => {
    try {
      setIsSaving(true);
      await onSaveConfig({
        ...config,
        radioEnabled,
        radioStations: stations,
        defaultRadioStationId: defaultStationId,
        radioVolume,
        radioStartDelaySeconds: startDelaySec,
        radioStopBeforeBellSeconds: stopBeforeSec,
        schedules: localSchedules,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const activeScheduleProfile =
    localSchedules.find((s) => s.id === selectedProfileId) || localSchedules[0];

  const sortedLessons = [...(activeScheduleProfile?.items || [])].sort((a, b) =>
    a.startTime.localeCompare(b.startTime)
  );

  // Calculate break durations between consecutive lessons
  const calcMinutesDiff = (startHHMM: string, endHHMM: string) => {
    const [h1, m1] = startHHMM.split(':').map(Number);
    const [h2, m2] = endHHMM.split(':').map(Number);
    return h2 * 60 + m2 - (h1 * 60 + m1);
  };

  const radioIsPlaying = status?.radioStatus?.isPlaying;

  return (
    <div className="space-y-6">
      {/* Top Header & Live Status Banner */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-700/60">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Radio className="w-5 h-5 text-amber-400" />
              Radio Internetowe w Radiowęźle Szkolnym
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Konfiguruj stacje radiowe online (Icecast/MP3/AAC) i wybieraj przerwy z automatyczną muzyką w tle
            </p>
          </div>

          <button
            onClick={handleSaveAll}
            disabled={isSaving}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 active:bg-amber-500 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0"
          >
            {saveSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            <span>{isSaving ? 'Zapisywanie...' : saveSuccess ? 'Zapisano!' : 'Zapisz Ustawienia Radia'}</span>
          </button>
        </div>

        {/* Live On-Air Control Strip */}
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-700/70 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
              Aktualna emisja na serwerze Debian 13
            </div>
            {radioIsPlaying ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-bold text-emerald-400">GRA NA ANTENIE:</span>
                <span className="font-bold text-white">{status?.radioStatus.stationName}</span>
                <span className="text-slate-500">·</span>
                <span className="text-xs text-amber-300 font-mono">
                  {status?.radioStatus.mode === 'auto_break' ? 'Tryb automatycznej przerwy' : 'Emisja ręczna'}
                </span>
              </div>
            ) : (
              <div className="text-sm font-medium text-slate-300">
                Cisza w radiowęźle (radio zatrzymane)
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {radioIsPlaying ? (
              <button
                type="button"
                onClick={onStopRadioLinux}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Zatrzymaj Radio</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={!defaultStationId}
                onClick={() => onPlayRadioLinux(defaultStationId, radioVolume)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-40"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Uruchom Domyślną Stację Teraz</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Global Settings + Break Selector Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Break Radio Automation Settings (5 cols) */}
        <div className="lg:col-span-5 bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-700/60">
            <Sliders className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Parametry Emisji na Przerwach
            </h3>
          </div>

          {/* Master toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/70 border border-slate-700/60">
            <div>
              <span className="font-semibold text-xs text-white block">
                Automatyczne radio na przerwach
              </span>
              <span className="text-[11px] text-slate-400">
                Włącza wybraną stację na zaznaczonych przerwach lekcyjnych
              </span>
            </div>
            <input
              type="checkbox"
              checked={radioEnabled}
              onChange={(e) => setRadioEnabled(e.target.checked)}
              className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
            />
          </div>

          {/* Default Station */}
          <div className="text-xs">
            <label className="block text-slate-300 font-medium mb-1">
              Domyślna stacja radiowa na przerwy
            </label>
            <select
              value={defaultStationId}
              onChange={(e) => setDefaultStationId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-amber-300 text-xs focus:outline-none focus:border-amber-400"
            >
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.genre})
                </option>
              ))}
            </select>
          </div>

          {/* Radio Volume */}
          <div>
            <div className="flex items-center justify-between text-xs text-slate-200 mb-1.5">
              <span className="flex items-center gap-1.5 font-medium">
                <Volume2 className="w-3.5 h-3.5 text-amber-400" />
                Głośność radia na przerwach
              </span>
              <span className="font-mono tabular-nums text-amber-300 font-bold">{radioVolume}%</span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              value={radioVolume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setRadioVolume(v);
                if (audioRef.current) {
                  audioRef.current.volume = v / 100;
                }
              }}
              className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Zalecamy 35–55%, aby muzyka stanowiła przyjemne tło i nie zagłuszała rozmów na korytarzu.
            </p>
          </div>

          {/* Safety Delays around Bells */}
          <div className="grid grid-cols-2 gap-3 text-xs pt-2 border-t border-slate-700/60">
            <div>
              <label className="block text-slate-300 mb-1">Start po dzwonku (sek.)</label>
              <input
                type="number"
                min="0"
                max="60"
                value={startDelaySec}
                onChange={(e) => setStartDelaySec(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 font-mono tabular-nums"
              />
            </div>

            <div>
              <label className="block text-slate-300 mb-1">Stop przed dzwonkiem (sek.)</label>
              <input
                type="number"
                min="0"
                max="60"
                value={stopBeforeSec}
                onChange={(e) => setStopBeforeSec(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 font-mono tabular-nums"
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-400">
            Bufor czasowy gwarantuje, że melodia dzwonka na przerwę i dzwonek na lekcję zawsze wybrzmią wyraźnie bez nakładania się z radiem.
          </p>
        </div>

        {/* Right: Break-by-Break Selection Matrix (7 cols) */}
        <div className="lg:col-span-7 bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-700/60">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Wybór Przerw z Radiem
              </h3>
            </div>

            <select
              value={selectedProfileId}
              onChange={(e) => setSelectedProfileId(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-amber-300"
            >
              {localSchedules.map((p) => (
                <option key={p.id} value={p.id}>
                  Plan: {p.name}
                </option>
              ))}
            </select>
          </div>

          {sortedLessons.length < 2 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              Ten profil musi zawierać co najmniej 2 lekcje, aby wyznaczyć przerwy między nimi.
            </div>
          ) : (
            <div className="divide-y divide-slate-700/50 max-h-[380px] overflow-y-auto pr-1">
              {sortedLessons.slice(0, -1).map((lesson, idx) => {
                const nextLesson = sortedLessons[idx + 1];
                const breakMins = calcMinutesDiff(lesson.endTime, nextLesson.startTime);
                const isBreakEnabled = Boolean(lesson.playRadioOnBreak);

                return (
                  <div
                    key={lesson.id}
                    className={`py-2.5 px-2 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 text-xs rounded transition-colors ${
                      isBreakEnabled ? 'bg-amber-500/5' : ''
                    }`}
                  >
                    <label className="flex items-center gap-3 cursor-pointer flex-1 min-w-[200px]">
                      <input
                        type="checkbox"
                        checked={isBreakEnabled}
                        onChange={(e) => handleToggleBreakRadio(lesson.id, e.target.checked)}
                        className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer shrink-0"
                      />
                      <div>
                        <div className="font-semibold text-white">
                          Przerwa po {lesson.name}
                          <span className="ml-2 font-mono text-amber-300 text-[11px]">
                            ({breakMins} min)
                          </span>
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-400">
                          {lesson.endTime} – {nextLesson.startTime}
                        </div>
                      </div>
                    </label>

                    <div className="w-full sm:w-56 shrink-0">
                      <select
                        disabled={!isBreakEnabled}
                        value={lesson.radioStationId || ''}
                        onChange={(e) => handleChangeBreakStation(lesson.id, e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 disabled:opacity-40 focus:outline-none focus:border-amber-400"
                      >
                        <option value="">Domyślna stacja z ustawień</option>
                        {stations.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Preview warning if browser blocks CORS/AAC */}
      {previewError && (
        <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-800/70 text-amber-200 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>{previewError}</span>
        </div>
      )}

      {/* Radio Stations Catalog + Add New Station */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Stations List (7 cols) */}
        <div className="lg:col-span-7 bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Wifi className="w-4 h-4 text-amber-400" />
              Lista Stacji Radiowych ({stations.length})
            </h3>
            <span className="text-xs text-slate-400">Strumienie MP3 / AAC / Icecast</span>
          </div>

          <div className="space-y-3">
            {stations.map((station) => {
              const isDefault = station.id === defaultStationId;
              const isPreviewing = previewStationId === station.id;
              const isOnAir = radioIsPlaying && status?.radioStatus.stationId === station.id;
              const check = streamChecks[station.id];

              return (
                <div
                  key={station.id}
                  className={`p-3.5 rounded-xl border transition-all space-y-2.5 ${
                    isOnAir
                      ? 'bg-emerald-950/20 border-emerald-700/60'
                      : 'bg-slate-900/70 border-slate-700/60'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-bold text-white">{station.name}</h4>
                        <span className="text-[11px] text-slate-400">{station.genre}</span>
                        {isDefault && (
                          <span className="text-[11px] text-amber-300 font-semibold">
                            · Domyślna na przerwy
                          </span>
                        )}
                        {isOnAir && (
                          <span className="text-[11px] text-emerald-400 font-semibold">
                            · Gra na antenie
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                        {station.streamUrl}
                      </div>
                      {station.description && (
                        <p className="text-xs text-slate-300 mt-1">{station.description}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleStartEditStation(station)}
                        className="p-1.5 text-slate-400 hover:text-amber-300 hover:bg-slate-800 rounded transition-colors cursor-pointer"
                        title="Edytuj stację"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteStation(station.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors cursor-pointer"
                        title="Usuń stację"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Stream Check Diagnostic Info */}
                  {check && !check.checking && (
                    <div
                      className={`text-[11px] font-mono px-2.5 py-1.5 rounded border ${
                        check.ok
                          ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                          : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                      }`}
                    >
                      {check.ok ? (
                        <span>
                          Połączenie OK (HTTP {check.status}) · Format: {check.contentType}
                          {check.bitrate ? ` · ${check.bitrate} kbps` : ''}
                          {check.icyName ? ` · Strumień: ${check.icyName}` : ''}
                        </span>
                      ) : (
                        <span>Błąd strumienia: {check.error || `HTTP ${check.status}`}</span>
                      )}
                    </div>
                  )}

                  {/* Station Actions */}
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => handleToggleBrowserPreview(station)}
                      className={`px-2.5 py-1 text-xs rounded-md border flex items-center gap-1.5 transition-colors cursor-pointer ${
                        isPreviewing
                          ? 'bg-rose-600 border-rose-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                      }`}
                    >
                      {isPreviewing ? (
                        <Square className="w-3 h-3 fill-current" />
                      ) : (
                        <Headphones className="w-3 h-3 text-amber-400" />
                      )}
                      <span>{isPreviewing ? 'Zatrzymaj odsłuch' : 'Odsłuch w przeglądarce'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        isOnAir ? onStopRadioLinux() : onPlayRadioLinux(station.id, radioVolume)
                      }
                      className={`px-2.5 py-1 text-xs rounded-md border flex items-center gap-1.5 transition-colors cursor-pointer ${
                        isOnAir
                          ? 'bg-rose-950/60 border-rose-700 text-rose-300 hover:bg-rose-900/60'
                          : 'bg-amber-400 border-amber-300 text-slate-950 font-semibold hover:bg-amber-300'
                      }`}
                    >
                      <Speaker className="w-3 h-3" />
                      <span>{isOnAir ? 'Wyłącz na Debianie' : 'Puść w radiowęźle'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCheckStream(station)}
                      disabled={check?.checking}
                      className="px-2.5 py-1 text-xs rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors cursor-pointer"
                    >
                      {check?.checking ? 'Sprawdzanie...' : 'Testuj strumień'}
                    </button>

                    {!isDefault && (
                      <button
                        type="button"
                        onClick={() => setDefaultStationId(station.id)}
                        className="px-2.5 py-1 text-xs rounded-md text-amber-300 hover:bg-amber-500/10 transition-colors cursor-pointer ml-auto"
                      >
                        Ustaw jako domyślną
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Add / Edit Station Form (5 cols) */}
        <div className="lg:col-span-5 bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4 h-fit">
          <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Plus className="w-4 h-4 text-amber-400" />
              {editingId ? 'Edytuj Stację Radiową' : 'Dodaj Nową Stację Radiową'}
            </h3>
            {editingId && (
              <button
                type="button"
                onClick={handleCancelEdit}
                className="text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Anuluj edycję
              </button>
            )}
          </div>

          <form onSubmit={handleSaveStationForm} className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-300 mb-1">Nazwa stacji *</label>
              <input
                type="text"
                required
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="np. Polskie Radio Trójka / RMF Classic"
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-amber-400"
              />
            </div>

            <div>
              <label className="block text-slate-300 mb-1">Adres strumienia (URL) *</label>
              <input
                type="url"
                required
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder="https://stream.adres-stacji.pl/stream.mp3"
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 font-mono focus:outline-none focus:border-amber-400"
              />
              <span className="text-[11px] text-slate-400 block mt-1">
                Obsługiwane formaty w Debianie (mpv): MP3, AAC, OGG, Icecast, Shoutcast, HLS (.m3u8).
              </span>
            </div>

            <div>
              <label className="block text-slate-300 mb-1">Gatunek / Charakter</label>
              <input
                type="text"
                value={formGenre}
                onChange={(e) => setFormGenre(e.target.value)}
                placeholder="np. Jazz / Klasyka / Chillout"
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-amber-400"
              />
            </div>

            <div>
              <label className="block text-slate-300 mb-1">Opis (opcjonalnie)</label>
              <input
                type="text"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="np. Spokojna stacja bez reklam na długie przerwy"
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-amber-400"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2 px-4 rounded-lg bg-amber-400 hover:bg-amber-300 active:bg-amber-500 text-slate-950 font-semibold text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{editingId ? 'Zaktualizuj Stację na Liście' : 'Dodaj Stację do Listy'}</span>
            </button>

            <p className="text-[11px] text-slate-400 text-center">
              Po dodaniu lub edycji stacji kliknij „Zapisz Ustawienia Radia” na górze, aby zapisać zmiany w pliku `config.json`.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
};
