import { PRESET_SOUNDS, getPresetWavBytes } from './wavGenerator';

class WebBellPlayer {
  private audioCtx: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private currentAudioElement: HTMLAudioElement | null = null;
  private wavCache: Map<string, string> = new Map(); // id -> blob url

  private getAudioContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  public getBlobUrlForPreset(presetId: string): string {
    if (this.wavCache.has(presetId)) {
      return this.wavCache.get(presetId)!;
    }
    const bytes = getPresetWavBytes(presetId);
    const blob = new Blob([bytes as unknown as BlobPart], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    this.wavCache.set(presetId, url);
    return url;
  }

  public stop() {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        // ignore if already stopped
      }
      this.currentSource = null;
    }
    if (this.currentAudioElement) {
      try {
        this.currentAudioElement.pause();
        this.currentAudioElement.currentTime = 0;
      } catch {
        // ignore
      }
      this.currentAudioElement = null;
    }
  }

  public async playSound(
    soundId: string,
    options?: {
      volume?: number; // 0.0 - 1.0
      fileUrl?: string;
      audioData?: string; // base64
      onEnded?: () => void;
    }
  ): Promise<void> {
    this.stop();
    const vol = Math.max(0, Math.min(1, options?.volume ?? 0.8));

    // If custom sound with fileUrl or base64 audioData
    if (options?.audioData) {
      const audio = new Audio(options.audioData);
      audio.volume = vol;
      this.currentAudioElement = audio;
      audio.onended = () => {
        options?.onEnded?.();
        this.currentAudioElement = null;
      };
      await audio.play();
      return;
    }

    if (options?.fileUrl) {
      const audio = new Audio(options.fileUrl);
      audio.volume = vol;
      this.currentAudioElement = audio;
      audio.onended = () => {
        options?.onEnded?.();
        this.currentAudioElement = null;
      };
      await audio.play();
      return;
    }

    // Preset sound
    const ctx = this.getAudioContext();
    const preset = PRESET_SOUNDS.find((p) => p.id === soundId) || PRESET_SOUNDS[0];
    const samples = preset.generator(ctx.sampleRate);

    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(vol, ctx.currentTime);

    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    this.currentSource = source;
    source.onended = () => {
      options?.onEnded?.();
      if (this.currentSource === source) {
        this.currentSource = null;
      }
    };

    source.start(0);
  }
}

export const bellPlayer = new WebBellPlayer();
