import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Music,
  Play,
  Square,
  Upload,
  Trash2,
  Sparkles,
  FileAudio,
  Globe,
  RefreshCw,
  Download,
  Shuffle,
  Calendar,
  Save,
  Check,
  AlertTriangle,
} from 'lucide-react';
import {
  AppConfig,
  BellRandomizerConfig,
  RemoteBellScanResult,
  SoundTrack,
  SystemStatus,
} from '../types/bell';
import {
  DEFAULT_BELL_RANDOMIZER_CONFIG,
  DEFAULT_REMOTE_BELLS_URL,
} from '../data/defaultConfig';
import { bellPlayer } from '../utils/audioPlayer';
import { apiFetch } from '../utils/apiClient';

interface SoundsViewProps {
  config: AppConfig;
  sounds: SoundTrack[];
  status?: SystemStatus | null;
  onUploadCustomSound: (sound: {
    name: string;
    description: string;
    musicalKey: string;
    base64Data: string;
    filename: string;
  }) => Promise<void>;
  onDeleteCustomSound: (id: string) => Promise<void>;
  onUpdateDefaultSounds: (updates: {
    defaultStartSoundId?: string;
    defaultEndSoundId?: string;
    defaultWarningSoundId?: string;
  }) => Promise<void>;
  onSaveConfig: (updatedConfig: AppConfig) => Promise<void>;
  onRefreshSounds: () => Promise<void>;
}

const WEEK_DAYS_ORDERED = [
  { key: 1, short: 'Pn', name: 'Poniedziałek' },
  { key: 2, short: 'Wt', name: 'Wtorek' },
  { key: 3, short: 'Śr', name: 'Środa' },
  { key: 4, short: 'Cz', name: 'Czwartek' },
  { key: 5, short: 'Pt', name: 'Piątek' },
  { key: 6, short: 'Sb', name: 'Sobota' },
  { key: 0, short: 'Nd', name: 'Niedziela' },
];

function formatLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getCurrentMondayStr(d: Date = new Date()): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
  const offset = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - offset);
  return formatLocalDateStr(copy);
}

function getNextMondayStr(d: Date = new Date()): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
  const offset = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - offset + 7);
  return formatLocalDateStr(copy);
}

