import React, { useState } from 'react';
import {
  Music,
  Play,
  Square,
  Upload,
  Trash2,
  Sparkles,
  Volume2,
  Check,
  Heart,
  FileAudio,
  Info,
} from 'lucide-react';
import { AppConfig, SoundTrack } from '../types/bell';
import { bellPlayer } from '../utils/audioPlayer';

interface SoundsViewProps {
  config: AppConfig;
  sounds: SoundTrack[];
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
}

export const SoundsView: React.FC<SoundsViewProps> = ({
  config,
  sounds,
  onUploadCustomSound,
  onDeleteCustomSound,
  onUpdateDefaultSounds,
}) => {
  const [activePlayingId, setActivePlayingId] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadKey, setUploadKey] = useState('Dźwięk własny');
  const [fileData, setFileData] = useState<{ base64: string; name: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const presets = sounds.filter((s) => s.category === 'preset');
  const custom = sounds.filter((s) => s.category === 'custom');

  const handleTogglePlay = async (sound: SoundTrack) => {
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
                Własne Dźwięki Szkoły ({custom.length})
              </h3>
            </div>
            <span className="text-xs text-slate-400">Zapisane w /data/sounds/</span>
          </div>

          {custom.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 bg-slate-900/40 border border-slate-800 rounded-lg">
              Brak własnych plików audio. Możesz wgrać dowolny plik MP3/WAV za pomocą formularza po lewej stronie.
            </div>
          ) : (
            <div className="space-y-2">
              {custom.map((sound) => {
                const isPlaying = activePlayingId === sound.id;
                return (
                  <div
                    key={sound.id}
                    className="p-3 rounded-lg bg-slate-900/70 border border-slate-700/60 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleTogglePlay(sound)}
                        className={`p-2 rounded-lg cursor-pointer ${
                          isPlaying
                            ? 'bg-rose-500 text-white'
                            : 'bg-amber-400 text-slate-950 hover:bg-amber-300'
                        }`}
                      >
                        {isPlaying ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                      </button>

                      <div>
                        <div className="font-semibold text-white">{sound.name}</div>
                        <div className="text-[11px] text-slate-400">{sound.description}</div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onDeleteCustomSound(sound.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors cursor-pointer"
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
