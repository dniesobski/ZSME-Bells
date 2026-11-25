import React, { useState } from 'react';
import { X, Bell, Play, Square, AlertTriangle, Sparkles, Volume2 } from 'lucide-react';
import { SoundTrack } from '../types/bell';
import { bellPlayer } from '../utils/audioPlayer';

interface ManualBellModalProps {
  isOpen: boolean;
  onClose: () => void;
  sounds: SoundTrack[];
  onTriggerBell: (soundId: string, type: string, title: string, volume: number) => Promise<void>;
}

export const ManualBellModal: React.FC<ManualBellModalProps> = ({
  isOpen,
  onClose,
  sounds,
  onTriggerBell,
}) => {
  const [selectedSoundId, setSelectedSoundId] = useState<string>(sounds[0]?.id || 'marimba_sunshine');
  const [volume, setVolume] = useState<number>(80);
  const [isPlayingPreview, setIsPlayingPreview] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [customTitle, setCustomTitle] = useState<string>('Dzwonek ręczny ze sterownika');

  if (!isOpen) return null;

  const selectedSound = sounds.find((s) => s.id === selectedSoundId) || sounds[0];

  const handlePreview = async () => {
    if (isPlayingPreview) {
      bellPlayer.stop();
      setIsPlayingPreview(false);
      return;
    }

    setIsPlayingPreview(true);
    await bellPlayer.playSound(selectedSoundId, {
      volume: volume / 100,
      fileUrl: selectedSound?.fileUrl,
      audioData: selectedSound?.audioData,
      onEnded: () => setIsPlayingPreview(false),
    });
  };

  const handleTrigger = async (type: 'manual' | 'emergency') => {
    try {
      setIsSubmitting(true);
      bellPlayer.stop();
      setIsPlayingPreview(false);
      await onTriggerBell(
        selectedSoundId,
        type,
        type === 'emergency' ? 'Alarm próbny / Sygnał komunikatu' : customTitle,
        volume
      );
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg max-h-[92dvh] overflow-y-auto bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-4 sm:p-6 text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Ręczne Wyzwolenie Dzwonka</h3>
              <p className="text-xs text-slate-400">Natychmiastowe odtworzenie melodii w radiowęźle szkolnym</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="py-4 space-y-4">
          {/* Sound selection */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Wybierz melodię bezstresową
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
              {sounds.map((sound) => {
                const isSelected = sound.id === selectedSoundId;
                return (
                  <button
                    key={sound.id}
                    type="button"
                    onClick={() => {
                      setSelectedSoundId(sound.id);
                      if (isPlayingPreview) {
                        bellPlayer.stop();
                        setIsPlayingPreview(false);
                      }
                    }}
                    className={`p-2.5 text-left rounded-lg border text-xs transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500/15 border-amber-500/50 text-white font-medium shadow-sm'
                        : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate">{sound.name}</span>
                      {sound.category === 'preset' && (
                        <Sparkles className="w-3 h-3 text-amber-400/80 shrink-0 ml-1" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                      <span>{sound.musicalKey}</span>
                      <span>·</span>
                      <span className="tabular-nums font-mono">{sound.durationSeconds}s</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Volume slider */}
          <div>
            <div className="flex items-center justify-between text-xs text-slate-300 mb-1.5">
              <span className="flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-amber-400" />
                Głośność wyjściowa radiowęzła
              </span>
              <span className="font-mono tabular-nums text-amber-300 font-semibold">{volume}%</span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
            />
          </div>

          {/* Title description input */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Powód / Notatka do dziennika
            </label>
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="np. Apel na korytarzu, Sprawdzian próbny"
              className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400"
            />
          </div>
        </div>

        {/* Footer actions */}
        <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handlePreview}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border flex items-center gap-1.5 transition-colors cursor-pointer ${
              isPlayingPreview
                ? 'bg-rose-950/60 border-rose-700 text-rose-300'
                : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
            }`}
          >
            {isPlayingPreview ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isPlayingPreview ? 'Zatrzymaj odsłuch' : 'Odsłuchaj w przeglądarce'}</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleTrigger('emergency')}
              title="Wyzwala łagodny sygnał zapowiedzi komunikatu dyrekcji lub ćwiczeń ewakuacji"
              className="px-3 py-1.5 text-xs font-medium text-rose-300 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Sygnał Komunikatu</span>
            </button>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleTrigger('manual')}
              className="px-4 py-1.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 active:bg-amber-500 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
            >
              <Bell className="w-3.5 h-3.5 fill-current" />
              <span>{isSubmitting ? 'Wysyłanie...' : 'Zadzwoń teraz'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
