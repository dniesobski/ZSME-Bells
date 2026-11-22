/**
 * Procedural 16-bit 44.1kHz PCM WAV Audio Generator
 * Generates stress-free, harmonic bell sounds without external dependencies.
 * Compatible with Node.js and Browser environments.
 */

export interface PresetSoundDef {
  id: string;
  name: string;
  description: string;
  musicalKey: string;
  durationSeconds: number;
  tags: string[];
  generator: (sampleRate: number) => Float32Array;
}

// Convert audio sample buffer (Float32Array [-1.0, 1.0]) to valid PCM 16-bit WAV Uint8Array
export function encodeWAV(samples: Float32Array, sampleRate: number = 44100): Uint8Array {
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // Helper to write ASCII
  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  /* RIFF chunk descriptor */
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // chunkSize
  writeString(8, 'WAVE');

  /* "fmt " sub-chunk */
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample

  /* "data" sub-chunk */
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Write 16-bit PCM samples with soft limiting
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    // Apply soft tanh compression at edges to prevent clipping clicks
    s = Math.tanh(s);
    const intSample = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

// Convert note name to frequency
function noteToFreq(note: string): number {
  const notes: Record<string, number> = {
    C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
    C4: 261.63, 'C#4': 277.18, D4: 293.66, 'D#4': 311.13, E4: 329.63, F4: 349.23, 'F#4': 369.99, G4: 392.00, 'G#4': 415.30, A4: 440.00, 'A#4': 466.16, B4: 493.88,
    C5: 523.25, 'C#5': 554.37, D5: 587.33, 'D#5': 622.25, E5: 659.25, F5: 698.46, 'F#5': 739.99, G5: 783.99, 'G#5': 830.61, A5: 880.00, 'A#5': 932.33, B5: 987.77,
    C6: 1046.50, D6: 1174.66, E6: 1318.51, G6: 1567.98, A6: 1760.00,
  };
  return notes[note] || 440.0;
}

// Synthesize single acoustic chime note
function addBellNote(
  buffer: Float32Array,
  sampleRate: number,
  freq: number,
  startTime: number,
  duration: number,
  amplitude: number = 0.5,
  decayRate: number = 2.5,
  timbre: 'chime' | 'marimba' | 'bowl' | 'celesta' = 'chime'
) {
  const startSample = Math.floor(startTime * sampleRate);
  const endSample = Math.min(buffer.length, startSample + Math.floor(duration * sampleRate));

  for (let i = startSample; i < endSample; i++) {
    const t = (i - startSample) / sampleRate;

    // Envelope: soft smooth attack (15-40ms) then exponential decay
    const attackTime = timbre === 'bowl' ? 0.08 : 0.025;
    const attack = t < attackTime ? (0.5 * (1 - Math.cos((Math.PI * t) / attackTime))) : 1.0;
    const decay = Math.exp(-t * decayRate);
    const env = attack * decay * amplitude;

    let sampleVal = 0;

    if (timbre === 'chime') {
      // Harmonic & inharmonic chime partials (natural bell spectrum)
      const p1 = Math.sin(2 * Math.PI * freq * t);
      const p2 = 0.5 * Math.sin(2 * Math.PI * freq * 2.0 * t);
      const p3 = 0.35 * Math.sin(2 * Math.PI * freq * 2.76 * t);
      const p4 = 0.2 * Math.sin(2 * Math.PI * freq * 4.07 * t);
      const p5 = 0.1 * Math.sin(2 * Math.PI * freq * 5.4 * t);
      sampleVal = (p1 + p2 + p3 + p4 + p5) * env;
    } else if (timbre === 'marimba') {
      // Warm wooden bar: fundamental + strong 4th harmonic with faster overtone decay
      const p1 = Math.sin(2 * Math.PI * freq * t);
      const p2 = 0.4 * Math.sin(2 * Math.PI * freq * 3.98 * t) * Math.exp(-t * 8);
      const p3 = 0.15 * Math.sin(2 * Math.PI * freq * 9.2 * t) * Math.exp(-t * 15);
      sampleVal = (p1 + p2 + p3) * env;
    } else if (timbre === 'bowl') {
      // Singing bowl: rich low fundamental, slow acoustic shimmer/beating
      const beat = 1 + 0.12 * Math.sin(2 * Math.PI * 2.1 * t);
      const p1 = Math.sin(2 * Math.PI * freq * t) * beat;
      const p2 = 0.4 * Math.sin(2 * Math.PI * freq * 2.005 * t);
      const p3 = 0.25 * Math.sin(2 * Math.PI * freq * 3.01 * t);
      const p4 = 0.1 * Math.sin(2 * Math.PI * freq * 4.2 * t);
      sampleVal = (p1 + p2 + p3 + p4) * env;
    } else {
      // Celesta / Music box
      const p1 = Math.sin(2 * Math.PI * freq * t);
      const p2 = 0.3 * Math.sin(2 * Math.PI * freq * 3 * t) * Math.exp(-t * 6);
      const p3 = 0.15 * Math.sin(2 * Math.PI * freq * 5 * t) * Math.exp(-t * 10);
      sampleVal = (p1 + p2 + p3) * env;
    }

    buffer[i] += sampleVal;
  }
}

export const PRESET_SOUNDS: PresetSoundDef[] = [
  {
    id: 'koshi_aria',
    name: 'Dzwonki Koshi - Aria',
    description: 'Relaksujący, łagodny akord wietrzny w skali a-moll pentatonicznej. Kojący dla zmysłów.',
    musicalKey: 'A moll (Aria)',
    durationSeconds: 4.5,
    tags: ['relaksacyjny', 'polecany na przerwę', 'delikatny', 'koshi'],
    generator: (sr) => {
      const duration = 4.5;
      const buffer = new Float32Array(Math.floor(duration * sr));
      const notes = ['A4', 'C5', 'E5', 'A5', 'B5', 'C6', 'E6'];
      const times = [0.0, 0.28, 0.62, 0.98, 1.35, 1.75, 2.15];
      const amps = [0.45, 0.42, 0.48, 0.40, 0.38, 0.35, 0.30];

      notes.forEach((n, idx) => {
        addBellNote(buffer, sr, noteToFreq(n), times[idx], duration - times[idx], amps[idx], 1.4, 'chime');
      });
      return buffer;
    },
  },
  {
    id: 'marimba_sunshine',
    name: 'Słoneczna Marimba',
    description: 'Ciepłe, drewniane brzmienie marimby w tonacji C-dur. Wprowadza pozytywny nastrój na lekcję.',
    musicalKey: 'C dur',
    durationSeconds: 3.8,
    tags: ['na początek lekcji', 'ciepłe', 'drewniane', 'wesołe'],
    generator: (sr) => {
      const duration = 3.8;
      const buffer = new Float32Array(Math.floor(duration * sr));
      const sequence = [
        { note: 'C4', time: 0.0, amp: 0.5 },
        { note: 'G4', time: 0.32, amp: 0.52 },
        { note: 'C5', time: 0.64, amp: 0.55 },
        { note: 'E5', time: 0.96, amp: 0.58 },
        { note: 'G5', time: 1.30, amp: 0.62 },
      ];
      sequence.forEach((s) => {
        addBellNote(buffer, sr, noteToFreq(s.note), s.time, duration - s.time, s.amp, 2.2, 'marimba');
      });
      return buffer;
    },
  },
  {
    id: 'tibetan_gong',
    name: 'Tybetańska Misa & Gong',
    description: 'Głęboki, harmonijny rezonans misy dźwiękowej 216/432 Hz. Maksymalna redukcja stresu w szkole.',
    musicalKey: 'Harmonia 432 Hz',
    durationSeconds: 5.5,
    tags: ['wyciszający', 'głęboki', 'zen', 'na przerwę'],
    generator: (sr) => {
      const duration = 5.5;
      const buffer = new Float32Array(Math.floor(duration * sr));
      // Fundamental 216 Hz + harmonic resonant triad
      addBellNote(buffer, sr, 216.0, 0.0, duration, 0.6, 0.7, 'bowl');
      addBellNote(buffer, sr, 324.0, 0.15, duration - 0.15, 0.35, 0.8, 'bowl');
      addBellNote(buffer, sr, 432.0, 0.35, duration - 0.35, 0.28, 0.9, 'bowl');
      addBellNote(buffer, sr, 648.0, 0.80, duration - 0.8, 0.15, 1.1, 'chime');
      return buffer;
    },
  },
  {
    id: 'westminster_soft',
    name: 'Dzwonki Westminsterskie (Łagodne)',
    description: 'Tradycyjny motyw zegarowy (4 nuty) o ciepłym, aksamitnym brzmieniu dzwonków rurowych.',
    musicalKey: 'E dur',
    durationSeconds: 4.8,
    tags: ['klasyczny', 'dostojny', 'na początek lekcji'],
    generator: (sr) => {
      const duration = 4.8;
      const buffer = new Float32Array(Math.floor(duration * sr));
      const sequence = [
        { note: 'G#4', time: 0.0, amp: 0.55 },
        { note: 'F#4', time: 0.65, amp: 0.52 },
        { note: 'E4', time: 1.30, amp: 0.50 },
        { note: 'B3', time: 2.00, amp: 0.58 },
      ];
      sequence.forEach((s) => {
        addBellNote(buffer, sr, noteToFreq(s.note), s.time, duration - s.time, s.amp, 1.3, 'chime');
      });
      return buffer;
    },
  },
  {
    id: 'celtic_harp',
    name: 'Harfa Celtycka',
    description: 'Miękki, melodyjny arpeggio harfy w tonacji D-dur. Elegancki i przyjazny dla ucha sygnał.',
    musicalKey: 'D dur',
    durationSeconds: 4.0,
    tags: ['harfa', 'elegancki', 'spokojny', 'uniwersalny'],
    generator: (sr) => {
      const duration = 4.0;
      const buffer = new Float32Array(Math.floor(duration * sr));
      const notes = ['D4', 'F#4', 'A4', 'D5', 'F#5', 'A5'];
      const times = [0.0, 0.22, 0.44, 0.68, 0.94, 1.25];
      notes.forEach((n, i) => {
        addBellNote(buffer, sr, noteToFreq(n), times[i], duration - times[i], 0.45, 1.9, 'chime');
      });
      return buffer;
    },
  },
  {
    id: 'celesta_fairytale',
    name: 'Pozytywka & Celesta',
    description: 'Magiczny, łagodny dźwięk pozytywki. Szczególnie polecany dla klas 1-3 szkół podstawowych.',
    musicalKey: 'G dur',
    durationSeconds: 3.6,
    tags: ['pozytywka', 'klasy 1-3', 'dla najmłodszych', 'bajkowy'],
    generator: (sr) => {
      const duration = 3.6;
      const buffer = new Float32Array(Math.floor(duration * sr));
      const notes = ['G5', 'B5', 'D6', 'G6', 'E6', 'D6'];
      const times = [0.0, 0.28, 0.56, 0.88, 1.22, 1.58];
      notes.forEach((n, i) => {
        addBellNote(buffer, sr, noteToFreq(n), times[i], duration - times[i], 0.48, 2.6, 'celesta');
      });
      return buffer;
    },
  },
  {
    id: 'warning_prebell',
    name: 'Dzwonek Przywoławczy (Pre-Bell)',
    description: 'Krótki dwudźwięk 1 minutę przed końcem przerwy. Przygotowuje uczniów do powrotu do sali.',
    musicalKey: 'G -> C (Czysta kwarta)',
    durationSeconds: 2.2,
    tags: ['ostrzegawczy', '1 min przed lekcją', 'krótki', 'przywoławczy'],
    generator: (sr) => {
      const duration = 2.2;
      const buffer = new Float32Array(Math.floor(duration * sr));
      addBellNote(buffer, sr, noteToFreq('G5'), 0.0, 1.5, 0.55, 2.5, 'chime');
      addBellNote(buffer, sr, noteToFreq('C5'), 0.45, 1.7, 0.60, 2.0, 'chime');
      return buffer;
    },
  },
  {
    id: 'tubular_cathedral',
    name: 'Dzwony Rurowe (Tubular Bells)',
    description: 'Pojedynczy, szlachetny akord orkiestrowych dzwonów rurowych o czystym wybrzmieniu.',
    musicalKey: 'F dur 9',
    durationSeconds: 4.8,
    tags: ['uroczysty', 'głęboki', 'orchestrowy'],
    generator: (sr) => {
      const duration = 4.8;
      const buffer = new Float32Array(Math.floor(duration * sr));
      addBellNote(buffer, sr, noteToFreq('F4'), 0.0, duration, 0.5, 1.2, 'chime');
      addBellNote(buffer, sr, noteToFreq('C5'), 0.04, duration, 0.45, 1.3, 'chime');
      addBellNote(buffer, sr, noteToFreq('A5'), 0.08, duration, 0.38, 1.4, 'chime');
      addBellNote(buffer, sr, noteToFreq('G5'), 0.12, duration, 0.32, 1.5, 'chime');
      return buffer;
    },
  },
  {
    id: 'emergency_signal',
    name: 'Łagodny Sygnał Ewakuacji / Komunikatu',
    description: 'Czytelny, pulsujący 3-tonowy sygnał ostrzegawczy bez paniki. Zapowiedź komunikatu dyrekcji.',
    musicalKey: 'Sygnał ostrzegawczy',
    durationSeconds: 4.2,
    tags: ['komunikat', 'apel', 'próbna ewakuacja', 'bezpieczeństwo'],
    generator: (sr) => {
      const duration = 4.2;
      const buffer = new Float32Array(Math.floor(duration * sr));
      // 3 pulses
      [0.0, 1.2, 2.4].forEach((pulseTime) => {
        addBellNote(buffer, sr, noteToFreq('A4'), pulseTime, 0.9, 0.55, 3.0, 'chime');
        addBellNote(buffer, sr, noteToFreq('E5'), pulseTime + 0.18, 0.8, 0.55, 3.0, 'chime');
      });
      return buffer;
    },
  },
];

// Helper to get raw WAV bytes for a given preset
export function getPresetWavBytes(soundId: string, sampleRate: number = 44100): Uint8Array {
  const preset = PRESET_SOUNDS.find((p) => p.id === soundId) || PRESET_SOUNDS[0];
  const samples = preset.generator(sampleRate);
  return encodeWAV(samples, sampleRate);
}