export const SoundsView: React.FC<SoundsViewProps> = ({
  config,
  sounds,
  status,
  onUploadCustomSound,
  onDeleteCustomSound,
  onUpdateDefaultSounds,
  onSaveConfig,
  onRefreshSounds,
}) => {
  const [activePlayingId, setActivePlayingId] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadKey, setUploadKey] = useState('Dźwięk własny');
  const [fileData, setFileData] = useState<{ base64: string; name: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  // Remote directory browser & sync state
  const [remoteUrl, setRemoteUrl] = useState<string>(
    config.remoteBellsUrl || DEFAULT_REMOTE_BELLS_URL
  );
  const [scanResult, setScanResult] = useState<RemoteBellScanResult | null>(null);
  const [selectedRemoteUrls, setSelectedRemoteUrls] = useState<string[]>([]);
  const [removeStaleOnSync, setRemoveStaleOnSync] = useState<boolean>(true);
  const [isScanningRemote, setIsScanningRemote] = useState(false);
  const [isDownloadingRemote, setIsDownloadingRemote] = useState(false);
  const [isSyncingRemote, setIsSyncingRemote] = useState(false);
  const [remoteStatusMsg, setRemoteStatusMsg] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);
  const [previewingRemoteUrl, setPreviewingRemoteUrl] = useState<string | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteObjectUrlRef = useRef<string | null>(null);

  // Bell randomizer state
  const [randomizer, setRandomizer] = useState<BellRandomizerConfig>(() => ({
    ...DEFAULT_BELL_RANDOMIZER_CONFIG,
    ...(config.bellRandomizer || {}),
    noRepeatWeeks:
      typeof config.bellRandomizer?.noRepeatWeeks === 'number'
        ? config.bellRandomizer.noRepeatWeeks
        : DEFAULT_BELL_RANDOMIZER_CONFIG.noRepeatWeeks,
    activeDays:
      config.bellRandomizer?.activeDays && config.bellRandomizer.activeDays.length > 0
        ? config.bellRandomizer.activeDays
        : DEFAULT_BELL_RANDOMIZER_CONFIG.activeDays,
    selectedSoundIds: config.bellRandomizer?.selectedSoundIds || [],
    weekAssignments: config.bellRandomizer?.weekAssignments || {},
  }));
  const [isSavingRand, setIsSavingRand] = useState(false);
  const [isDrawingRand, setIsDrawingRand] = useState(false);
  const [randSavedOk, setRandSavedOk] = useState(false);
  const [randMsg, setRandMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const customWeeksInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (config.remoteBellsUrl) {
      setRemoteUrl(config.remoteBellsUrl);
    }
  }, [config.remoteBellsUrl]);

  useEffect(() => {
    setRandomizer({
      ...DEFAULT_BELL_RANDOMIZER_CONFIG,
      ...(config.bellRandomizer || {}),
      noRepeatWeeks:
        typeof config.bellRandomizer?.noRepeatWeeks === 'number'
          ? config.bellRandomizer.noRepeatWeeks
          : DEFAULT_BELL_RANDOMIZER_CONFIG.noRepeatWeeks,
      activeDays:
        config.bellRandomizer?.activeDays && config.bellRandomizer.activeDays.length > 0
          ? config.bellRandomizer.activeDays
          : DEFAULT_BELL_RANDOMIZER_CONFIG.activeDays,
      selectedSoundIds: config.bellRandomizer?.selectedSoundIds || [],
      weekAssignments: config.bellRandomizer?.weekAssignments || {},
    });
  }, [config.bellRandomizer]);

  useEffect(() => {
    return () => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.pause();
        remoteAudioRef.current = null;
      }
      if (remoteObjectUrlRef.current) {
        URL.revokeObjectURL(remoteObjectUrlRef.current);
        remoteObjectUrlRef.current = null;
      }
    };
  }, []);

  const presets = sounds.filter((s) => s.category === 'preset');
  const custom = sounds.filter((s) => s.category === 'custom');

  const stopRemotePreview = () => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current = null;
    }
    if (remoteObjectUrlRef.current) {
      URL.revokeObjectURL(remoteObjectUrlRef.current);
      remoteObjectUrlRef.current = null;
    }
    setPreviewingRemoteUrl(null);
  };

  const handleTogglePlay = async (sound: SoundTrack) => {
    stopRemotePreview();
    if (activePlayingId === sound.id) {
      bellPlayer.stop();
      setActivePlayingId(null);
      return;
    }

    setActivePlayingId(sound.id);
    await bellPlayer.playSound(sound.id, {
      volume: 0.8,
      fileUrl: sound.fileUrl,
      audioData: sound.audioData,
      onEnded: () => setActivePlayingId(null),
    });
  };

  const handleToggleRemotePreview = async (fileUrl: string) => {
    bellPlayer.stop();
    setActivePlayingId(null);

    if (previewingRemoteUrl === fileUrl) {
      stopRemotePreview();
      return;
    }

    stopRemotePreview();
    setPreviewingRemoteUrl(fileUrl);
    try {
      const res = await apiFetch(
        `/api/sounds/remote/preview?url=${encodeURIComponent(fileUrl)}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || 'Błąd odtwarzania podglądu');
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      remoteObjectUrlRef.current = objUrl;
      const audio = new Audio(objUrl);
      remoteAudioRef.current = audio;
      audio.onended = () => stopRemotePreview();
      audio.onerror = () => stopRemotePreview();
      await audio.play();
    } catch (err: any) {
      stopRemotePreview();
      setRemoteStatusMsg({
        type: 'error',
        text: err?.message || 'Nie udało się odsłuchać pliku zdalnego.',
      });
    }
  };

  // Scan remote directory
  const handleScanRemote = async () => {
    setIsScanningRemote(true);
    setRemoteStatusMsg(null);
    try {
      const res = await apiFetch('/api/sounds/remote/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: remoteUrl.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Nie udało się odczytać katalogu internetowego.');
      }
      const result: RemoteBellScanResult = data.result;
      setScanResult(result);
      setRemoteUrl(result.directoryUrl);
      // Pre-select new files by default for convenience
      const newUrls = result.files.filter((f) => !f.alreadyOnController).map((f) => f.url);
      setSelectedRemoteUrls(newUrls);
      setRemoteStatusMsg({
        type: 'info',
        text: `Znaleziono ${result.files.length} plików audio w katalogu (${newUrls.length} nowych, ${result.staleLocalSynced.length} usuniętych ze strony).`,
      });
    } catch (err: any) {
      setRemoteStatusMsg({
        type: 'error',
        text: err?.message || 'Błąd połączenia z katalogiem internetowym.',
      });
    } finally {
      setIsScanningRemote(false);
    }
  };

  const handleToggleSelectRemote = (url: string) => {
    setSelectedRemoteUrls((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]
    );
  };

  const handleDownloadSelected = async () => {
    if (!scanResult || selectedRemoteUrls.length === 0) return;
    setIsDownloadingRemote(true);
    setRemoteStatusMsg(null);
    try {
      const filesToDownload = scanResult.files
        .filter((f) => selectedRemoteUrls.includes(f.url))
        .map((f) => ({ url: f.url, filename: f.filename }));

      const res = await apiFetch('/api/sounds/remote/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          directoryUrl: scanResult.directoryUrl,
          files: filesToDownload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Błąd pobierania zaznaczonych plików.');
      }
      if (data.scanResult) {
        setScanResult(data.scanResult);
      }
      setSelectedRemoteUrls([]);
      await onRefreshSounds();
      const failedCount = Array.isArray(data.failed) ? data.failed.length : 0;
      setRemoteStatusMsg({
        type: failedCount > 0 ? 'error' : 'success',
        text: `Pobrano na kontroler: ${data.added || 0} nowych, ${data.updated || 0} zaktualizowanych${
          failedCount > 0 ? `, błędów: ${failedCount}` : '.'
        }`,
      });
    } catch (err: any) {
      setRemoteStatusMsg({
        type: 'error',
        text: err?.message || 'Błąd podczas pobierania plików.',
      });
    } finally {
      setIsDownloadingRemote(false);
    }
  };

  const handleSyncWithRemote = async () => {
    setIsSyncingRemote(true);
    setRemoteStatusMsg(null);
    try {
      const res = await apiFetch('/api/sounds/remote/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          directoryUrl: remoteUrl.trim(),
          removeStale: removeStaleOnSync,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Błąd synchronizacji ze stroną.');
      }
      if (data.result) {
        setScanResult(data.result);
        setRemoteUrl(data.result.directoryUrl);
      }
      setSelectedRemoteUrls([]);
      await onRefreshSounds();
      const failedCount = Array.isArray(data.failed) ? data.failed.length : 0;
      setRemoteStatusMsg({
        type: failedCount > 0 ? 'error' : 'success',
        text: `Synchronizacja zakończona: dodano ${data.added || 0} nowych, pominięto ${data.skippedExisting || 0} istniejących, usunięto ${data.removed || 0} starych${
          failedCount > 0 ? `, błędów: ${failedCount}` : '.'
        }`,
      });
    } catch (err: any) {
      setRemoteStatusMsg({
        type: 'error',
        text: err?.message || 'Nie udało się zsynchronizować kontrolera ze stroną.',
      });
    } finally {
      setIsSyncingRemote(false);
    }
  };

  // Upload handlers
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
      alert('Plik audio nie może być większy niż 20MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setFileData({ base64, name: file.name });
      if (!uploadName) {
        setUploadName(file.name.replace(/\.[^/.]+$/, ''));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileData || !uploadName) return;

    try {
      setIsUploading(true);
      await onUploadCustomSound({
        name: uploadName,
        description: uploadDesc || 'Wgrany plik audio szkolnego radiowęzła',
        musicalKey: uploadKey || 'Własny',
        base64Data: fileData.base64,
        filename: fileData.name,
      });
      setFileData(null);
      setUploadName('');
      setUploadDesc('');
      setUploadMsg('Plik audio został pomyślnie zapisany na serwerze Debian!');
      setTimeout(() => setUploadMsg(null), 3500);
    } catch {
      setUploadMsg('Błąd wgrywania pliku audio.');
    } finally {
      setIsUploading(false);
    }
  };

  // Bell Randomizer handlers
  const updateRandomizer = (patch: Partial<BellRandomizerConfig>) => {
    setRandomizer((prev) => ({ ...prev, ...patch }));
  };

  const toggleRandomizerDay = (dayKey: number) => {
    setRandomizer((prev) => {
      const exists = prev.activeDays.includes(dayKey);
      if (exists && prev.activeDays.length <= 1) return prev; // Keep at least 1 day
      const nextDays = exists
        ? prev.activeDays.filter((d) => d !== dayKey)
        : [...prev.activeDays, dayKey];
      return { ...prev, activeDays: nextDays };
    });
  };

  const toggleRandomizerSelectedSound = (soundId: string) => {
    setRandomizer((prev) => {
      const exists = prev.selectedSoundIds.includes(soundId);
      return {
        ...prev,
        selectedSoundIds: exists
          ? prev.selectedSoundIds.filter((id) => id !== soundId)
          : [...prev.selectedSoundIds, soundId],
      };
    });
  };

  const handleSaveRandomizer = async () => {
    setIsSavingRand(true);
    setRandMsg(null);
    try {
      await onSaveConfig({
        ...config,
        bellRandomizer: randomizer,
      });
      await onRefreshSounds();
      setRandSavedOk(true);
      setTimeout(() => setRandSavedOk(false), 2500);
    } catch (err: any) {
      setRandMsg({
        type: 'error',
        text: err?.message || 'Nie udało się zapisać ustawień losowania.',
      });
    } finally {
      setIsSavingRand(false);
    }
  };

  const handleDrawRandomBells = async (
    scope: 'current' | 'next' | 'cycle',
    dayOfWeek?: number,
    weekKey?: string
  ) => {
    setIsDrawingRand(true);
    setRandMsg(null);
    try {
      const normalizedNoRepeatWeeks = Math.min(
        52,
        Math.max(1, Math.round(Number(randomizer.noRepeatWeeks) || 4))
      );
      const nextCfg: BellRandomizerConfig = {
        ...randomizer,
        noRepeatWeeks: normalizedNoRepeatWeeks,
      };
      // Save latest randomizer settings first so activeDays / noRepeatWeeks / pool match user selection
      await onSaveConfig({
        ...config,
        bellRandomizer: nextCfg,
      });

      const res = await apiFetch('/api/sounds/randomizer/draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          ...(typeof dayOfWeek === 'number' ? { dayOfWeek } : {}),
          ...(weekKey ? { weekKey } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Błąd losowania dzwonków.');
      }
      if (data.bellRandomizer) {
        setRandomizer(data.bellRandomizer);
      }
      await onRefreshSounds();
      setRandMsg({
        type: 'success',
        text:
          typeof dayOfWeek === 'number'
            ? `Wylosowano nowy dzwonek dla wybranego dnia (${
                WEEK_DAYS_ORDERED.find((d) => d.key === dayOfWeek)?.name || ''
              }${weekKey ? `, tydzień ${weekKey}` : ''}).`
            : scope === 'cycle'
            ? `Wylosowano harmonogram bez powtórzeń na ${
                data.weeksCount || normalizedNoRepeatWeeks
              } kolejnych tygodni!`
            : `Wylosowano nowy zestaw dzwonków na ${
                scope === 'next' ? 'przyszły tydzień' : 'bieżący tydzień'
              } (z pominięciem ostatnich ${normalizedNoRepeatWeeks} tyg.)!`,
      });
    } catch (err: any) {
      setRandMsg({
        type: 'error',
        text: err?.message || 'Nie udało się wylosować dzwonków.',
      });
    } finally {
      setIsDrawingRand(false);
    }
  };

  const handleManualAssignDaySound = async (
    weekKey: string,
    dayOfWeek: number,
    soundId: string
  ) => {
    if (!soundId) return;
    setIsDrawingRand(true);
    setRandMsg(null);
    try {
      const res = await apiFetch('/api/sounds/randomizer/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekKey, dayOfWeek, soundId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Nie udało się podmienić melodii.');
      }
      if (data.bellRandomizer) {
        setRandomizer(data.bellRandomizer);
      }
      await onRefreshSounds();
      const dayLabel = WEEK_DAYS_ORDERED.find((d) => d.key === dayOfWeek)?.name || '';
      setRandMsg({
        type: 'success',
        text: `Podmieniono melodię dla ${dayLabel} (${weekKey}) na: ${
          data.soundName || soundById.get(soundId)?.name || soundId
        }.`,
      });
    } catch (err: any) {
      setRandMsg({
        type: 'error',
        text: err?.message || 'Nie udało się podmienić melodii.',
      });
    } finally {
      setIsDrawingRand(false);
    }
  };

  const currentWeekKey = getCurrentMondayStr();
  const nextWeekKey = getNextMondayStr();
  const currentWeekMap = randomizer.weekAssignments[currentWeekKey] || {};
  const todayJsDay = new Date().getDay();

  const noRepeatWeeksValue = Math.min(
    52,
    Math.max(1, Math.round(Number(randomizer.noRepeatWeeks) || 4))
  );

  const plannedFutureWeeks = useMemo(
    () =>
      Object.keys(randomizer.weekAssignments)
        .filter((wk) => wk > currentWeekKey)
        .sort(),
    [randomizer.weekAssignments, currentWeekKey]
  );

  const pastHistoryWeeksCount = useMemo(
    () =>
      Object.keys(randomizer.weekAssignments).filter((wk) => wk < currentWeekKey).length,
    [randomizer.weekAssignments, currentWeekKey]
  );

  const soundById = useMemo(() => {
    const map = new Map<string, SoundTrack>();
    for (const s of sounds) {
      map.set(s.id, s);
    }
    return map;
  }, [sounds]);

  const effectivePoolCount = useMemo(() => {
    if (randomizer.sourceMode === 'all_custom') {
      return custom.length > 0 ? custom.length : sounds.length;
    }
    if (randomizer.sourceMode === 'selected_ids') {
      return randomizer.selectedSoundIds.length > 0
        ? randomizer.selectedSoundIds.length
        : sounds.length;
    }
    return sounds.length;
  }, [randomizer.sourceMode, randomizer.selectedSoundIds, custom.length, sounds.length]);

  const sortedActiveDays = useMemo(() => {
    const order = [1, 2, 3, 4, 5, 6, 0];
    return [...randomizer.activeDays].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }, [randomizer.activeDays]);

  const requiredUniqueSlots = noRepeatWeeksValue * sortedActiveDays.length;

  return (
    <div className="space-y-6">
      {/* Intro Header & Pedagogical Value */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
          <div className="lg:col-span-8 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <Music className="w-4 h-4" />
              </div>
              <h2 className="text-lg font-bold text-white">Baza Harmonicznych Melodii Szkolnych</h2>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Tradycyjne dzwonki elektromechaniczne generują hałas o natężeniu przekraczającym 95-105 dB,
              wywołując nagły skok ciśnienia i poziomu kortyzolu u dzieci i pedagogów. Bezstresowe dzwonki{' '}
              <strong className="text-amber-300">HarmoniaBell</strong> wykorzystują naturalne skale
              pentatoniczne, miękki narastający atak (soft attack) oraz aksamitne wybrzmienie dzwonków
              wietrznych Koshi, marimby i gongów tybetańskich.
            </p>
          </div>

          {/* Quick Defaults Box */}
          <div className="lg:col-span-4 bg-slate-900/90 border border-slate-700/70 rounded-lg p-3.5 text-xs space-y-2">
            <span className="font-semibold text-slate-200 block text-[11px] uppercase tracking-wider">
              Domyślne Dzwonki Systemowe
            </span>
            <div className="space-y-1.5 text-[11px]">
              <div>
                <span className="text-slate-400">Na lekcję: </span>
                <select
                  value={config.defaultStartSoundId}
                  onChange={(e) => onUpdateDefaultSounds({ defaultStartSoundId: e.target.value })}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-amber-300 text-xs w-full mt-0.5"
                >
                  {sounds.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className="text-slate-400">Na przerwę: </span>
                <select
                  value={config.defaultEndSoundId}
                  onChange={(e) => onUpdateDefaultSounds({ defaultEndSoundId: e.target.value })}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-amber-300 text-xs w-full mt-0.5"
                >
                  {sounds.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className="text-slate-400">Dzwonek przywoławczy (1 min przed): </span>
                <select
                  value={config.defaultWarningSoundId}
                  onChange={(e) => onUpdateDefaultSounds({ defaultWarningSoundId: e.target.value })}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-amber-300 text-xs w-full mt-0.5"
                >
                  {sounds.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* NEW SECTION 1: Online Web Directory Scanner, Downloader & Sync */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2.5">
            <Globe className="w-5 h-5 text-amber-400" />
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Katalog Internetowy Dzwonków (Pobieranie i Synchronizacja)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Sprawdź pliki MP3/WAV/OGG na serwerze WWW, pobierz wybrane dźwięki lub zsynchronizuj kontroler ze stroną (dodawanie nowych i usuwanie starych)
              </p>
            </div>
          </div>
        </div>

        {/* URL & Action Bar */}
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center text-xs">
          <div className="flex-1 flex items-center gap-2">
            <input
              type="url"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="https://sekretariat.zsme.pl/bells/"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-amber-200 font-mono text-xs focus:outline-none focus:border-amber-400"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isScanningRemote || isSyncingRemote || !remoteUrl.trim()}
              onClick={handleScanRemote}
              className="px-3.5 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isScanningRemote ? 'animate-spin' : ''}`} />
              <span>{isScanningRemote ? 'Sprawdzanie...' : 'Sprawdź katalog'}</span>
            </button>

            <button
              type="button"
              disabled={isSyncingRemote || isScanningRemote || !remoteUrl.trim()}
              onClick={handleSyncWithRemote}
              className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingRemote ? 'animate-spin' : ''}`} />
              <span>{isSyncingRemote ? 'Synchronizowanie...' : 'Synchronizuj ze stroną'}</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <label className="flex items-center gap-2 cursor-pointer text-slate-300">
            <input
              type="checkbox"
              checked={removeStaleOnSync}
              onChange={(e) => setRemoveStaleOnSync(e.target.checked)}
              className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
            />
            <span>
              Podczas synchronizacji usuwaj z kontrolera dźwięki pobrane wcześniej ze strony, jeśli zniknęły z katalogu WWW
            </span>
          </label>
          <span className="text-[11px] text-slate-400">
            Pliki wgrane ręcznie z dysku nie są usuwane przez synchronizację.
          </span>
        </div>

        {remoteStatusMsg && (
          <div
            className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
              remoteStatusMsg.type === 'error'
                ? 'bg-rose-950/50 border-rose-800 text-rose-200'
                : remoteStatusMsg.type === 'success'
                ? 'bg-emerald-950/50 border-emerald-800 text-emerald-200'
                : 'bg-slate-900 border-amber-500/40 text-amber-200'
            }`}
          >
            {remoteStatusMsg.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span>{remoteStatusMsg.text}</span>
          </div>
        )}

        {/* Scanned Remote Files Table / Selection */}
        {scanResult && (
          <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-700/70 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-slate-800">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-white">
                  Znalezione dzwonki ({scanResult.files.length})
                </span>
                <span className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-800 text-amber-300 text-[11px] font-mono">
                  Nowe: {scanResult.files.filter((f) => !f.alreadyOnController).length}
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-[11px] font-mono">
                  Na kontrolerze: {scanResult.files.filter((f) => f.alreadyOnController).length}
                </span>
                {scanResult.staleLocalSynced.length > 0 && (
                  <span className="px-2 py-0.5 rounded bg-rose-950/60 border border-rose-800 text-rose-300 text-[11px] font-mono">
                    Usunięte ze strony: {scanResult.staleLocalSynced.length}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setSelectedRemoteUrls(scanResult.files.map((f) => f.url))}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 cursor-pointer"
                >
                  Zaznacz wszystkie
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedRemoteUrls(
                      scanResult.files.filter((f) => !f.alreadyOnController).map((f) => f.url)
                    )
                  }
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-300 cursor-pointer"
                >
                  Tylko nowe
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRemoteUrls([])}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 cursor-pointer"
                >
                  Odznacz
                </button>

                <button
                  type="button"
                  disabled={selectedRemoteUrls.length === 0 || isDownloadingRemote}
                  onClick={handleDownloadSelected}
                  className="px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>
                    {isDownloadingRemote
                      ? 'Pobieranie...'
                      : `Pobierz zaznaczone (${selectedRemoteUrls.length})`}
                  </span>
                </button>
              </div>
            </div>

            {scanResult.files.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                Pod wskazanym adresem nie znaleziono bezpośrednich odnośników do plików audio (.mp3, .wav, .ogg, .flac, .m4a).
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/80 pr-1">
                {scanResult.files.map((file) => {
                  const isChecked = selectedRemoteUrls.includes(file.url);
                  const isPreviewing = previewingRemoteUrl === file.url;
                  return (
                    <div
                      key={file.url}
                      className="py-2 px-2 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-800/40 rounded text-xs"
                    >
                      <label className="flex items-center gap-3 cursor-pointer flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelectRemote(file.url)}
                          className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-100 truncate">{file.name}</div>
                          <div className="text-[11px] font-mono text-slate-400 truncate">
                            {file.filename}
                            {file.sizeLabel ? ` · ${file.sizeLabel}` : ''}
                            {file.modifiedAt ? ` · ${file.modifiedAt}` : ''}
                          </div>
                        </div>
                      </label>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] font-mono text-slate-400">
                          {file.ext}
                        </span>
                        {file.alreadyOnController ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-[10px] font-medium">
                            Na kontrolerze
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-800 text-amber-300 text-[10px] font-medium">
                            Nowy
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleToggleRemotePreview(file.url)}
                          title={isPreviewing ? 'Zatrzymaj podgląd' : 'Odsłuchaj ze strony'}
                          className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                            isPreviewing
                              ? 'bg-rose-500 text-white'
                              : 'bg-slate-800 hover:bg-slate-700 text-amber-300'
                          }`}
                        >
                          {isPreviewing ? (
                            <Square className="w-3.5 h-3.5" />
                          ) : (
                            <Play className="w-3.5 h-3.5 fill-current" />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {scanResult.staleLocalSynced.length > 0 && (
              <div className="p-2.5 rounded-lg bg-rose-950/30 border border-rose-900/60 text-[11px] text-rose-200 space-y-1">
                <div className="font-semibold">
                  Pliki na kontrolerze usunięte z katalogu WWW ({scanResult.staleLocalSynced.length}) — zostaną usunięte przy synchronizacji:
                </div>
                <div className="flex flex-wrap gap-1.5 font-mono">
                  {scanResult.staleLocalSynced.map((s) => (
                    <span
                      key={s.id}
                      className="px-2 py-0.5 rounded bg-rose-950/70 border border-rose-800/80"
                    >
                      {s.remoteFilename || s.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* NEW SECTION 2: Weekly / Daily Bell Randomizer */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2.5">
            <Shuffle className="w-5 h-5 text-amber-400" />
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Losowanie Dzwonków Bez Powtórzeń (1 Dzwonek na Cały Dzień)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Losowanie bez powtórzeń na wybraną liczbę tygodni (4, 8, 12 lub własną) po 5 lub 6 dni (z opcją soboty) — wybrany na dany dzień dzwonek gra przez cały dzień
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={randomizer.enabled}
                onChange={(e) => updateRandomizer({ enabled: e.target.checked })}
                className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
              />
              <span className="font-semibold text-white">
                {randomizer.enabled ? 'Losowanie AKTYWNE' : 'Tryb losowania wyłączony'}
              </span>
            </label>

            <button
              type="button"
              onClick={handleSaveRandomizer}
              disabled={isSavingRand}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
            >
              {randSavedOk ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              <span>{isSavingRand ? 'Zapisywanie...' : randSavedOk ? 'Zapisano!' : 'Zapisz ustawienia'}</span>
            </button>
          </div>
        </div>

        {status?.dailyRandomBell?.enabled && status.dailyRandomBell.soundName && (
          <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/70 text-xs flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-emerald-200">
              <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                Dzisiejszy wylosowany dzwonek na cały dzień:{' '}
                <strong className="text-white">{status.dailyRandomBell.soundName}</strong>
              </span>
            </div>
            <span className="font-mono text-[11px] text-emerald-300">
              Tydzień od {status.dailyRandomBell.weekKey}
            </span>
          </div>
        )}

        {/* Randomizer Settings Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 text-xs">
          {/* Left: Schedule & Active Days */}
          <div className="lg:col-span-6 p-4 rounded-lg bg-slate-900/70 border border-slate-700/60 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Dzień automatycznego losowania
                </label>
                <select
                  value={randomizer.drawDayOfWeek}
                  onChange={(e) => updateRandomizer({ drawDayOfWeek: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-amber-300 text-xs"
                >
                  <option value={0}>Niedziela (losuje na nowy tydzień)</option>
                  <option value={6}>Sobota</option>
                  <option value={5}>Piątek</option>
                  <option value={1}>Poniedziałek (rano na bieżący tydzień)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Godzina losowania</label>
                <input
                  type="time"
                  value={randomizer.drawTime}
                  onChange={(e) => updateRandomizer({ drawTime: e.target.value })}
                  className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-300">
                  Dni lekcyjne w tygodniu ({sortedActiveDays.length} dzwonków na tydzień):
                </span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => updateRandomizer({ activeDays: [1, 2, 3, 4, 5] })}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 cursor-pointer"
                  >
                    Pn–Pt (5)
                  </button>
                  <button
                    type="button"
                    onClick={() => updateRandomizer({ activeDays: [1, 2, 3, 4, 5, 6] })}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-amber-300 cursor-pointer"
                  >
                    Pn–Sb (6)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1.5">
                {WEEK_DAYS_ORDERED.map((day) => {
                  const selected = randomizer.activeDays.includes(day.key);
                  return (
                    <button
                      key={day.key}
                      type="button"
                      onClick={() => toggleRandomizerDay(day.key)}
                      className={`py-2 rounded-lg border text-center font-semibold transition-colors cursor-pointer ${
                        selected
                          ? 'bg-amber-400/20 border-amber-500 text-amber-300'
                          : 'bg-slate-950/60 border-slate-800 text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {day.short}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-300">
                  Okres bez powtórzeń (liczba tygodni):
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[4, 8, 12].map((w) => {
                    const isPresetActive = noRepeatWeeksValue === w;
                    return (
                      <button
                        key={w}
                        type="button"
                        onClick={() => updateRandomizer({ noRepeatWeeks: w })}
                        className={`px-2.5 py-1 rounded border text-[11px] font-semibold transition-colors cursor-pointer ${
                          isPresetActive
                            ? 'bg-amber-400 text-slate-950 border-amber-300'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                        }`}
                      >
                        {w} tyg.
                      </button>
                    );
                  })}
                  <div
                    className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] ${
                      ![4, 8, 12].includes(noRepeatWeeksValue)
                        ? 'bg-amber-400/15 border-amber-500 text-amber-300'
                        : 'bg-slate-800 border-slate-700 text-slate-300'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => customWeeksInputRef.current?.focus()}
                      className="font-semibold cursor-pointer"
                    >
                      Inna:
                    </button>
                    <input
                      ref={customWeeksInputRef}
                      type="number"
                      min={1}
                      max={52}
                      value={noRepeatWeeksValue}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val)) {
                          updateRandomizer({
                            noRepeatWeeks: Math.min(52, Math.max(1, Math.round(val))),
                          });
                        }
                      }}
                      className="w-12 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-center font-mono text-amber-300 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </div>
              </div>

              <div
                className={`p-2 rounded border text-[11px] ${
                  effectivePoolCount >= requiredUniqueSlots
                    ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
                    : 'bg-amber-950/30 border-amber-800/60 text-amber-200'
                }`}
              >
                Potrzebnych dzwonków bez powtórzeń:{' '}
                <strong>
                  {noRepeatWeeksValue} tyg. × {sortedActiveDays.length} dni = {requiredUniqueSlots}
                </strong>{' '}
                (w puli: <strong>{effectivePoolCount}</strong>).{' '}
                {effectivePoolCount >= requiredUniqueSlots
                  ? `Pełne ${noRepeatWeeksValue} tyg. zagrają bez ani jednego powtórzenia.`
                  : `Po wykorzystaniu wszystkich ${effectivePoolCount} unikalnych dźwięków cykl płynnie zacznie się od najdawniej użytych.`}
              </div>
            </div>

            <div className="space-y-2 pt-1 border-t border-slate-800">
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={randomizer.avoidRepeatsInWeek}
                  onChange={(e) => updateRandomizer({ avoidRepeatsInWeek: e.target.checked })}
                  className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
                />
                <span>
                  Nie powtarzaj dzwonków przez wybrane{' '}
                  <strong>{noRepeatWeeksValue}</strong>{' '}
                  {noRepeatWeeksValue === 1 ? 'tydzień' : noRepeatWeeksValue < 5 ? 'tygodnie' : 'tygodni'}
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={randomizer.applyToWarningBell}
                  onChange={(e) => updateRandomizer({ applyToWarningBell: e.target.checked })}
                  className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
                />
                <span>Zastąp wylosowanym dźwiękiem również dzwonek przywoławczy (1 min przed lekcją)</span>
              </label>
            </div>
          </div>

          {/* Right: Sound Pool & Manual Draw Triggers */}
          <div className="lg:col-span-6 p-4 rounded-lg bg-slate-900/70 border border-slate-700/60 space-y-3 flex flex-col justify-between">
            <div className="space-y-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Pula dźwięków do losowania (aktywnych: {effectivePoolCount})
                </label>
                <select
                  value={randomizer.sourceMode}
                  onChange={(e) =>
                    updateRandomizer({
                      sourceMode: e.target.value as BellRandomizerConfig['sourceMode'],
                    })
                  }
                  className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-100 text-xs"
                >
                  <option value="all_custom">
                    Własne i pobrane z katalogu WWW ({custom.length} plików)
                  </option>
                  <option value="all_sounds">
                    Wszystkie melodie w kontrolerze (wbudowane + własne: {sounds.length})
                  </option>
                  <option value="selected_ids">
                    Tylko wybrane ręcznie dźwięki ({randomizer.selectedSoundIds.length})
                  </option>
                </select>
                {randomizer.sourceMode === 'all_custom' && custom.length === 0 && (
                  <p className="text-[11px] text-amber-300/90 mt-1">
                    Brak własnych dźwięków na kontrolerze — dopóki nie pobierzesz plików z WWW, losowanie skorzysta z wbudowanych melodii.
                  </p>
                )}
              </div>

              {randomizer.sourceMode === 'selected_ids' && (
                <div className="max-h-36 overflow-y-auto p-2 rounded bg-slate-950/70 border border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {sounds.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer truncate"
                    >
                      <input
                        type="checkbox"
                        checked={randomizer.selectedSoundIds.includes(s.id)}
                        onChange={() => toggleRandomizerSelectedSound(s.id)}
                        className="w-3.5 h-3.5 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer shrink-0"
                      />
                      <span className="truncate">{s.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 space-y-2">
              <button
                type="button"
                disabled={isDrawingRand}
                onClick={() => handleDrawRandomBells('cycle')}
                className="w-full px-3 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm"
              >
                <Shuffle className="w-4 h-4" />
                <span>Wylosuj plan bez powtórzeń na {noRepeatWeeksValue} tyg.</span>
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isDrawingRand}
                  onClick={() => handleDrawRandomBells('current')}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <Shuffle className="w-3.5 h-3.5 text-amber-400" />
                  <span>Tylko bieżący tydzień</span>
                </button>

                <button
                  type="button"
                  disabled={isDrawingRand}
                  onClick={() => handleDrawRandomBells('next')}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <Calendar className="w-3.5 h-3.5 text-sky-400" />
                  <span>Tylko przyszły tydzień</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {randMsg && (
          <div
            className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
              randMsg.type === 'error'
                ? 'bg-rose-950/50 border-rose-800 text-rose-200'
                : 'bg-emerald-950/50 border-emerald-800 text-emerald-200'
            }`}
          >
            {randMsg.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span>{randMsg.text}</span>
          </div>
        )}

        {/* Current Week Drawn Bells Schedule */}
        <div className="space-y-3">
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-700/60 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-bold text-slate-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-amber-400" />
                Bieżący tydzień (od {currentWeekKey})
              </span>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                {pastHistoryWeeksCount > 0 && (
                  <span>Zapamiętana historia bez powtórzeń: {pastHistoryWeeksCount} tyg. wstecz</span>
                )}
                {randomizer.lastDrawnAt && (
                  <span>
                    Ostatnie losowanie: {new Date(randomizer.lastDrawnAt).toLocaleString('pl-PL')}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
              {sortedActiveDays.map((dayKey) => {
                const dayMeta = WEEK_DAYS_ORDERED.find((d) => d.key === dayKey)!;
                const assignedId = currentWeekMap[dayKey] || '';
                const assignedSound = assignedId ? soundById.get(assignedId) : undefined;
                const isToday = dayKey === todayJsDay;
                const isPlayingThis = assignedSound && activePlayingId === assignedSound.id;

                return (
                  <div
                    key={dayKey}
                    className={`p-3 rounded-lg border space-y-2 ${
                      isToday
                        ? 'bg-amber-500/10 border-amber-500/60'
                        : 'bg-slate-950/70 border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-bold text-white">{dayMeta.name}</span>
                        {isToday && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 text-[9px] font-extrabold uppercase">
                            Dziś
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {assignedSound && (
                          <button
                            type="button"
                            onClick={() => handleTogglePlay(assignedSound)}
                            title="Odsłuchaj"
                            className={`p-1.5 rounded-md cursor-pointer ${
                              isPlayingThis
                                ? 'bg-rose-500 text-white'
                                : 'bg-slate-800 hover:bg-slate-700 text-amber-300'
                            }`}
                          >
                            {isPlayingThis ? (
                              <Square className="w-3 h-3" />
                            ) : (
                              <Play className="w-3 h-3 fill-current" />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={isDrawingRand}
                          onClick={() => handleDrawRandomBells('current', dayKey, currentWeekKey)}
                          title={`Przelosuj dzwonek tylko dla: ${dayMeta.name}`}
                          className="p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer disabled:opacity-40"
                        >
                          <Shuffle className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <select
                      aria-label={`Melodia dla ${dayMeta.name} (${currentWeekKey})`}
                      disabled={isDrawingRand}
                      value={assignedSound ? assignedSound.id : ''}
                      onChange={(e) =>
                        handleManualAssignDaySound(currentWeekKey, dayKey, e.target.value)
                      }
                      title="Kliknij, aby ręcznie podmienić wylosowaną melodię na inną"
                      className="w-full px-2 py-1.5 rounded bg-slate-900 border border-slate-700/80 text-[11px] text-amber-300 focus:outline-none focus:border-amber-400 cursor-pointer disabled:opacity-50"
                    >
                      {!assignedSound && (
                        <option value="" disabled>
                          — Wybierz lub wylosuj melodię —
                        </option>
                      )}
                      {custom.length > 0 && (
                        <optgroup label="Własne i z katalogu WWW">
                          {custom.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="Wbudowane melodie">
                        {presets.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                );
              })}
            </div>
          </div>

          {plannedFutureWeeks.length > 0 && (
            <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] font-bold text-sky-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>
                    Zaplanowane kolejne tygodnie bez powtórzeń ({plannedFutureWeeks.length})
                  </span>
                </div>
                <span className="text-[11px] text-slate-400">
                  Okno bez powtórzeń: {noRepeatWeeksValue} tyg. · Możesz ręcznie podmienić dowolny dzień
                </span>
              </div>

              <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                {plannedFutureWeeks.map((wk, idx) => {
                  const wkMap = randomizer.weekAssignments[wk] || {};
                  const isNextWeek = wk === nextWeekKey;
                  return (
                    <div
                      key={wk}
                      className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/90 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-sky-200">
                          Tydzień {idx + 2} (od {wk}){isNextWeek ? ' · Przyszły tydzień' : ''}
                        </span>
                        <button
                          type="button"
                          disabled={isDrawingRand}
                          onClick={() => handleDrawRandomBells('next', undefined, wk)}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] cursor-pointer disabled:opacity-40 flex items-center gap-1"
                        >
                          <Shuffle className="w-2.5 h-2.5" />
                          <span>Przelosuj tydzień</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[11px]">
                        {sortedActiveDays.map((dayKey) => {
                          const dayMeta = WEEK_DAYS_ORDERED.find((d) => d.key === dayKey)!;
                          const assignedId = wkMap[dayKey] || '';
                          const assignedSound = assignedId ? soundById.get(assignedId) : undefined;
                          const isPlayingThis = assignedSound && activePlayingId === assignedSound.id;
                          return (
                            <div
                              key={dayKey}
                              className="p-2 rounded bg-slate-900/70 border border-slate-800/80 space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-semibold text-slate-300">{dayMeta.name}</span>
                                <div className="flex items-center gap-0.5 shrink-0">
                                  {assignedSound && (
                                    <button
                                      type="button"
                                      onClick={() => handleTogglePlay(assignedSound)}
                                      title="Odsłuchaj"
                                      className={`p-1 rounded cursor-pointer ${
                                        isPlayingThis
                                          ? 'bg-rose-500 text-white'
                                          : 'text-slate-400 hover:text-amber-300'
                                      }`}
                                    >
                                      {isPlayingThis ? (
                                        <Square className="w-2.5 h-2.5" />
                                      ) : (
                                        <Play className="w-2.5 h-2.5 fill-current" />
                                      )}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    disabled={isDrawingRand}
                                    onClick={() => handleDrawRandomBells('next', dayKey, wk)}
                                    title={`Przelosuj ${dayMeta.name} (${wk})`}
                                    className="p-1 rounded text-slate-400 hover:text-white cursor-pointer disabled:opacity-40"
                                  >
                                    <Shuffle className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              </div>

                              <select
                                aria-label={`Melodia dla ${dayMeta.name} (${wk})`}
                                disabled={isDrawingRand}
                                value={assignedSound ? assignedSound.id : ''}
                                onChange={(e) =>
                                  handleManualAssignDaySound(wk, dayKey, e.target.value)
                                }
                                title="Kliknij, aby ręcznie podmienić wylosowaną melodię na inną"
                                className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-800 text-[11px] text-sky-300 focus:outline-none focus:border-sky-400 cursor-pointer disabled:opacity-50"
                              >
                                {!assignedSound && (
                                  <option value="" disabled>
                                    — Wybierz melodię —
                                  </option>
                                )}
                                {custom.length > 0 && (
                                  <optgroup label="Własne i z katalogu WWW">
                                    {custom.map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.name}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                <optgroup label="Wbudowane melodie">
                                  {presets.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}
                                    </option>
                                  ))}
                                </optgroup>
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Built-in Presets Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            Wbudowane Melodie Bezstresowe ({presets.length})
          </h3>
          <span className="text-xs text-slate-400">
            Synteza czystego dźwięku 44.1 kHz PCM bez zniekształceń
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {presets.map((sound) => {
            const isPlaying = activePlayingId === sound.id;
            const isDefaultStart = config.defaultStartSoundId === sound.id;
            const isDefaultEnd = config.defaultEndSoundId === sound.id;

            return (
              <div
                key={sound.id}
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between ${
                  isPlaying
                    ? 'bg-amber-500/10 border-amber-500/50 shadow-md'
                    : 'bg-slate-800/80 border-slate-700/70 hover:border-slate-600'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                        {sound.name}
                      </h4>
                      <div className="text-[11px] text-amber-400/90 font-mono mt-0.5">
                        {sound.musicalKey} · {sound.durationSeconds}s
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleTogglePlay(sound)}
                      className={`p-2.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
                        isPlaying
                          ? 'bg-rose-500 text-white hover:bg-rose-600'
                          : 'bg-amber-400 text-slate-950 hover:bg-amber-300'
                      }`}
                      title={isPlaying ? 'Zatrzymaj' : 'Odsłuchaj melodię'}
                    >
                      {isPlaying ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
                    </button>
                  </div>

                  <p className="text-xs text-slate-300 mt-2.5 leading-relaxed">{sound.description}</p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-700/60 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1">
                    {sound.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] text-slate-400 bg-slate-900 border border-slate-700/80 px-1.5 py-0.5 rounded"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="text-[11px] font-mono">
                    {isDefaultStart && <span className="text-emerald-400 font-semibold">Domyślny Lekcja</span>}
                    {isDefaultEnd && <span className="text-sky-400 font-semibold">Domyślny Przerwa</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Custom Uploads & Uploader Component */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Upload Form (5 cols) */}
        <div className="lg:col-span-5 bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-700/60">
            <Upload className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Wgraj Własny Dźwięk (MP3 / WAV)
            </h3>
          </div>

          <form onSubmit={handleUploadSubmit} className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-300 mb-1">Plik audio ze szkoły (max 20MB)</label>
              <input
                type="file"
                accept=".mp3,.wav,.ogg"
                onChange={handleFileChange}
                className="w-full text-slate-400 text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:bg-slate-700 file:text-slate-200 hover:file:bg-slate-600 file:cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-slate-300 mb-1">Nazwa dzwonka</label>
              <input
                type="text"
                required
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="np. Dzwonek Szkolny - Motyw Orkiestry"
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-amber-400"
              />
            </div>

            <div>
              <label className="block text-slate-300 mb-1">Opis / Zastosowanie</label>
              <input
                type="text"
                value={uploadDesc}
                onChange={(e) => setUploadDesc(e.target.value)}
                placeholder="np. Utwór skomponowany przez uczniów na 50-lecie szkoły"
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-amber-400"
              />
            </div>

            <button
              type="submit"
              disabled={!fileData || !uploadName || isUploading}
              className="w-full py-2 px-4 rounded-lg bg-amber-400 hover:bg-amber-300 active:bg-amber-500 text-slate-950 font-semibold text-xs transition-colors cursor-pointer disabled:opacity-40 flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{isUploading ? 'Wgrywanie na Debian...' : 'Zapisz Dźwięk w Radiowęźle'}</span>
            </button>

            {uploadMsg && (
              <div className="p-2 rounded bg-slate-900 border border-emerald-800 text-emerald-300 text-center font-mono">
                {uploadMsg}
              </div>
            )}
          </form>
        </div>

        {/* Custom Uploads List (7 cols) */}
        <div className="lg:col-span-7 bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
            <div className="flex items-center gap-2">
              <FileAudio className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Własne i Zsynchronizowane Dźwięki ({custom.length})
              </h3>
            </div>
            <span className="text-xs text-slate-400">Zapisane w /data/sounds/</span>
          </div>

          {custom.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 bg-slate-900/40 border border-slate-800 rounded-lg">
              Brak własnych plików audio. Możesz pobrać dźwięki z katalogu WWW powyżej lub wgrać plik ręcznie po lewej stronie.
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {custom.map((sound) => {
                const isPlaying = activePlayingId === sound.id;
                return (
                  <div
                    key={sound.id}
                    className="p-3 rounded-lg bg-slate-900/70 border border-slate-700/60 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        type="button"
                        onClick={() => handleTogglePlay(sound)}
                        className={`p-2 rounded-lg cursor-pointer shrink-0 ${
                          isPlaying
                            ? 'bg-rose-500 text-white'
                            : 'bg-amber-400 text-slate-950 hover:bg-amber-300'
                        }`}
                      >
                        {isPlaying ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                      </button>

                      <div className="min-w-0">
                        <div className="font-semibold text-white flex flex-wrap items-center gap-2">
                          <span className="truncate">{sound.name}</span>
                          {sound.syncedFromRemote && (
                            <span className="px-1.5 py-0.5 rounded bg-sky-950/70 border border-sky-800 text-sky-300 text-[10px] font-normal">
                              Katalog WWW
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {sound.description}
                          {sound.remoteFilename ? ` · ${sound.remoteFilename}` : ''}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onDeleteCustomSound(sound.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors cursor-pointer shrink-0"
                      title="Usuń plik"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
